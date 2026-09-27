package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
)

// Checker prints PASS / FAIL lines and keeps them in the check log.
type Checker struct {
	Out   io.Writer
	Color bool
	Log   string // appended to; "" for none
	fails int
	log   []string
}

func (c *Checker) pass(format string, a ...any) { c.line("PASS", "32", fmt.Sprintf(format, a...)) }
func (c *Checker) fail(format string, a ...any) {
	c.fails++
	c.line("FAIL", "31", fmt.Sprintf(format, a...))
}

func (c *Checker) line(word, color, msg string) {
	if c.Color {
		fmt.Fprintf(c.Out, "  \033[%sm%s\033[0m %s\n", color, word, msg)
	} else {
		fmt.Fprintf(c.Out, "  %s %s\n", word, msg)
	}
	c.log = append(c.log, word+" "+msg)
}

// Check probes the home-LLM stack: one real round trip per tier plus the
// plumbing around it. Nothing is inferred from logs or config: every line is
// a request made now. It costs one tiny prompt to `main` (a fraction of a
// cent); `deterministic` is local and free; `complex` only with withComplex.
// The result is the number of FAILs.
func Check(e Env, c *Checker, withComplex bool) int {
	e = e.withDefaults()
	fmt.Fprintf(c.Out, "home-llm check (%s)\n", e.Offer.Name())
	// LiteLLM and the observer's stacks run in Docker: a stopped engine is
	// the one cause behind every failure below, so it is named first
	checkDocker(e, c)
	if e.Offer.LMStudio {
		checkLMStudioModels(e, c)
	}
	key := e.proxyKey()
	if key == "" {
		c.fail("LiteLLM master key unresolved (proxy-key.sh: the OS secret store's litellm-op-token → op read)")
	} else {
		c.pass("LiteLLM master key resolved")
	}
	checkTiers(e, c, key)
	if key != "" {
		// deterministic is the round trip across the tailnet: this machine's
		// LiteLLM → the desktop's llama-server (the roles file's
		// "linuxModelHost"); it fails while the desktop is off.
		ask(e, c, key, "deterministic")
		ask(e, c, key, "main")
		if withComplex {
			ask(e, c, key, "complex")
		}
	}
	checkOmp(e, c, key)
	if e.answers(e.URLs.Decision + "/health") {
		c.pass("jig decision service :4100 answers (skill selection)")
	} else {
		c.fail("jig decision service :4100 not answering — skill selection is off until it is")
	}
	checkMetrics(e, c)
	if e.Offer.Console {
		checkConsole(e, c)
	}
	checkTailnet(e, c)
	fmt.Fprintf(c.Out, "home-llm check: %d FAIL  (log: %s)\n", c.fails, c.Log)
	c.writeLog(e)
	return c.fails
}

func (c *Checker) writeLog(e Env) {
	if c.Log == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(c.Log), 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(c.Log, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "\n== %s %s ==\n%s\nTOTAL %d FAIL\n", e.Now().Format("2006-01-02 15:04:05 MST"), e.Hostname, strings.Join(c.log, "\n"), c.fails)
}

// ids lists "data"[].id of an OpenAI-style model list, sorted.
func ids(body []byte) []string {
	var doc struct {
		Data []struct{ ID string } `json:"data"`
	}
	if json.Unmarshal(body, &doc) != nil {
		return nil
	}
	var out []string
	for _, m := range doc.Data {
		out = append(out, m.ID)
	}
	return out
}

func checkLMStudioModels(e Env, c *Checker) {
	body, ok := e.get(e.URLs.LMStudio+"/v1/models", 5*time.Second)
	models := ids(body)
	if !ok || len(models) == 0 {
		c.fail("LM Studio :1234 does not answer /v1/models (server off, or no model)")
		return
	}
	c.pass("LM Studio :1234 lists: %s", strings.Join(models, " "))
	want := lmStudioFallback(e)
	switch {
	case want == "":
		c.fail("deterministic's LM Studio fallback not found in litellm/config.yaml (a `model: lm_studio/...` line)")
	// LM Studio lists a model once; `<id>@<quant>` picks one of its
	// downloaded variants, so the id before the @ is what must be listed
	case slices.Contains(models, want) || slices.Contains(models, strings.SplitN(want, "@", 2)[0]):
		c.pass("deterministic falls back to LM Studio's %s", want)
	default:
		c.fail("deterministic falls back to %s, which LM Studio does not list — set its entry in harness/policy/models.json to one of the ids above", want)
	}
}

// lmStudioFallback is the LM Studio model id deterministic falls back to:
// the `model: lm_studio/<id>` line of litellm/config.yaml.
func lmStudioFallback(e Env) string {
	b, err := os.ReadFile(e.litellm("config.yaml"))
	if err != nil {
		return ""
	}
	if m := regexp.MustCompile(`(?m)^\s*model: lm_studio/(\S+)\s*$`).FindSubmatch(b); m != nil {
		return string(m[1])
	}
	return ""
}

func hasTiers(tiers []string) bool {
	have := map[string]bool{}
	for _, t := range tiers {
		have[t] = true
	}
	return have["main"] && have["complex"] && have["deterministic"]
}

func checkTiers(e Env, c *Checker, key string) {
	body, ok := e.get(e.URLs.LiteLLM+"/v1/models", 5*time.Second, "Authorization", "Bearer "+key)
	tiers := ids(body)
	sort.Strings(tiers)
	switch {
	case !ok:
		c.fail("LiteLLM :4000 /v1/models does not answer (job down, or wrong key)")
	case hasTiers(tiers):
		c.pass("LiteLLM :4000 tiers: %s", strings.Join(tiers, " "))
	default:
		c.fail("LiteLLM :4000 tiers incomplete: %s", orNone(strings.Join(tiers, " ")))
	}
}

func orNone(s string) string {
	if s == "" {
		return "none"
	}
	return s
}

// ask sends one short completion to a tier and reports reply and wall time.
func ask(e Env, c *Checker, key, tier string) {
	payload, _ := json.Marshal(map[string]any{
		"model":      tier,
		"messages":   []map[string]string{{"role": "user", "content": "Reply with the single word: pong"}},
		"max_tokens": 64,
	})
	req, err := http.NewRequest(http.MethodPost, e.URLs.LiteLLM+"/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		c.fail("tier %s: %v", tier, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "home-llm-check")
	client := *e.HTTP
	client.Timeout = 120 * time.Second
	start := e.Now()
	resp, err := client.Do(req)
	if err != nil {
		c.fail("tier %s: no completion — %v", tier, err)
		return
	}
	defer resp.Body.Close()
	body, _ := readAll(resp)
	elapsed := e.Now().Sub(start)
	var doc struct {
		Model   string
		Choices []struct {
			Message struct{ Content string }
		}
	}
	if json.Unmarshal(body, &doc) != nil || len(doc.Choices) == 0 {
		c.fail("tier %s: no completion — %s", tier, clip(string(body), 200))
		return
	}
	reply := clip(strings.ReplaceAll(strings.TrimSpace(doc.Choices[0].Message.Content), "\n", " "), 60)
	model := doc.Model
	if model == "" {
		model = "?"
	}
	c.pass("tier %s: \"%s  [%s]\" in %.1fs", tier, reply, model, elapsed.Seconds())
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// proxyModels collects the ids of every object with provider "proxy".
func proxyModels(v any, into map[string]bool) {
	switch o := v.(type) {
	case map[string]any:
		if o["provider"] == "proxy" {
			if id, ok := o["id"].(string); ok {
				into[id] = true
			}
		}
		for _, x := range o {
			proxyModels(x, into)
		}
	case []any:
		for _, x := range o {
			proxyModels(x, into)
		}
	}
}

func checkOmp(e Env, c *Checker, key string) {
	if key == "" || !e.Sys.Has("omp") {
		return
	}
	out, _, _ := e.Sys.Exec(sys.Cmd{Name: "omp", Args: []string{"models", "ls", "--json"}, Env: []string{"LITELLM_API_KEY=" + key}, Timeout: 30 * time.Second})
	var doc any
	seen := map[string]bool{}
	if json.Unmarshal([]byte(out), &doc) == nil {
		proxyModels(doc, seen)
	}
	var list []string
	for id := range seen {
		list = append(list, id)
	}
	sort.Strings(list)
	if hasTiers(list) {
		c.pass("omp lists the proxy tiers: %s", strings.Join(list, " "))
	} else {
		c.fail("omp does not list proxy/{main,complex,deterministic} (models.yml provider, or key) — got: %s", orNone(strings.Join(list, " ")))
	}
}

// The dedicated listener's documented probes are /health and /metrics/ with
// the trailing slash (https://docs.litellm.ai/docs/proxy/prometheus).
func checkMetrics(e Env, c *Checker) {
	health, ok := e.get(e.URLs.Metrics+"/health", 5*time.Second)
	if !ok || !strings.Contains(string(health), "healthy") {
		c.fail("LiteLLM :4001 metrics listener not answering /health")
		return
	}
	metrics, _ := e.get(e.URLs.Metrics+"/metrics/", 5*time.Second)
	series := 0
	for _, l := range strings.Split(string(metrics), "\n") {
		if strings.HasPrefix(l, "litellm_") {
			series++
		}
	}
	c.pass("LiteLLM :4001 metrics listener healthy (%d litellm_* series)", series)
}

// litellmTarget is Prometheus's "health scrapeUrl" for the litellm job; ""
// when Prometheus does not answer or has no such target.
func litellmTarget(e Env) string {
	body, ok := e.get(e.URLs.Prometheus+"/api/v1/targets", 5*time.Second)
	if !ok {
		return ""
	}
	var doc struct {
		Data struct {
			ActiveTargets []struct {
				Labels    map[string]string
				Health    string
				ScrapeURL string `json:"scrapeUrl"`
			} `json:"activeTargets"`
		}
	}
	if json.Unmarshal(body, &doc) != nil {
		return ""
	}
	for _, t := range doc.Data.ActiveTargets {
		if t.Labels["job"] == "litellm" {
			return t.Health + " " + t.ScrapeURL
		}
	}
	return ""
}

func checkConsole(e Env, c *Checker) {
	// LiteLLM was just restarted; Prometheus's last scrape may have hit the
	// gap. Give it a few scrape intervals before calling the target down.
	health := ""
	for i := 0; i < 12; i++ {
		health = litellmTarget(e)
		if health == "" || strings.HasPrefix(health, "up") {
			break
		}
		e.Sleep(5 * time.Second)
	}
	switch {
	case strings.HasPrefix(health, "up"):
		c.pass("Prometheus scrapes litellm: %s", health)
	case health == "":
		c.fail("Prometheus :9090 not answering, or no litellm target (observability/start.sh)")
	default:
		c.fail("Prometheus litellm target: %s", health)
	}
	if e.answers(e.URLs.Grafana + "/api/health") {
		c.pass("Grafana :3000 answers")
	} else {
		c.fail("Grafana :3000 not answering (observability/start.sh --ui)")
	}
	// A fresh Open WebUI (new data volume) takes tens of seconds to answer.
	if e.waitFor(e.URLs.OpenWebUI + "/") {
		c.pass("Open WebUI :3001 answers")
	} else {
		c.fail("Open WebUI :3001 not answering within 2 min (docker logs litellm-open-webui)")
	}
}

func checkTailnet(e Env, c *Checker) {
	ts := e.tailscale()
	if ts == "" {
		c.fail("tailscale CLI not found")
		return
	}
	serve, _, _ := e.run(10*time.Second, ts, "serve", "status")
	st := e.status(ts)
	name := strings.TrimSuffix(st.Self.DNSName, ".")
	if name == "" {
		name = "?"
	}
	served := func(port, what, fix string) {
		if strings.Contains(serve, ":"+port) {
			c.pass("tailscale serve %s (%s) → %s:%s", port, what, name, port)
		} else {
			c.fail("tailscale serve %s missing%s", port, fix)
		}
	}
	if e.Offer.LMStudio {
		served("1234", "LM Studio", "")
	}
	if e.Offer.GPU {
		served("8080", "llama-server", "")
	}
	if !e.Offer.Console {
		served("4001", "metrics", "")
		return
	}
	served("5432", "cost ledger", " (the other machines cannot ship spend to the ledger)")
	served("3001", "Open WebUI", " (HTTPS certificates enabled in the admin console?)")
	var peers []string
	for _, p := range st.Peer {
		peers = append(peers, fmt.Sprintf("%s (%s)", p.HostName, p.OS))
	}
	sort.Strings(peers)
	if len(peers) > 0 {
		c.pass("tailnet devices besides this machine: %s", strings.Join(peers, ", "))
	} else {
		c.fail("no other device on the tailnet — the phone has not joined (Tailscale app, same account, switched on)")
	}
	fmt.Fprintf(c.Out, "       from the phone (on the tailnet): open https://%s:3001 — that is the one check only another device can make\n", name)
}

func checkDocker(e Env, c *Checker) {
	_, errOut, err := e.run(20*time.Second, "docker", "info")
	switch {
	case err == nil:
		c.pass("Docker engine answers")
	case strings.Contains(errOut, "permission denied"):
		c.fail("Docker refuses this user (not in the docker group): omarchy-setup-security-sudoless-docker, then log in again")
	default:
		c.fail("Docker engine not answering (macOS: start OrbStack; Linux: systemctl start docker.socket) — everything in containers below fails with it")
	}
}
