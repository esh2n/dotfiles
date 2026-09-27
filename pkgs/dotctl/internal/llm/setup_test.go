package llm

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestSetupFetchesTheListedModelsOnceAndChecksTheirHash(t *testing.T) {
	w := newWorld(t, "linux", Offer{GPU: true})
	body := []byte("gguf bytes")
	sum := sha256.Sum256(body)
	list := fmt.Sprintf(`{"models": [{"file": "m.gguf", "url": "https://example.test/m.gguf", "size": %d, "sha256": %q}]}`, len(body), hex.EncodeToString(sum[:]))
	write(t, filepath.Join(w.env.Repo, "home", "linux", "llama-server", "models.json"), list)
	part := filepath.Join(w.env.Home, "models", "m.gguf.part")
	w.sys.onExec = func(line string) (bool, error) {
		if strings.HasPrefix(line, "curl ") {
			return true, os.WriteFile(part, body, 0o644)
		}
		return false, nil
	}
	if todo := Setup(w.env, nil); contains(todo, "llama-server model") {
		t.Fatalf("todo %v", todo)
	}
	if got, err := os.ReadFile(filepath.Join(w.env.Home, "models", "m.gguf")); err != nil || string(got) != string(body) {
		t.Fatalf("model not in place: %q %v", got, err)
	}
	if !w.sys.ran("curl -fL --retry 3 -C - -o " + part + " https://example.test/m.gguf") {
		t.Fatalf("calls %v", w.sys.calls)
	}
	w.sys.calls = nil
	Setup(w.env, nil)
	if w.sys.ran("curl ") {
		t.Fatal("a model of the listed size is fetched again")
	}
}

func TestSetupReportsDownloadProgress(t *testing.T) {
	w := newWorld(t, "linux", Offer{GPU: true})
	body := []byte("0123456789")
	sum := sha256.Sum256(body)
	write(t, filepath.Join(w.env.Repo, "home", "linux", "llama-server", "models.json"),
		fmt.Sprintf(`{"models": [{"file": "m.gguf", "url": "https://example.test/m.gguf", "size": %d, "sha256": %q}]}`, len(body), hex.EncodeToString(sum[:])))
	part := filepath.Join(w.env.Home, "models", "m.gguf.part")
	defer func(d time.Duration) { progressEvery = d }(progressEvery)
	progressEvery = time.Millisecond
	w.sys.onExec = func(line string) (bool, error) {
		if !strings.HasPrefix(line, "curl ") {
			return false, nil
		}
		if err := os.WriteFile(part, body[:5], 0o644); err != nil {
			return true, err
		}
		time.Sleep(50 * time.Millisecond)
		return true, os.WriteFile(part, body, 0o644)
	}
	Setup(w.env, nil)
	if !strings.Contains(w.out.String(), "m.gguf: 0.0 / 0.0 GB (50%)") {
		t.Fatalf("no progress line:\n%s", w.out.String())
	}
}

func TestSetupRemovesADownloadWhoseHashDiffers(t *testing.T) {
	w := newWorld(t, "linux", Offer{GPU: true})
	write(t, filepath.Join(w.env.Repo, "home", "linux", "llama-server", "models.json"),
		`{"models": [{"file": "m.gguf", "url": "https://example.test/m.gguf", "size": 5, "sha256": "`+strings.Repeat("0", 64)+`"}]}`)
	part := filepath.Join(w.env.Home, "models", "m.gguf.part")
	w.sys.onExec = func(line string) (bool, error) {
		if strings.HasPrefix(line, "curl ") {
			return true, os.WriteFile(part, []byte("wrong"), 0o644)
		}
		return false, nil
	}
	if todo := Setup(w.env, nil); !contains(todo, "the download was removed") {
		t.Fatalf("todo %v", todo)
	}
	if _, err := os.Stat(part); !os.IsNotExist(err) {
		t.Fatal("a download with the wrong hash is kept")
	}
	if _, err := os.Stat(filepath.Join(w.env.Home, "models", "m.gguf")); !os.IsNotExist(err) {
		t.Fatal("a download with the wrong hash is put in place")
	}
}

func TestModelListRejectsWhatIsNotAPinnedGGUF(t *testing.T) {
	dir := t.TempDir()
	for _, bad := range []string{
		`{"models": [{"file": "../x.gguf", "url": "https://h/x", "size": 1, "sha256": "` + strings.Repeat("a", 64) + `"}]}`,
		`{"models": [{"file": "x.bin", "url": "https://h/x", "size": 1, "sha256": "` + strings.Repeat("a", 64) + `"}]}`,
		`{"models": [{"file": "x.gguf", "url": "http://h/x", "size": 1, "sha256": "` + strings.Repeat("a", 64) + `"}]}`,
		`{"models": [{"file": "x.gguf", "url": "https://h/x", "size": 1, "sha256": "short"}]}`,
	} {
		p := filepath.Join(dir, "models.json")
		write(t, p, bad)
		if _, err := readModelList(p); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestTheRepositorysModelListIsValid(t *testing.T) {
	list, err := readModelList(filepath.Join("..", "..", "..", "..", "home", "linux", "llama-server", "models.json"))
	if err != nil || len(list) == 0 {
		t.Fatalf("%v %v", list, err)
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

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
