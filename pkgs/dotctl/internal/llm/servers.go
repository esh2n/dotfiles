package llm

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// The model servers every machine reaches through its own LiteLLM, under one
// path each (LiteLLM's pass_through_endpoints in litellm/config.yaml, with
// the proxy key required): /model-servers/<server>/models lists them,
// …/models/load and …/models/unload change what is loaded. The two engines
// speak their own shapes behind those paths — llama-server's router mode
// (tools/server/README.md: GET /models, POST /models/load|unload with
// {"model"}) and LM Studio's REST v1 (GET /api/v1/models, POST
// /api/v1/models/load with {"model"}, …/unload with {"instance_id"}) — and
// this file is the one place that knows both
// (rules/decisions/2026-09-30-model-servers-through-litellm.md).
var modelServers = []string{"linux", "mac"}

// ServerModel is one model a server has, and whether it is loaded now.
type ServerModel struct {
	ID     string
	Loaded bool
}

// ServerState is one server's models, or why it could not be read.
type ServerState struct {
	Server string
	Models []ServerModel
	Err    error
}

func (e Env) serverURL(server, suffix string) string {
	return e.URLs.LiteLLM + "/model-servers/" + server + "/models" + suffix
}

func isModelServer(server string) bool {
	for _, s := range modelServers {
		if s == server {
			return true
		}
	}
	return false
}

// ServerModels lists every model server's models, each on its own (one
// being off does not hide the other).
func ServerModels(e Env) []ServerState {
	e = e.withDefaults()
	key := e.proxyKey()
	out := make([]ServerState, 0, len(modelServers))
	for _, server := range modelServers {
		out = append(out, readServer(e, key, server))
	}
	return out
}

func readServer(e Env, key, server string) ServerState {
	return readServerWith(e, key, server, 10*time.Second)
}

func readServerWith(e Env, key, server string, within time.Duration) ServerState {
	if key == "" {
		return ServerState{Server: server, Err: fmt.Errorf("the LiteLLM key did not resolve (litellm/proxy-key.sh)")}
	}
	body, status, err := e.call(http.MethodGet, e.serverURL(server, ""), key, nil, within)
	if err != nil {
		var timeout interface{ Timeout() bool }
		if errors.As(err, &timeout) && timeout.Timeout() {
			err = fmt.Errorf("no answer within %s — the %s model server is probably off or off the tailnet", within, server)
		}
		return ServerState{Server: server, Err: err}
	}
	if status/100 != 2 {
		return ServerState{Server: server, Err: fmt.Errorf("answered %d: %s", status, snippet(body))}
	}
	models, err := parseServerModels(server, body)
	return ServerState{Server: server, Models: models, Err: err}
}

// parseServerModels reads either engine's list into one shape, sorted by id.
func parseServerModels(server string, body []byte) ([]ServerModel, error) {
	var models []ServerModel
	switch server {
	case "linux":
		var v struct {
			Data []struct {
				ID     string `json:"id"`
				Status struct {
					Value string `json:"value"`
				} `json:"status"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &v); err != nil {
			return nil, fmt.Errorf("llama-server's model list: %w", err)
		}
		for _, m := range v.Data {
			models = append(models, ServerModel{ID: m.ID, Loaded: m.Status.Value == "loaded"})
		}
	case "mac":
		var v struct {
			Models []struct {
				Type            string            `json:"type"`
				Key             string            `json:"key"`
				LoadedInstances []json.RawMessage `json:"loaded_instances"`
			} `json:"models"`
		}
		if err := json.Unmarshal(body, &v); err != nil {
			return nil, fmt.Errorf("LM Studio's model list: %w", err)
		}
		for _, m := range v.Models {
			models = append(models, ServerModel{ID: m.Key, Loaded: len(m.LoadedInstances) > 0})
		}
	default:
		return nil, fmt.Errorf("unknown model server %q", server)
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}

// LoadModel loads model on server; UnloadModel unloads it.
func LoadModel(e Env, server, model string) error {
	return changeModel(e, server, "load", model)
}

func UnloadModel(e Env, server, model string) error {
	return changeModel(e, server, "unload", model)
}

func changeModel(e Env, server, action, model string) error {
	if !isModelServer(server) {
		return fmt.Errorf("unknown model server %q (one of %s)", server, strings.Join(modelServers, ", "))
	}
	if model == "" {
		return fmt.Errorf("name the model to %s", action)
	}
	e = e.withDefaults()
	key := e.proxyKey()
	if key == "" {
		return fmt.Errorf("the LiteLLM key did not resolve (litellm/proxy-key.sh)")
	}
	field := "model"
	if server == "mac" && action == "unload" {
		// LM Studio unloads an instance; an instance loaded by key carries the key as its id
		field = "instance_id"
	}
	payload, err := json.Marshal(map[string]string{field: model})
	if err != nil {
		return err
	}
	// loading a 17 GB model takes a while; the answer comes when it is loaded
	body, status, err := e.call(http.MethodPost, e.serverURL(server, "/"+action), key, payload, 5*time.Minute)
	if err != nil {
		return err
	}
	if status/100 != 2 {
		return fmt.Errorf("%s %s on %s: answered %d: %s", action, model, server, status, snippet(body))
	}
	return nil
}

// call sends one request to LiteLLM with the proxy key.
func (e Env) call(method, url, key string, payload []byte, timeout time.Duration) ([]byte, int, error) {
	c := *e.HTTP
	c.Timeout = timeout
	var reader *bytes.Reader
	if payload == nil {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("LiteLLM did not answer: %w", err)
	}
	defer resp.Body.Close()
	body, err := readAll(resp)
	return body, resp.StatusCode, err
}

func snippet(body []byte) string {
	s := strings.TrimSpace(string(body))
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}
