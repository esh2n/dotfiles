package llm

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// fakeSys records commands as "name args..." lines. outputs and fail answer
// by the start of the line; env and stdin are kept per line.
type fakeSys struct {
	mu      sync.Mutex
	os      string
	have    map[string]bool
	outputs map[string]string
	fail    map[string]bool
	calls   []string
	env     map[string][]string
	stdin   map[string]string
	onExec  func(line string) (handled bool, err error)
}

func newFakeSys(osName string, have ...string) *fakeSys {
	f := &fakeSys{os: osName, have: map[string]bool{}, outputs: map[string]string{}, fail: map[string]bool{}, env: map[string][]string{}, stdin: map[string]string{}}
	for _, h := range have {
		f.have[h] = true
	}
	return f
}

func (f *fakeSys) Exec(c sys.Cmd) (string, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	line := strings.TrimSpace(c.Name + " " + strings.Join(c.Args, " "))
	f.calls = append(f.calls, line)
	f.env[line] = c.Env
	if c.Stdin != nil {
		b, _ := io.ReadAll(c.Stdin)
		f.stdin[line] = string(b)
	}
	if f.onExec != nil {
		if handled, err := f.onExec(line); handled {
			return "", "", err
		}
	}
	for p := range f.fail {
		if strings.HasPrefix(line, p) {
			return "", "boom", errFake
		}
	}
	for p, out := range f.outputs {
		if strings.HasPrefix(line, p) {
			return out, "", nil
		}
	}
	return "", "", nil
}

type fakeErr struct{}

func (fakeErr) Error() string { return "exit status 1" }

var errFake = fakeErr{}

func (f *fakeSys) Has(name string) bool { return f.have[name] }
func (f *fakeSys) OS() string           { return f.os }

func (f *fakeSys) ran(prefix string) bool {
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

func (f *fakeSys) count(prefix string) int {
	n := 0
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

func (f *fakeSys) index(prefix string) int {
	for i, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			return i
		}
	}
	return -1
}

// services is a stand-in for every local HTTP service, answering in
// process (no port is opened): a path answers with its body when set, 503
// otherwise.
type services struct {
	mu     sync.Mutex
	bodies map[string]string
	posts  []string
}

func newServices(*testing.T) *services { return &services{bodies: map[string]string{}} }

func (s *services) RoundTrip(r *http.Request) (*http.Response, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := r.URL.Path
	if r.Method == http.MethodPost {
		b, _ := io.ReadAll(r.Body)
		s.posts = append(s.posts, string(b))
		key = "POST " + key
	}
	body, ok := s.bodies[key]
	status := http.StatusOK
	if !ok {
		status = http.StatusServiceUnavailable
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}, Request: r}, nil
}

func (s *services) set(path, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bodies[path] = body
}

// urls points every service at one prefix of the stand-in.
func (s *services) urls() URLs {
	u := "http://local"
	return URLs{LMStudio: u + "/lms", LiteLLM: u + "/litellm", Metrics: u + "/metrics-listener", Decision: u + "/jig", Prometheus: u + "/prom", Grafana: u + "/grafana", OpenWebUI: u + "/webui"}
}

type world struct {
	env      Env
	sys      *fakeSys
	svc      *services
	out, err *bytes.Buffer
	home     string
	repo     string
}

func newWorld(t *testing.T, osName string, offer Offer, have ...string) world {
	t.Helper()
	root := t.TempDir()
	home, repo := filepath.Join(root, "home"), filepath.Join(root, "dotfiles")
	for _, d := range []string{home, filepath.Join(repo, "home", "shared", "llm-ledger")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(repo, "home", "shared", "llm-ledger", "ledger.sql"), []byte("CREATE TABLE x;"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", os.Getenv("PATH"))
	f := newFakeSys(osName, have...)
	svc := newServices(t)
	var out, errOut bytes.Buffer
	return world{
		env: Env{
			Home: home, Repo: repo, Offer: offer, Sys: f,
			UI:       ui.Printer{Out: &out, Err: &errOut, Prefix: "home-llm"},
			URLs:     svc.urls(),
			HTTP:     &http.Client{Transport: svc},
			Getenv:   func(string) string { return "" },
			Sleep:    func(time.Duration) {},
			Hostname: "mac", UID: 501,
			TailscaleApp: filepath.Join(root, "no-tailscale-app"),
		},
		sys: f, svc: svc, out: &out, err: &errOut, home: home, repo: repo,
	}
}

// running makes tailscale present and logged in.
func (w world) running() {
	w.sys.have["tailscale"] = true
	w.sys.outputs["tailscale status --json"] = `{"BackendState": "Running", "Self": {"DNSName": "mac.example.ts.net."}, "Peer": {"a": {"HostName": "phone", "OS": "iOS"}}}`
}
