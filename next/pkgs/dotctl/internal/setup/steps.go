package setup

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// User-scoped MCP servers live in ~/.claude.json, which only `claude mcp add`
// writes. jig prints one such line per server; the ones not registered yet
// are run. What is registered is read from ~/.claude.json itself: `claude mcp
// list` connects to every server first, and under activation's time limit it
// can return nothing, which made every add fail as "already exists".
func claudeMCP(e Env) error {
	if !e.need("claude") || !e.need("bun") {
		return nil
	}
	registered := mcpServers(e.path(".claude.json"))
	jig, _, _ := e.Sys.Capture(0, "bash", filepath.Join(e.Repo, "domains", "dev", "bin", "jig"), "apply", "--target", "claude")
	for _, line := range mcpAddLines(jig) {
		name := mcpName(line)
		if name == "" || registered[name] {
			continue
		}
		e.UI.Note("registering %s", name)
		out, errOut, err := e.Sys.Capture(60*time.Second, "bash", "-c", line)
		if err != nil {
			e.UI.Warn("failed: %s: %v: %s", line, err, strings.TrimSpace(out+errOut))
		}
	}
	return nil
}

// mcpServers names the servers ~/.claude.json has; none when it is missing
// or unreadable.
func mcpServers(file string) map[string]bool {
	var doc struct {
		MCPServers map[string]json.RawMessage `json:"mcpServers"`
	}
	b, err := os.ReadFile(file)
	names := map[string]bool{}
	if err != nil || json.Unmarshal(b, &doc) != nil {
		return names
	}
	for n := range doc.MCPServers {
		names[n] = true
	}
	return names
}

// mcpAddLines picks jig's "  claude mcp add ..." lines out of its report.
func mcpAddLines(report string) []string {
	var lines []string
	for _, l := range strings.Split(report, "\n") {
		if strings.HasPrefix(l, "  claude mcp add ") {
			lines = append(lines, strings.TrimPrefix(l, "  "))
		}
	}
	return lines
}

// mcpName is the server a `claude mcp add --scope <scope> <name> ...` line
// adds ("" when the line has no --scope).
func mcpName(line string) string {
	f := strings.Fields(line)
	for i, w := range f {
		if w == "--scope" && i+2 < len(f) {
			return f[i+2]
		}
	}
	return ""
}

var emailLine = regexp.MustCompile(`(?m)^[ \t]*email[ \t]*=`)

// ~/.config/git/config.local (included by ~/.gitconfig) holds who commits.
// Values come from the environment or the checkout's untracked .env.
func gitIdentity(e Env) error {
	out := e.path(".config", "git", "config.local")
	if b, err := os.ReadFile(out); err == nil && emailLine.Match(b) {
		return nil
	}
	name, email := e.Getenv("GIT_USER_NAME"), e.Getenv("GIT_USER_EMAIL")
	if env, err := os.ReadFile(filepath.Join(e.Repo, ".env")); err == nil {
		if name == "" {
			name = lastValue(string(env), "GIT_USER_NAME")
		}
		if email == "" {
			email = lastValue(string(env), "GIT_USER_EMAIL")
		}
	}
	if name == "" || email == "" {
		e.UI.Warn("no identity: put GIT_USER_NAME and GIT_USER_EMAIL in %s (or write %s)", filepath.Join(e.Repo, ".env"), out)
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return err
	}
	body := fmt.Sprintf("# Machine-specific git identity (not tracked).\n[user]\n    name = %s\n    email = %s\n", name, email)
	return os.WriteFile(out, []byte(body), 0o644)
}

// lastValue is the last KEY=value in a .env file's text.
func lastValue(text, key string) string {
	v := ""
	for _, l := range strings.Split(text, "\n") {
		if rest, ok := strings.CutPrefix(l, key+"="); ok {
			v = rest
		}
	}
	return v
}

var (
	luaVersion   = regexp.MustCompile(`(?m)^Lua (\d+\.\d+)`)
	builtVersion = regexp.MustCompile(`LuaVersion: Lua (\d+\.\d+)`)
)

const orphanCheck = "if (getppid() == 1) exit(0);"

// SbarLua (sketchybar's Lua module; not on luarocks) built from source into
// ~/.local/share/sketchybar_lua. It vendors Lua and only loads in an
// interpreter of the same major.minor (a mismatch is an empty bar, no error),
// so it is rebuilt whenever the running Lua changes.
func sbarlua(e Env) error {
	useMiseEnv(e)
	if !e.need("lua") {
		return nil
	}
	target := e.path(".local", "share", "sketchybar_lua", "sketchybar.so")
	src := e.path(".cache", "sbarlua")
	out, errOut, _ := e.Sys.Capture(0, "lua", "-v")
	host := firstGroup(luaVersion, out+errOut)
	if b, err := os.ReadFile(target); err == nil {
		built := firstGroup(builtVersion, string(b))
		if built != "" && built == host {
			return nil
		}
		e.UI.Note("built for Lua %s, lua is %s: rebuilding", orUnknown(built), host)
	}
	if !e.need("git") || !e.need("make") {
		return nil
	}
	if err := fetchSbarLua(e, src); err != nil {
		return err
	}
	// Under launchd the lua process's parent is PID 1 at once, and SbarLua's
	// orphan check exits ~1s after start: subscribed callbacks never fire.
	c := filepath.Join(src, "src", "sketchybar.c")
	if b, err := os.ReadFile(c); err == nil && strings.Contains(string(b), orphanCheck) {
		patched := strings.Replace(string(b), orphanCheck, "/* orphan_check disabled for launchd compatibility */", 1)
		if err := os.WriteFile(c, []byte(patched), 0o644); err != nil {
			return err
		}
	}
	_, _, _ = e.Sys.Capture(0, "make", "-C", src, "clean")
	if err := e.Sys.Run(nil, "make", "-C", src, "install"); err != nil {
		return err
	}
	if !exists(target) {
		return fmt.Errorf("make install finished but %s is missing", target)
	}
	return nil
}

func fetchSbarLua(e Env, src string) error {
	if exists(filepath.Join(src, ".git")) {
		if err := e.Sys.Run(nil, "git", "-C", src, "fetch", "--depth", "1", "origin"); err != nil {
			return err
		}
		return e.Sys.Run(nil, "git", "-C", src, "reset", "--hard", "origin/HEAD")
	}
	if err := os.RemoveAll(src); err != nil {
		return err
	}
	return e.Sys.Run(nil, "git", "clone", "--depth", "1", "https://github.com/FelixKratz/SbarLua", src)
}

// useMiseEnv puts mise's tools (lua among them) on this process's PATH, as
// a shell with mise activated would have them. Without mise nothing changes.
func useMiseEnv(e Env) {
	if !e.Sys.Has("mise") {
		return
	}
	out, _, err := e.Sys.Capture(0, "mise", "env", "--json")
	if err != nil {
		return
	}
	var env map[string]string
	if json.Unmarshal([]byte(out), &env) != nil {
		return
	}
	for k, v := range env {
		_ = os.Setenv(k, v)
	}
}

func firstGroup(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

func orUnknown(s string) string {
	if s == "" {
		return "unknown"
	}
	return s
}
