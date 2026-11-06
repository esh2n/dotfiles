package llm

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const fakeProxyKey = "sk-fake-proxy-key"

// structuredWorld is LiteLLM's chat endpoint as a stand-in server, in a
// checkout that names the three tiers.
type structuredWorld struct {
	env     Env
	sys     *fakeSys
	keyPath string
	seen    []*http.Request
	bodies  []string
}

func newStructuredWorld(t *testing.T, handler func(w http.ResponseWriter)) *structuredWorld {
	t.Helper()
	sw := &structuredWorld{sys: newFakeSys("darwin")}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		sw.seen = append(sw.seen, r)
		sw.bodies = append(sw.bodies, string(b))
		handler(w)
	}))
	t.Cleanup(srv.Close)
	repo := t.TempDir()
	policy := filepath.Join(repo, "harness", "policy")
	if err := os.MkdirAll(policy, 0o755); err != nil {
		t.Fatal(err)
	}
	tiers := `{"tiers":{"main":{},"complex":{},"executor":{}}}`
	if err := os.WriteFile(filepath.Join(policy, "tiers.json"), []byte(tiers), 0o644); err != nil {
		t.Fatal(err)
	}
	sw.env = Env{Repo: repo, Sys: sw.sys, URLs: URLs{LiteLLM: srv.URL}}
	sw.keyPath = filepath.Join(repo, "home", "shared", "litellm", "config", "proxy-key.sh")
	sw.sys.outputs[sw.keyPath] = fakeProxyKey + "\n"
	return sw
}

// chatAnswer is a chat completion whose first choice says content.
func chatAnswer(t *testing.T, content string) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}}})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func answering(t *testing.T, content string) func(http.ResponseWriter) {
	t.Helper()
	body := chatAnswer(t, content)
	return func(w http.ResponseWriter) { io.WriteString(w, body) }
}

var aRequest = StructuredRequest{System: "You sort tabs.", User: "the private user text", Schema: json.RawMessage(`{"type":"object","required":["tab"]}`)}

func TestStructuredReturnsTheModelsObject(t *testing.T) {
	sw := newStructuredWorld(t, answering(t, `{"tab": 3, "big": 12345678901234567890}`))
	got, err := Structured(sw.env, "main", aRequest, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"tab":3,"big":12345678901234567890}` {
		t.Errorf("answer: %s", got)
	}
	if len(sw.seen) != 1 {
		t.Fatalf("requests: %d", len(sw.seen))
	}
	r := sw.seen[0]
	if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
		t.Errorf("sent to %s %s", r.Method, r.URL.Path)
	}
	if r.Header.Get("Authorization") != "Bearer "+fakeProxyKey {
		t.Errorf("Authorization: %q", r.Header.Get("Authorization"))
	}
	var sent struct {
		Model          string `json:"model"`
		ResponseFormat struct {
			Type string `json:"type"`
		} `json:"response_format"`
		Messages []struct{ Role, Content string } `json:"messages"`
	}
	if err := json.Unmarshal([]byte(sw.bodies[0]), &sent); err != nil {
		t.Fatal(err)
	}
	if sent.Model != "main" {
		t.Errorf("model: %q", sent.Model)
	}
	if sent.ResponseFormat.Type != "json_object" {
		t.Errorf("response_format: %q", sent.ResponseFormat.Type)
	}
	if len(sent.Messages) != 2 || sent.Messages[0].Role != "system" || sent.Messages[1].Role != "user" {
		t.Fatalf("messages: %+v", sent.Messages)
	}
	system := sent.Messages[0].Content
	if !strings.Contains(system, aRequest.System) || !strings.Contains(system, string(aRequest.Schema)) {
		t.Errorf("the system text lacks the caller's text or the schema: %q", system)
	}
	if !strings.Contains(strings.ToLower(system), "json") {
		t.Errorf("DeepSeek's JSON Output needs the word json in the prompt: %q", system)
	}
	if sent.Messages[1].Content != aRequest.User {
		t.Errorf("user: %q", sent.Messages[1].Content)
	}
}

func TestStructuredSendsTheNamedTierAsTheModel(t *testing.T) {
	sw := newStructuredWorld(t, answering(t, `{}`))
	if _, err := Structured(sw.env, "executor", aRequest, time.Minute); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sw.bodies[0], `"model":"executor"`) {
		t.Errorf("body: %s", sw.bodies[0])
	}
}

func TestStructuredUnwrapsAFencedAnswer(t *testing.T) {
	for _, content := range []string{
		"```json\n{\"tab\":1}\n```",
		"```JSON\r\n{\"tab\":1}\r\n```\n",
		"```\n{\"tab\":1}\n```",
		"  ```json {\"tab\":1} ```  ",
	} {
		sw := newStructuredWorld(t, answering(t, content))
		got, err := Structured(sw.env, "main", aRequest, time.Minute)
		if err != nil {
			t.Errorf("%q: %v", content, err)
			continue
		}
		if string(got) != `{"tab":1}` {
			t.Errorf("%q: %s", content, got)
		}
	}
}

func TestStructuredKeepsABacktickInsideTheObject(t *testing.T) {
	sw := newStructuredWorld(t, answering(t, "{\"code\":\"```\"}"))
	got, err := Structured(sw.env, "main", aRequest, time.Minute)
	if err != nil || string(got) != "{\"code\":\"```\"}" {
		t.Errorf("%s, %v", got, err)
	}
}

// The failing bodies repeat the key and the user's text, because a gateway's
// error may echo what it was sent.
func TestStructuredFailuresNeverCarryTheKeyOrTheRequest(t *testing.T) {
	echo := fakeProxyKey + " " + aRequest.User
	status := func(code int) func(http.ResponseWriter) {
		return func(w http.ResponseWriter) {
			w.WriteHeader(code)
			io.WriteString(w, `{"error":{"message":"bad `+echo+`"}}`)
		}
	}
	cases := []struct {
		name   string
		answer func(http.ResponseWriter)
		want   string
	}{
		{"prose", answering(t, "Sure! "+echo), "not a JSON object"},
		{"prose before a fence", answering(t, "Here it is:\n```json\n{}\n```"), "not a JSON object"},
		{"an unclosed fence", answering(t, "```json\n{}"), "not a JSON object"},
		{"an array", answering(t, `[1,2]`), "not a JSON object"},
		{"a string", answering(t, `"`+echo+`"`), "not a JSON object"},
		{"null", answering(t, `null`), "not a JSON object"},
		{"two objects", answering(t, `{"a":1} {"b":2}`), "not a JSON object"},
		{"cut off", answering(t, `{"a":`), "not a JSON object"},
		{"cut off at the output cap", func(w http.ResponseWriter) {
			io.WriteString(w, `{"choices":[{"finish_reason":"length","message":{"content":"{\"a\":"}}]}`)
		}, "cut off"},
		{"stopped by the provider's filter", func(w http.ResponseWriter) {
			io.WriteString(w, `{"choices":[{"finish_reason":"content_filter","message":{"content":""}}]}`)
		}, "filter"},
		{"blank, as DeepSeek's JSON Output may answer", answering(t, "   "), "empty"},
		{"no choices", func(w http.ResponseWriter) { io.WriteString(w, `{"choices":[]}`) }, "no answer"},
		{"null content", func(w http.ResponseWriter) {
			io.WriteString(w, `{"choices":[{"message":{"content":null}}]}`)
		}, "empty"},
		{"a body that is not a chat completion", func(w http.ResponseWriter) { io.WriteString(w, echo) }, "not a chat completion"},
		{"401", status(http.StatusUnauthorized), "401"},
		{"400", status(http.StatusBadRequest), "400"},
		{"502", status(http.StatusBadGateway), "502"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sw := newStructuredWorld(t, c.answer)
			got, err := Structured(sw.env, "main", aRequest, time.Minute)
			if err == nil {
				t.Fatalf("expected a failure, got %s", got)
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("want %q in: %v", c.want, err)
			}
			requireNoSecret(t, err)
		})
	}
}

func TestStructuredWithoutAKeySendsNothing(t *testing.T) {
	sw := newStructuredWorld(t, answering(t, `{}`))
	sw.sys.fail[sw.keyPath] = true
	sw.sys.stderr[sw.keyPath] = "op: " + fakeProxyKey
	_, err := Structured(sw.env, "main", aRequest, time.Minute)
	if err == nil || !strings.Contains(err.Error(), "key") {
		t.Fatalf("an unresolved key must fail by name: %v", err)
	}
	requireNoSecret(t, err)
	if len(sw.seen) != 0 {
		t.Errorf("nothing may be sent without a key: %v", sw.bodies)
	}
}

func TestStructuredRefusesAnUnknownTierBeforeTheKey(t *testing.T) {
	sw := newStructuredWorld(t, answering(t, `{}`))
	for _, tier := range []string{"", "gpt-6", "deepseek-flash", "MAIN"} {
		_, err := Structured(sw.env, tier, aRequest, time.Minute)
		if err == nil || !strings.Contains(err.Error(), "unknown tier") {
			t.Errorf("%q: %v", tier, err)
		}
		if err != nil && !strings.Contains(err.Error(), "complex, executor, main") {
			t.Errorf("%q should list the tiers: %v", tier, err)
		}
	}
	if sw.sys.ran(sw.keyPath) || len(sw.seen) != 0 {
		t.Errorf("a refused tier must resolve no key and send nothing: %v", sw.sys.calls)
	}
}

func TestStructuredWithoutTheTierTableFails(t *testing.T) {
	sw := newStructuredWorld(t, answering(t, `{}`))
	sw.env.Repo = t.TempDir()
	if _, err := Structured(sw.env, "main", aRequest, time.Minute); err == nil || !strings.Contains(err.Error(), "tiers.json") {
		t.Errorf("a checkout without the table must say so: %v", err)
	}
}

func TestStructuredNamesASilentProxy(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	sw := newStructuredWorld(t, func(http.ResponseWriter) { <-release })
	_, err := Structured(sw.env, "main", aRequest, 50*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "no answer within 50ms") {
		t.Fatalf("a silent proxy should read as a timeout: %v", err)
	}
	requireNoSecret(t, err)
}

func TestStructuredRefusesATimeoutThatWouldNeverFire(t *testing.T) {
	sw := newStructuredWorld(t, answering(t, `{}`))
	for _, d := range []time.Duration{0, -time.Second} {
		if _, err := Structured(sw.env, "main", aRequest, d); err == nil || !strings.Contains(err.Error(), "timeout") {
			t.Errorf("%s: %v", d, err)
		}
	}
	if len(sw.seen) != 0 {
		t.Errorf("sent %d", len(sw.seen))
	}
}

func writeInput(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "in.json")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadStructuredRequestReadsTheFile(t *testing.T) {
	r, err := LoadStructuredRequest(writeInput(t, `{"system":"s","user":"u","schema":{"type":"object"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if r.System != "s" || r.User != "u" || string(r.Schema) != `{"type":"object"}` {
		t.Errorf("%+v", r)
	}
}

func TestLoadStructuredRequestRefusesWhatTheContractRefuses(t *testing.T) {
	secret := "private text"
	cases := []struct{ name, content, want string }{
		{"not JSON", "private text", "not valid JSON"},
		{"a list", `["` + secret + `"]`, "not valid JSON"},
		{"two values", `{"system":"s","user":"u","schema":{}} {}`, "not valid JSON"},
		{"system is a number", `{"system":1,"user":"` + secret + `","schema":{}}`, "not valid JSON"},
		{"no system", `{"user":"` + secret + `","schema":{}}`, `"system"`},
		{"empty system", `{"system":"","user":"` + secret + `","schema":{}}`, `"system"`},
		{"no user", `{"system":"` + secret + `","schema":{}}`, `"user"`},
		{"no schema", `{"system":"s","user":"` + secret + `"}`, `"schema"`},
		{"null schema", `{"system":"s","user":"` + secret + `","schema":null}`, `"schema"`},
		{"schema is a string", `{"system":"s","user":"` + secret + `","schema":"x"}`, `"schema"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := LoadStructuredRequest(writeInput(t, c.content))
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want %q in: %v", c.want, err)
			}
			if strings.Contains(err.Error(), secret) {
				t.Errorf("the input leaked: %v", err)
			}
		})
	}
}

func TestLoadStructuredRequestHoldsTheSizeLimit(t *testing.T) {
	fill := func(size int) string {
		shell := `{"system":"s","user":"","schema":{}}`
		return strings.Replace(shell, `"user":""`, `"user":"`+strings.Repeat("x", size-len(shell))+`"`, 1)
	}
	if _, err := LoadStructuredRequest(writeInput(t, fill(2<<20))); err != nil {
		t.Errorf("exactly 2 MiB is allowed: %v", err)
	}
	_, err := LoadStructuredRequest(writeInput(t, fill(2<<20+1)))
	if err == nil || !strings.Contains(err.Error(), "2 MiB") {
		t.Errorf("one byte over: %v", err)
	}
}

func TestLoadStructuredRequestReportsAMissingFile(t *testing.T) {
	_, err := LoadStructuredRequest(filepath.Join(t.TempDir(), "absent.json"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Errorf("%v", err)
	}
}

func requireNoSecret(t *testing.T, err error) {
	t.Helper()
	msg := err.Error()
	for _, s := range []string{fakeProxyKey, aRequest.User, aRequest.System} {
		if strings.Contains(msg, s) {
			t.Errorf("%q leaked into: %s", s, msg)
		}
	}
}

func TestStructuredCapsTheAnswer(t *testing.T) {
	body, err := chatPayload("main", aRequest)
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		MaxTokens int `json:"max_tokens"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatal(err)
	}
	if v.MaxTokens != structuredMaxTokens {
		t.Fatalf("max_tokens = %d, want %d", v.MaxTokens, structuredMaxTokens)
	}
}

func TestExecutorAsksForNoResponseFormatBecauseLMStudioRejectsJSONObject(t *testing.T) {
	sent, err := chatPayload("executor", StructuredRequest{System: "s", User: "u", Schema: []byte(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(sent, &got); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["response_format"]; ok {
		t.Errorf("response_format sent: %v", got["response_format"])
	}
	msgs := got["messages"].([]any)
	if system := msgs[0].(map[string]any)["content"].(string); !strings.Contains(system, "JSON Schema") {
		t.Errorf("schema missing from system text: %q", system)
	}
}
