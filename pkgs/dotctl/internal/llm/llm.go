// Package llm is `dotctl llm`: the home LLM's command steps and its check
// (rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md,
// 2026-09-24-home-llm-second-host-omarchy-llama-server.md,
// 2026-09-25-llm-cost-ledger-local-first.md). Machines use each other's
// models — there is no hub; what runs and what is probed follow this
// machine's roles, passed as Offer, never whether an app is installed.
package llm

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// Sys is the machine. sys.OS is the real one.
type Sys interface {
	Exec(c sys.Cmd) (string, string, error)
	Has(name string) bool
	OS() string
}

// Offer is what this machine's roles make it offer.
type Offer struct {
	LMStudio bool // model-provider on macOS: LM Studio's server, tailnet :1234
	GPU      bool // model-provider on Linux: llama-server, tailnet :8080
	Console  bool // observer: Prometheus, Grafana, Open WebUI, the cost ledger
}

// Name is how the check's header names the offer ("lmstudio console").
func (o Offer) Name() string {
	var w []string
	if o.LMStudio {
		w = append(w, "lmstudio")
	}
	if o.GPU {
		w = append(w, "gpu")
	}
	if o.Console {
		w = append(w, "console")
	}
	return strings.Join(w, " ")
}

// URLs are the local services, by what they are. Tests point them at a
// stand-in server.
type URLs struct {
	LMStudio, LiteLLM, Metrics, Decision, Prometheus, Grafana, OpenWebUI string
}

// Local is where the services listen on every machine.
var Local = URLs{
	LMStudio:   "http://127.0.0.1:1234",
	LiteLLM:    "http://127.0.0.1:4000",
	Metrics:    "http://127.0.0.1:4001",
	Decision:   "http://127.0.0.1:4100",
	Prometheus: "http://127.0.0.1:9090",
	Grafana:    "http://127.0.0.1:3000",
	OpenWebUI:  "http://127.0.0.1:3001",
}

// Env is the world a command runs in.
type Env struct {
	Home, Repo string
	Offer      Offer
	Sys        Sys
	UI         ui.Printer
	URLs       URLs
	HTTP       *http.Client
	Getenv     func(string) string
	Sleep      func(time.Duration)
	Now        func() time.Time
	Hostname   string
	UID        int
	// TailscaleApp is the macOS app's CLI, used when tailscale is not on
	// PATH; default the app's place in /Applications.
	TailscaleApp string
}

func (e Env) withDefaults() Env {
	if e.URLs == (URLs{}) {
		e.URLs = Local
	}
	if e.HTTP == nil {
		e.HTTP = &http.Client{}
	}
	if e.Getenv == nil {
		e.Getenv = os.Getenv
	}
	if e.Sleep == nil {
		e.Sleep = time.Sleep
	}
	if e.Now == nil {
		e.Now = time.Now
	}
	if e.TailscaleApp == "" {
		e.TailscaleApp = tailscaleApp
	}
	return e
}

// litellm is the checkout's LiteLLM directory (config, scripts, stacks).
func (e Env) litellm(parts ...string) string {
	return filepath.Join(append([]string{e.Repo, "home", "shared", "litellm", "config"}, parts...)...)
}

// run runs a command silently with a timeout.
func (e Env) run(timeout time.Duration, name string, args ...string) (string, string, error) {
	return e.Sys.Exec(sys.Cmd{Name: name, Args: args, Timeout: timeout})
}

// get fetches a URL within timeout; ok is a 2xx answer.
func (e Env) get(url string, timeout time.Duration, header ...string) ([]byte, bool) {
	c := *e.HTTP
	c.Timeout = timeout
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, false
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	var b []byte
	b, err = readAll(resp)
	return b, err == nil && resp.StatusCode/100 == 2
}

// answers is whether a URL answers 2xx within two seconds.
func (e Env) answers(url string) bool {
	_, ok := e.get(url, 2*time.Second)
	return ok
}

// waitFor polls a URL every two seconds for up to two minutes.
func (e Env) waitFor(url string) bool {
	for i := 0; i < 60; i++ {
		if e.answers(url) {
			return true
		}
		e.Sleep(2 * time.Second)
	}
	return false
}

// proxyKey is the LiteLLM master key, as litellm/proxy-key.sh resolves it
// (the OS secret store's op token, then op read); "" when it does not.
func (e Env) proxyKey() string {
	out, _, err := e.run(30*time.Second, e.litellm("proxy-key.sh"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

const tailscaleApp = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"

// tailscale is the CLI's path; "" when it is not installed.
func (e Env) tailscale() string {
	if e.Sys.Has("tailscale") {
		return "tailscale"
	}
	if info, err := os.Stat(e.TailscaleApp); err == nil && info.Mode()&0o111 != 0 {
		return e.TailscaleApp
	}
	return ""
}

// tailnetStatus is `tailscale status --json`, the parts used here.
type tailnetStatus struct {
	BackendState string
	Self         struct{ DNSName, HostName string }
	Peer         map[string]struct {
		HostName, OS string
	}
}

func (e Env) status(ts string) tailnetStatus {
	var st tailnetStatus
	out, _, err := e.run(10*time.Second, ts, "status", "--json")
	if err == nil {
		_ = json.Unmarshal([]byte(out), &st)
	}
	return st
}
