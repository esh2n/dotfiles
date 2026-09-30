package llm

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// serversWorld is LiteLLM's pass-through as a stand-in server, recording what
// reached it.
type serversWorld struct {
	env  Env
	sys  *fakeSys
	seen []string
}

func newServersWorld(t *testing.T, handler func(w http.ResponseWriter, r *http.Request, body string)) *serversWorld {
	t.Helper()
	sw := &serversWorld{sys: newFakeSys("darwin")}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		sw.seen = append(sw.seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization")+" "+string(b))
		handler(w, r, string(b))
	}))
	t.Cleanup(srv.Close)
	sw.env = Env{Repo: "/repo", Sys: sw.sys, URLs: URLs{LiteLLM: srv.URL}}
	sw.sys.outputs[sw.env.litellm("proxy-key.sh")] = "the-key\n"
	return sw
}

const linuxList = `{"data":[{"id":"Qwen3.8-27B-Q4_K_M","status":{"value":"loaded"}},{"id":"other","status":{"value":"unloaded"}}]}`
const macList = `{"models":[{"type":"llm","key":"qwen/qwen3.8-27b","loaded_instances":[]},{"type":"llm","key":"gemma","loaded_instances":[{"id":"gemma"}]}]}`

func TestServerModelsReadsBothEnginesIntoOneShape(t *testing.T) {
	sw := newServersWorld(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		switch r.URL.Path {
		case "/model-servers/linux/models":
			io.WriteString(w, linuxList)
		case "/model-servers/mac/models":
			io.WriteString(w, macList)
		default:
			http.NotFound(w, r)
		}
	})
	got := ServerModels(sw.env)
	if len(got) != 2 || got[0].Server != "linux" || got[1].Server != "mac" {
		t.Fatalf("servers: %+v", got)
	}
	if got[0].Err != nil || got[1].Err != nil {
		t.Fatalf("errors: %v / %v", got[0].Err, got[1].Err)
	}
	want := []ServerModel{{ID: "Qwen3.8-27B-Q4_K_M", Loaded: true}, {ID: "other", Loaded: false}}
	if !equalModels(got[0].Models, want) {
		t.Errorf("linux: %+v", got[0].Models)
	}
	wantMac := []ServerModel{{ID: "gemma", Loaded: true}, {ID: "qwen/qwen3.8-27b", Loaded: false}}
	if !equalModels(got[1].Models, wantMac) {
		t.Errorf("mac: %+v", got[1].Models)
	}
	if !strings.Contains(sw.seen[0], "Bearer the-key") {
		t.Errorf("the proxy key was not sent: %q", sw.seen[0])
	}
}

func TestOneServerDownDoesNotHideTheOther(t *testing.T) {
	sw := newServersWorld(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		if strings.HasPrefix(r.URL.Path, "/model-servers/linux") {
			w.WriteHeader(http.StatusBadGateway)
			io.WriteString(w, "connection refused")
			return
		}
		io.WriteString(w, macList)
	})
	got := ServerModels(sw.env)
	if got[0].Err == nil || !strings.Contains(got[0].Err.Error(), "502") {
		t.Errorf("linux should fail with its status: %v", got[0].Err)
	}
	if got[1].Err != nil || len(got[1].Models) != 2 {
		t.Errorf("mac should still read: %+v", got[1])
	}
}

func TestLoadAndUnloadSendEachEnginesBody(t *testing.T) {
	sw := newServersWorld(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		io.WriteString(w, `{}`)
	})
	cases := []struct {
		run  func() error
		want string
	}{
		{func() error { return LoadModel(sw.env, "linux", "q") }, `POST /model-servers/linux/models/load Bearer the-key {"model":"q"}`},
		{func() error { return UnloadModel(sw.env, "linux", "q") }, `POST /model-servers/linux/models/unload Bearer the-key {"model":"q"}`},
		{func() error { return LoadModel(sw.env, "mac", "g") }, `POST /model-servers/mac/models/load Bearer the-key {"model":"g"}`},
		{func() error { return UnloadModel(sw.env, "mac", "g") }, `POST /model-servers/mac/models/unload Bearer the-key {"instance_id":"g"}`},
	}
	for i, c := range cases {
		if err := c.run(); err != nil {
			t.Fatalf("case %d: %v", i, err)
		}
		if sw.seen[i] != c.want {
			t.Errorf("case %d: sent %q, want %q", i, sw.seen[i], c.want)
		}
	}
}

func TestChangeModelRefusesWhatItCannotDo(t *testing.T) {
	sw := newServersWorld(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, `{"error":"model not found"}`)
	})
	if err := LoadModel(sw.env, "windows", "x"); err == nil || !strings.Contains(err.Error(), "unknown model server") {
		t.Errorf("unknown server: %v", err)
	}
	if err := LoadModel(sw.env, "mac", ""); err == nil {
		t.Error("an empty model name must be refused")
	}
	if err := LoadModel(sw.env, "mac", "x"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("a refusal must say what came back: %v", err)
	}
	if len(sw.seen) != 1 {
		t.Errorf("only the valid request reaches LiteLLM: %v", sw.seen)
	}
}

func TestNoKeyIsReportedNotSent(t *testing.T) {
	sw := newServersWorld(t, func(w http.ResponseWriter, _ *http.Request, _ string) {})
	sw.sys.fail[sw.env.litellm("proxy-key.sh")] = true
	for _, s := range ServerModels(sw.env) {
		if s.Err == nil || !strings.Contains(s.Err.Error(), "key") {
			t.Errorf("%s: %v", s.Server, s.Err)
		}
	}
	if err := LoadModel(sw.env, "mac", "x"); err == nil {
		t.Error("load without a key must fail")
	}
	if len(sw.seen) != 0 {
		t.Errorf("nothing may be sent without a key: %v", sw.seen)
	}
}

func equalModels(a, b []ServerModel) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}
