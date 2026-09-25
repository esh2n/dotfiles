package llm

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/sys"
)

// Setup brings this machine to the home-LLM rulings, running only the steps
// that are commands (the services themselves are declared: next/roles,
// mk-service). Nothing here fails the switch: what cannot be done now is
// returned as a to-do list, with what to do. The check runs last; its
// failures are one more to-do.
//
//	LMStudio: LM Studio's server, tailscale serve 1234
//	GPU     : tailscale serve 8080 (llama-server, Linux)
//	Console : Prometheus + Grafana + Open WebUI, the cost ledger's table,
//	          tailscale serve https 3001 and tcp 5432 (the ledger); without
//	          it, tailscale serve 4001 so the console can scrape this
//	          machine's LiteLLM metrics
//	always  : LiteLLM restarted onto the current config
func Setup(e Env, check func(Env) int) []string {
	e = e.withDefaults()
	// LM Studio installs its CLI here; activation does not read the shell's rc.
	_ = os.Setenv("PATH", filepath.Join(e.Home, ".lmstudio", "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
	var todo []string
	add := func(format string, a ...any) { todo = append(todo, fmt.Sprintf(format, a...)) }

	serveTailnet(e, add)
	if e.Offer.LMStudio {
		lmStudio(e, add)
	}
	restartLiteLLM(e, add)
	if e.Offer.Console {
		consoleStacks(e, add)
	}
	if check != nil && check(e) > 0 {
		add("the home-llm check reported failing lines above")
	}
	return todo
}

func serveTailnet(e Env, add func(string, ...any)) {
	ts := e.tailscale()
	if ts == "" {
		add("Tailscale is not installed (macOS: the tailscale-app cask; Linux: https://tailscale.com/download/linux)")
		return
	}
	// On a fresh Mac the CLI waits for a backend the app has not started yet.
	if e.Sys.OS() == "darwin" {
		_, _, _ = e.run(10*time.Second, "open", "-a", "Tailscale")
	}
	if e.status(ts).BackendState != "Running" {
		add("Tailscale: log in (macOS: the menu-bar app; Linux: sudo tailscale up), then make up for the serve steps")
		return
	}
	serve := func(args ...string) {
		if _, errOut, err := e.run(20*time.Second, ts, append([]string{"serve", "--bg"}, args...)...); err != nil {
			add("tailscale serve %v failed: %v %s", args, err, errOut)
		}
	}
	if e.Offer.LMStudio {
		serve("--tcp", "1234", "tcp://127.0.0.1:1234")
	}
	if e.Offer.GPU {
		serve("--tcp", "8080", "tcp://127.0.0.1:8080")
	}
	if e.Offer.Console {
		serve("--https=3001", "127.0.0.1:3001")
		serve("--tcp", "5432", "tcp://127.0.0.1:5432") // the cost ledger, for the other machines' sync
	} else {
		serve("--tcp", "4001", "tcp://127.0.0.1:4001")
	}
}

func lmStudio(e Env, add func(string, ...any)) {
	models := e.URLs.LMStudio + "/v1/models"
	if e.answers(models) {
		return
	}
	if e.Sys.Has("lms") {
		_, _, _ = e.run(30*time.Second, "lms", "server", "start", "--port", "1234")
		e.Sleep(3 * time.Second)
		if e.answers(models) {
			return
		}
	}
	add("LM Studio: open the app once, Settings → 'run the LLM server on login', network 'localhost only'; then make up")
}

func hasOpToken(e Env) bool {
	var err error
	if e.Sys.OS() == "darwin" {
		_, _, err = e.run(10*time.Second, "security", "find-generic-password", "-s", "litellm-op-token")
	} else {
		_, _, err = e.run(10*time.Second, "secret-tool", "lookup", "service", "litellm-op-token")
	}
	return err == nil
}

const litellmJob = "com.esh2n.litellm-proxy"

func restartLiteLLM(e Env, add func(string, ...any)) {
	if !hasOpToken(e) {
		add("LiteLLM: store the 1Password service-account token once (next/home/shared/litellm/config/secrets.sh names the command for this OS), then make up")
		return
	}
	remote := e.Getenv("LM_STUDIO_REMOTE_HOST")
	if e.Sys.OS() == "darwin" {
		if !e.Offer.LMStudio && remote != "" {
			_, _, _ = e.run(10*time.Second, "launchctl", "setenv", "LM_STUDIO_REMOTE_HOST", remote)
		}
		reloadLaunchd(e, add)
	} else {
		if !e.Offer.LMStudio && remote != "" {
			_, _, _ = e.run(10*time.Second, "systemctl", "--user", "set-environment", "LM_STUDIO_REMOTE_HOST="+remote)
		}
		if _, errOut, err := e.run(60*time.Second, "systemctl", "--user", "restart", "litellm-proxy.service"); err != nil {
			add("LiteLLM: systemctl --user restart litellm-proxy failed: %s", errOut)
		}
	}
	if !e.Offer.LMStudio && remote == "" {
		add("LiteLLM: name the machine serving LM Studio once — LM_STUDIO_REMOTE_HOST=<mac.tailnet.ts.net> make up")
	}
	for _, url := range []string{e.URLs.LiteLLM + "/health/liveliness", e.URLs.Metrics + "/metrics"} {
		if e.waitFor(url) {
			e.UI.Note("LiteLLM answers on %s", url)
		} else {
			add("LiteLLM: %s not answering after two minutes (see its log)", url)
		}
	}
}

// reloadLaunchd loads LiteLLM's job from the current plist. A job loaded by
// an earlier layout (or an older plist) is booted out first. bootout returns
// before the job is gone, and bootstrapping then fails with "Input/output
// error" (code 5), so wait until launchd no longer has it.
func reloadLaunchd(e Env, add func(string, ...any)) {
	domain := "gui/" + strconv.Itoa(e.UID)
	loaded := func() bool {
		_, _, err := e.run(10*time.Second, "launchctl", "print", domain+"/"+litellmJob)
		return err == nil
	}
	if loaded() {
		_, _, _ = e.run(30*time.Second, "launchctl", "bootout", domain+"/"+litellmJob)
		for i := 0; i < 40 && loaded(); i++ {
			e.Sleep(500 * time.Millisecond)
		}
	}
	plist := filepath.Join(e.Home, "Library", "LaunchAgents", litellmJob+".plist")
	if _, errOut, err := e.run(30*time.Second, "launchctl", "bootstrap", domain, plist); err != nil {
		add("LiteLLM: launchctl bootstrap failed: %s", errOut)
	}
}

func consoleStacks(e Env, add func(string, ...any)) {
	if _, _, err := e.run(20*time.Second, "docker", "info"); err != nil {
		add("docker is not answering (start OrbStack), then make up for Prometheus / Grafana / Open WebUI")
		return
	}
	if _, errOut, err := e.run(10*time.Minute, "bash", e.litellm("observability", "start.sh"), "--ui"); err != nil {
		add("observability/start.sh --ui failed: %s", errOut)
	}
	ledgerTable(e, add)
	key := e.proxyKey()
	if key == "" {
		add("Open WebUI: the LiteLLM key did not resolve (litellm/proxy-key.sh); not started")
		return
	}
	_, errOut, err := e.Sys.Exec(sys.Cmd{
		Name:    "docker",
		Args:    []string{"compose", "-f", e.litellm("observability", "docker-compose.yml"), "--profile", "webui", "up", "-d", "open-webui"},
		Env:     []string{"LITELLM_API_KEY=" + key},
		Timeout: 10 * time.Minute,
	})
	if err != nil {
		add("Open WebUI: docker compose --profile webui up -d open-webui failed: %s", errOut)
	}
}

// ledgerTable creates the ledger's own table beside LiteLLM's (idempotent).
func ledgerTable(e Env, add func(string, ...any)) {
	if _, _, err := e.run(20*time.Second, "docker", "inspect", "litellm-db"); err != nil {
		add("cost ledger: no litellm-db container yet (store op://llm-automation/litellm-db/password, then make up)")
		return
	}
	sql, err := os.Open(filepath.Join(e.Repo, "next", "home", "shared", "llm-ledger", "ledger.sql"))
	if err != nil {
		add("cost ledger: %v", err)
		return
	}
	defer sql.Close()
	_, errOut, err := e.Sys.Exec(sys.Cmd{
		Name:    "docker",
		Args:    []string{"exec", "-i", "litellm-db", "psql", "-q", "-U", "litellm", "-d", "litellm", "-v", "ON_ERROR_STOP=1"},
		Stdin:   sql,
		Timeout: 60 * time.Second,
	})
	if err != nil {
		add("cost ledger: could not create its table (docker exec litellm-db psql): %s", errOut)
	}
}
