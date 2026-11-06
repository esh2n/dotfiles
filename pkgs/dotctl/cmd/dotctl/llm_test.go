package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/llm"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
)

// The flags named for a product or a part stop with the role that replaced
// them, before anything runs.
func TestLLMRenamedFlagsNameTheirRole(t *testing.T) {
	for _, c := range []struct{ arg, want string }{
		{"--lmstudio", "--lmstudio is now --model-provider"},
		{"-gpu", "--gpu is now --model-provider"},
		{"--console=true", "--console is now --observer"},
	} {
		var out, errOut bytes.Buffer
		code := runLLM(t.TempDir(), []string{"check", "--repo", t.TempDir(), c.arg}, &out, &errOut)
		if code != 2 || !strings.Contains(errOut.String(), c.want) || out.Len() != 0 {
			t.Errorf("%s: exit %d, stdout %q, stderr %q", c.arg, code, out.String(), errOut.String())
		}
	}
	if old, _ := renamedOfferFlag([]string{"--", "--gpu"}); old != "" {
		t.Errorf("a flag after -- was read as renamed: %q", old)
	}
}

// fakeKeySys answers every command, proxy-key.sh among them, with the key.
type fakeKeySys struct{ key string }

func (f fakeKeySys) Exec(sys.Cmd) (string, string, error) { return f.key + "\n", "", nil }
func (fakeKeySys) Has(string) bool                        { return false }
func (fakeKeySys) OS() string                             { return "darwin" }

// structuredRepo is a checkout naming the tiers, with one input file.
func structuredRepo(t *testing.T) (repo, input string) {
	t.Helper()
	repo = t.TempDir()
	policy := filepath.Join(repo, "harness", "policy")
	if err := os.MkdirAll(policy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(policy, "tiers.json"), []byte(`{"tiers":{"main":{}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	input = filepath.Join(repo, "in.json")
	if err := os.WriteFile(input, []byte(`{"system":"s","user":"the private user text","schema":{"type":"object"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return repo, input
}

func TestStructuredStdoutIsOnlyTheJSON(t *testing.T) {
	repo, input := structuredRepo(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"content":"`+"```json\\n{ \\\"tab\\\": 3 }\\n```"+`"}}]}`)
	}))
	defer srv.Close()
	e := llm.Env{Repo: repo, Sys: fakeKeySys{"sk-fake"}, URLs: llm.URLs{LiteLLM: srv.URL}}
	var out, errOut bytes.Buffer
	code := answerStructured(e, "main", input, time.Minute, &out, &errOut)
	if code != 0 || out.String() != "{\"tab\":3}\n" || errOut.Len() != 0 {
		t.Errorf("exit %d, stdout %q, stderr %q", code, out.String(), errOut.String())
	}
}

func TestStructuredFailureIsOneLineOnStderrAndNothingOnStdout(t *testing.T) {
	repo, input := structuredRepo(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprint(w, "sk-fake\nthe private user text\n")
	}))
	defer srv.Close()
	e := llm.Env{Repo: repo, Sys: fakeKeySys{"sk-fake"}, URLs: llm.URLs{LiteLLM: srv.URL}}
	var out, errOut bytes.Buffer
	code := answerStructured(e, "main", input, time.Minute, &out, &errOut)
	if code == 0 || out.Len() != 0 {
		t.Errorf("exit %d, stdout %q", code, out.String())
	}
	line := errOut.String()
	if strings.Count(line, "\n") != 1 || !strings.HasSuffix(line, "\n") || !strings.Contains(line, "502") {
		t.Errorf("stderr: %q", line)
	}
	if strings.Contains(line, "sk-fake") || strings.Contains(line, "private") {
		t.Errorf("leaked: %q", line)
	}
}

// These stop before any key or request, so they run the real command.
func TestStructuredCommandRefusals(t *testing.T) {
	repo, input := structuredRepo(t)
	for _, c := range []struct {
		name string
		args []string
		code int
		want string
	}{
		{"no tier", []string{"--input", input}, 2, "--tier"},
		{"no input", []string{"--tier", "main"}, 2, "--input"},
		{"stray argument", []string{"--tier", "main", "--input", input, "extra"}, 2, "extra"},
		{"unknown flag", []string{"--tier", "main", "--bogus"}, 2, "bogus"},
		{"bad timeout", []string{"--tier", "main", "--input", input, "--timeout", "soon"}, 2, "timeout"},
		{"unknown tier", []string{"--tier", "nope", "--input", input}, 1, "unknown tier"},
		{"absent input", []string{"--tier", "main", "--input", input + ".absent"}, 1, "absent"},
	} {
		t.Run(c.name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			args := append([]string{"structured", "--repo", repo}, c.args...)
			code := runLLM(t.TempDir(), args, &out, &errOut)
			if code != c.code || out.Len() != 0 {
				t.Errorf("exit %d, stdout %q", code, out.String())
			}
			if strings.Count(errOut.String(), "\n") != 1 || !strings.Contains(errOut.String(), c.want) {
				t.Errorf("stderr: %q", errOut.String())
			}
		})
	}
}
