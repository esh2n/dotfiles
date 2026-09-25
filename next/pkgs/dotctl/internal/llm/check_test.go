package llm

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// healthy makes every service answer as it does on a working observer Mac.
func healthy(w world) {
	w.running()
	w.sys.have["omp"] = true
	w.sys.outputs[w.env.litellm("proxy-key.sh")] = "k\n"
	w.sys.outputs["tailscale serve status"] = "tcp://mac:1234\ntcp://mac:5432\nhttps://mac:3001\ntcp://mac:4001\ntcp://mac:8080\n"
	w.sys.outputs["omp models ls --json"] = `{"models": [{"provider": "proxy", "id": "main"}, {"provider": "proxy", "id": "complex"}, {"nested": [{"provider": "proxy", "id": "deterministic"}]}, {"provider": "other", "id": "x"}]}`
	w.svc.set("/lms/v1/models", `{"data": [{"id": "qwen"}, {"id": "nomic"}]}`)
	w.svc.set("/lms/api/v1/models", `{"models": [{"key": "qwen", "max_context_length": 262144, "loaded_instances": [{"id": "qwen", "config": {"context_length": 32768}}]}, {"key": "nomic", "loaded_instances": []}]}`)
	w.svc.set("/litellm/v1/models", `{"data": [{"id": "main"}, {"id": "deterministic"}, {"id": "complex"}]}`)
	w.svc.set("POST /litellm/v1/chat/completions", `{"model": "local-qwen", "choices": [{"message": {"content": " pong\n"}}]}`)
	w.svc.set("/jig/health", "ok")
	w.svc.set("/metrics-listener/health", `{"status": "healthy"}`)
	w.svc.set("/metrics-listener/metrics/", "# HELP\nlitellm_a 1\nlitellm_b 2\nother 3\n")
	w.svc.set("/prom/api/v1/targets", `{"data": {"activeTargets": [{"labels": {"job": "node"}, "health": "down"}, {"labels": {"job": "litellm"}, "health": "up", "scrapeUrl": "http://host:4000/metrics/"}]}}`)
	w.svc.set("/grafana/api/health", "{}")
	w.svc.set("/webui/", "<html>")
}

func runCheck(w world, withComplex bool) (int, string, string) {
	var out bytes.Buffer
	log := filepath.Join(w.home, "state", "home-llm", "check.log")
	w.env.Now = func() time.Time { return time.Date(2026, 9, 25, 18, 0, 0, 0, time.UTC) }
	fails := Check(w.env, &Checker{Out: &out, Log: log}, withComplex)
	b, _ := os.ReadFile(log)
	return fails, out.String(), string(b)
}

func TestCheckAllPassOnAHealthyObserver(t *testing.T) {
	w := newWorld(t, "darwin", Offer{LMStudio: true, Console: true})
	healthy(w)
	fails, out, log := runCheck(w, false)
	if fails != 0 {
		t.Fatalf("%d FAIL:\n%s", fails, out)
	}
	for _, want := range []string{
		"home-llm check (lmstudio console)",
		"PASS LM Studio :1234 lists: qwen nomic",
		"PASS LiteLLM :4000 tiers: complex deterministic main",
		`PASS tier deterministic: "pong  [local-qwen]"`,
		"PASS LM Studio loaded context: qwen: loaded=32768 max=262144",
		"PASS omp lists the proxy tiers: complex deterministic main",
		"PASS LiteLLM :4001 metrics listener healthy (2 litellm_* series)",
		"PASS Prometheus scrapes litellm: up http://host:4000/metrics/",
		"PASS tailscale serve 5432 (cost ledger) → mac.example.ts.net:5432",
		"PASS tailnet devices besides this machine: phone (iOS)",
		"open https://mac.example.ts.net:3001",
		"home-llm check: 0 FAIL",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "tier complex") || len(w.svc.posts) != 2 {
		t.Fatalf("complex asked without --complex: %v", w.svc.posts)
	}
	if !strings.Contains(log, "== 2026-09-25 18:00:00 UTC mac ==") || !strings.Contains(log, "TOTAL 0 FAIL") || strings.Contains(log, "\033[") {
		t.Fatalf("log %q", log)
	}
}

func TestCheckComplexAndColor(t *testing.T) {
	w := newWorld(t, "linux", Offer{})
	healthy(w)
	var out bytes.Buffer
	Check(w.env, &Checker{Out: &out, Color: true}, true)
	if !strings.Contains(out.String(), "tier complex") || !strings.Contains(out.String(), "\033[32mPASS\033[0m") {
		t.Fatalf("out %q", out.String())
	}
	if strings.Contains(out.String(), "tailscale serve 1234") || !strings.Contains(out.String(), "tailscale serve 4001 (metrics)") {
		t.Fatalf("a machine without an offer probes only its metrics port: %s", out.String())
	}
}

func TestCheckCountsEveryFailure(t *testing.T) {
	w := newWorld(t, "darwin", Offer{LMStudio: true, GPU: true, Console: true})
	fails, out, _ := runCheck(w, false)
	for _, want := range []string{
		"FAIL LM Studio :1234 does not answer",
		"FAIL LiteLLM master key unresolved",
		"FAIL LiteLLM :4000 /v1/models does not answer",
		"FAIL LM Studio: no model loaded",
		"FAIL jig decision service :4100 not answering",
		"FAIL LiteLLM :4001 metrics listener not answering",
		"FAIL Prometheus :9090 not answering",
		"FAIL Grafana :3000 not answering",
		"FAIL Open WebUI :3001 not answering",
		"FAIL tailscale CLI not found",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	if fails != 10 || !strings.Contains(out, "home-llm check: 10 FAIL") {
		t.Fatalf("fails %d:\n%s", fails, out)
	}
}

func TestCheckPartialAnswersFail(t *testing.T) {
	w := newWorld(t, "darwin", Offer{Console: true})
	healthy(w)
	w.svc.set("/litellm/v1/models", `{"data": [{"id": "main"}]}`)
	w.svc.set("POST /litellm/v1/chat/completions", `{"error": "no key"}`)
	w.svc.set("/prom/api/v1/targets", `{"data": {"activeTargets": [{"labels": {"job": "litellm"}, "health": "down", "scrapeUrl": "u"}]}}`)
	w.sys.outputs["tailscale serve status"] = ""
	w.sys.outputs["tailscale status --json"] = `{"BackendState": "Running"}`
	w.sys.outputs["omp models ls --json"] = "not json"
	_, out, _ := runCheck(w, false)
	for _, want := range []string{
		"FAIL LiteLLM :4000 tiers incomplete: main",
		`FAIL tier main: no completion — {"error": "no key"}`,
		"FAIL Prometheus litellm target: down u",
		"FAIL omp does not list proxy/{main,complex,deterministic} (models.yml provider, or key) — got: none",
		"FAIL tailscale serve 5432 missing (the other machines cannot ship spend to the ledger)",
		"FAIL no other device on the tailnet",
		"open https://?:3001",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestLoadedContextReadsTheV1Shape(t *testing.T) {
	if got := loadedContext([]byte(`{"models": [{"key": "k", "loaded_instances": [{"config": {}}]}]}`)); len(got) != 1 || got[0] != "k: loaded=? max=?" {
		t.Fatalf("got %v", got)
	}
	if got := loadedContext([]byte(`{"data": [{"id": "x", "state": "loaded"}]}`)); len(got) != 0 {
		t.Fatalf("the v0 shape is not the v1 one: %v", got)
	}
	if loadedContext([]byte("nope")) != nil {
		t.Fatal("bad json")
	}
}

func TestOfferName(t *testing.T) {
	if (Offer{}).Name() != "" || (Offer{LMStudio: true, GPU: true, Console: true}).Name() != "lmstudio gpu console" {
		t.Fatal("Offer.Name")
	}
	if clip("abcdef", 3) != "abc" || orNone("") != "none" {
		t.Fatal("helpers")
	}
}
