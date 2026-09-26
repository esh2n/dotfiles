package llm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func contains(list []string, sub string) bool {
	for _, s := range list {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func TestSetupServesWhatTheOfferNames(t *testing.T) {
	cases := []struct {
		offer     Offer
		want, not []string
	}{
		{Offer{LMStudio: true, Console: true},
			[]string{"tailscale serve --bg --tcp 1234 tcp://127.0.0.1:1234", "tailscale serve --bg --https=3001 127.0.0.1:3001", "tailscale serve --bg --tcp 5432 tcp://127.0.0.1:5432"},
			[]string{"tailscale serve --bg --tcp 4001"}},
		{Offer{}, []string{"tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001"}, []string{"tailscale serve --bg --tcp 1234", "tailscale serve --bg --tcp 5432", "tailscale serve --bg --https"}},
		{Offer{GPU: true}, []string{"tailscale serve --bg --tcp 8080 tcp://127.0.0.1:8080", "tailscale serve --bg --tcp 4001"}, []string{"tailscale serve --bg --tcp 5432"}},
	}
	for _, c := range cases {
		w := newWorld(t, "darwin", c.offer)
		w.running()
		Setup(w.env, nil)
		for _, p := range c.want {
			if !w.sys.ran(p) {
				t.Errorf("%+v: %q not run; calls %v", c.offer, p, w.sys.calls)
			}
		}
		for _, p := range c.not {
			if w.sys.ran(p) {
				t.Errorf("%+v: %q run", c.offer, p)
			}
		}
	}
}

func TestSetupWithoutTailscaleOrLoggedOutServesNothing(t *testing.T) {
	w := newWorld(t, "linux", Offer{Console: true})
	todo := Setup(w.env, nil)
	if !contains(todo, "Tailscale is not installed") || w.sys.ran("tailscale serve") {
		t.Fatalf("todo %v", todo)
	}
	w = newWorld(t, "darwin", Offer{LMStudio: true})
	w.sys.have["tailscale"] = true
	w.sys.outputs["tailscale status --json"] = `{"BackendState": "NeedsLogin"}`
	todo = Setup(w.env, nil)
	if !contains(todo, "Tailscale: log in") || w.sys.ran("tailscale serve") || !w.sys.ran("open -a Tailscale") {
		t.Fatalf("todo %v calls %v", todo, w.sys.calls)
	}
	w.sys.fail["tailscale serve"] = true
	w.running()
	if todo = Setup(w.env, nil); !contains(todo, "tailscale serve [--tcp 1234") {
		t.Fatalf("a failed serve is not listed: %v", todo)
	}
}

func TestSetupConsoleStartsStacksLedgerAndOpenWebUIWithTheKey(t *testing.T) {
	w := newWorld(t, "darwin", Offer{Console: true})
	w.sys.outputs[w.env.litellm("proxy-key.sh")] = "the-key\n"
	Setup(w.env, nil)
	if !w.sys.ran("bash " + w.env.litellm("observability", "start.sh") + " --ui") {
		t.Fatalf("stacks not started: %v", w.sys.calls)
	}
	psql := "docker exec -i litellm-db psql -q -U litellm -d litellm -v ON_ERROR_STOP=1"
	if w.sys.stdin[psql] != "CREATE TABLE x;" {
		t.Fatalf("ledger.sql not fed to psql: %v", w.sys.stdin)
	}
	compose := "docker compose -f " + w.env.litellm("observability", "docker-compose.yml") + " --profile webui up -d open-webui"
	if env := w.sys.env[compose]; len(env) != 1 || env[0] != "LITELLM_API_KEY=the-key" {
		t.Fatalf("compose env %v (calls %v)", env, w.sys.calls)
	}
}

func TestSetupConsoleReportsWhatItCouldNotDo(t *testing.T) {
	w := newWorld(t, "darwin", Offer{Console: true})
	w.sys.fail["docker info"] = true
	if todo := Setup(w.env, nil); !contains(todo, "docker is not answering") || w.sys.ran("docker compose") {
		t.Fatalf("todo %v", todo)
	}
	w = newWorld(t, "darwin", Offer{Console: true})
	w.sys.fail["docker inspect litellm-db"] = true
	w.sys.fail[w.env.litellm("proxy-key.sh")] = true
	todo := Setup(w.env, nil)
	if !contains(todo, "no litellm-db container") || !contains(todo, "the LiteLLM key did not resolve") {
		t.Fatalf("todo %v", todo)
	}
}

func TestSetupWithoutAnOfferStartsNoStacksAndNoLMStudio(t *testing.T) {
	w := newWorld(t, "darwin", Offer{}, "lms")
	Setup(w.env, nil)
	if w.sys.ran("bash "+w.env.litellm("observability")) || w.sys.ran("lms") || w.sys.ran("docker") {
		t.Fatalf("calls %v", w.sys.calls)
	}
}

func TestSetupStartsLMStudiosServerWhenItDoesNotAnswer(t *testing.T) {
	w := newWorld(t, "darwin", Offer{LMStudio: true}, "lms")
	todo := Setup(w.env, nil)
	if !w.sys.ran("lms server start --port 1234") || !contains(todo, "LM Studio: open the app once") {
		t.Fatalf("todo %v calls %v", todo, w.sys.calls)
	}
	if !strings.HasPrefix(os.Getenv("PATH"), filepath.Join(w.home, ".lmstudio", "bin")) {
		t.Fatal("LM Studio's CLI directory is not on PATH")
	}
	w = newWorld(t, "darwin", Offer{LMStudio: true}, "lms")
	w.svc.set("/lms/v1/models", `{"data": []}`)
	Setup(w.env, nil)
	if w.sys.ran("lms") {
		t.Fatal("started a server that already answers")
	}
}

func TestSetupReloadsLiteLLMOnBothPlatforms(t *testing.T) {
	w := newWorld(t, "darwin", Offer{LMStudio: true})
	w.sys.fail["launchctl print"] = true // not loaded
	Setup(w.env, nil)
	plist := filepath.Join(w.home, "Library", "LaunchAgents", "com.esh2n.litellm-proxy.plist")
	if !w.sys.ran("launchctl bootstrap gui/501 "+plist) || w.sys.ran("launchctl bootout") {
		t.Fatalf("calls %v", w.sys.calls)
	}
	w = newWorld(t, "linux", Offer{})
	Setup(w.env, nil)
	if !w.sys.ran("systemctl --user restart litellm-proxy.service") {
		t.Fatalf("calls %v", w.sys.calls)
	}
}

func TestSetupBootsOutALoadedJobAndWaitsBeforeBootstrap(t *testing.T) {
	w := newWorld(t, "darwin", Offer{LMStudio: true})
	booted, prints := false, 0
	w.sys.onExec = func(line string) (bool, error) {
		switch {
		case strings.HasPrefix(line, "launchctl bootout"):
			booted = true
		case strings.HasPrefix(line, "launchctl print"):
			prints++
			if booted && prints > 2 { // gone one look after bootout returned
				return true, errFake
			}
			return true, nil
		}
		return false, nil
	}
	Setup(w.env, nil)
	out, in := w.sys.index("launchctl bootout"), w.sys.index("launchctl bootstrap")
	if out < 0 || in < out || w.sys.count("launchctl print") < 3 {
		t.Fatalf("calls %v", w.sys.calls)
	}
}

func TestSetupLeavesLiteLLMAloneWithoutTheOpToken(t *testing.T) {
	w := newWorld(t, "darwin", Offer{})
	w.sys.fail["security find-generic-password"] = true
	todo := Setup(w.env, nil)
	if w.sys.ran("launchctl") || !contains(todo, "service-account token") {
		t.Fatalf("todo %v calls %v", todo, w.sys.calls)
	}
	w = newWorld(t, "linux", Offer{})
	w.sys.fail["secret-tool lookup"] = true
	if todo = Setup(w.env, nil); w.sys.ran("systemctl") || !contains(todo, "service-account token") {
		t.Fatalf("linux: todo %v", todo)
	}
}

func TestSetupPassesTheLMStudioMachineToLiteLLM(t *testing.T) {
	w := newWorld(t, "darwin", Offer{})
	w.env.Getenv = func(k string) string {
		if k == "LM_STUDIO_REMOTE_HOST" {
			return "mac.example.ts.net"
		}
		return ""
	}
	todo := Setup(w.env, nil)
	if !w.sys.ran("launchctl setenv LM_STUDIO_REMOTE_HOST mac.example.ts.net") || contains(todo, "name the machine serving LM Studio") {
		t.Fatalf("todo %v calls %v", todo, w.sys.calls)
	}
	w = newWorld(t, "linux", Offer{})
	w.env.Getenv = func(string) string { return "" }
	if todo = Setup(w.env, nil); !contains(todo, "name the machine serving LM Studio") {
		t.Fatalf("todo %v", todo)
	}
}

func TestSetupWaitsForLiteLLMAndRunsTheCheckLast(t *testing.T) {
	w := newWorld(t, "linux", Offer{})
	w.svc.set("/litellm/health/liveliness", "ok")
	var calledAt int
	todo := Setup(w.env, func(Env) int { calledAt = len(w.sys.calls); return 2 })
	if !strings.Contains(w.out.String(), "LiteLLM answers on "+w.env.URLs.LiteLLM+"/health/liveliness") {
		t.Fatalf("stdout %q", w.out.String())
	}
	if !contains(todo, "/metrics not answering after two minutes") || !contains(todo, "check reported failing lines") {
		t.Fatalf("todo %v", todo)
	}
	if calledAt != len(w.sys.calls) {
		t.Fatal("the check did not run last")
	}
}

func TestSetupReportsFailedRestartsAndLedgerTable(t *testing.T) {
	w := newWorld(t, "linux", Offer{Console: true})
	w.sys.fail["systemctl --user restart"] = true
	w.sys.fail["docker exec -i litellm-db"] = true
	w.sys.fail["bash "+w.env.litellm("observability", "start.sh")] = true
	todo := Setup(w.env, nil)
	for _, want := range []string{"systemctl --user restart litellm-proxy failed", "could not create its table", "start.sh --ui failed"} {
		if !contains(todo, want) {
			t.Errorf("missing %q in %v", want, todo)
		}
	}
	w = newWorld(t, "darwin", Offer{LMStudio: true})
	w.sys.fail["launchctl"] = true
	if todo = Setup(w.env, nil); !contains(todo, "launchctl bootstrap failed") {
		t.Fatalf("todo %v", todo)
	}
}
