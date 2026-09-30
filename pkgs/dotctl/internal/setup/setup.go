// Package setup is `dotctl setup <step>`: the one-off steps Nix cannot
// declare — a tool's own registration command, a download into a writable
// place, a file seeded once and then owned by its app. Feature modules name
// them as dotfiles.setup.<name> (lib/mk-setup.nix) and activation runs
// them after the links are written; a failing step only warns there.
//
// Every step looks first and acts only on what is missing, so a second run
// changes nothing. A tool that is not installed skips its step with a
// warning: Nix, mise and the tools' own installers own them, not this step.
package setup

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/nvim"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// Sys is the machine the steps drive. sys.OS is the real one.
type Sys interface {
	Run(env []string, name string, args ...string) error
	Capture(timeout time.Duration, name string, args ...string) (string, string, error)
	Has(name string) bool
}

// Env is one step's world: this user, this checkout, the machine.
type Env struct {
	Home, Repo string
	Getenv     func(string) string
	Sys        Sys
	UI         ui.Printer
	Now        func() time.Time
}

type step func(Env) error

var steps = map[string]step{
	"capsule-daemon":  capsuleDaemon,
	"claude-cli":      claudeCLI,
	"codebase-memory": codebaseMemory,
	"gh-extensions":   ghExtensions,
	"git-filters":     gitFilters,
	"git-identity":    gitIdentity,
	"git-lfs":         gitLFS,
	"mise-trust":      miseTrust,
	"nvim-default":    nvimDefault,
	"omarchy-bar":     omarchyBar,
	"omarchy-themes":  omarchyThemes,
	"orbstack":        orbstack,
	"pacifica":        pacifica,
	"pi-packages":     piPackages,
	"quickshell-rise": quickshellRise,
	"records-ttl":     recordsTTL,
	"sbarlua":         sbarlua,
	"userstyles":      userstyles,
	"warp-seed":       warpSeed,
	"zellij-plugins":  zellijPlugins,
}

// ErrUnknownStep is returned for a name no step has.
var ErrUnknownStep = errors.New("unknown step")

// Names lists every step, sorted.
func Names() []string {
	names := make([]string, 0, len(steps))
	for n := range steps {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// Run runs one step by name.
func Run(e Env, name string) error {
	s, ok := steps[name]
	if !ok {
		return fmt.Errorf("%w: %s (known: %s)", ErrUnknownStep, name, strings.Join(Names(), ", "))
	}
	if e.Getenv == nil {
		e.Getenv = os.Getenv
	}
	if e.Now == nil {
		e.Now = time.Now
	}
	return s(e)
}

// need is false, with a warning, when a command is not installed.
func (e Env) need(name string) bool {
	if e.Sys.Has(name) {
		return true
	}
	e.UI.Warn("%s is not installed; skipped", name)
	return false
}

// quiet runs a command whose output nobody needs; a failure carries what it
// printed on stderr.
func (e Env) quiet(timeout time.Duration, name string, args ...string) error {
	_, errOut, err := e.Sys.Capture(timeout, name, args...)
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(errOut))
	}
	return nil
}

func exists(path string) bool { _, err := os.Lstat(path); return err == nil }

func (e Env) path(parts ...string) string {
	return filepath.Join(append([]string{e.Home}, parts...)...)
}

func capsuleDaemon(e Env) error {
	if !e.need("capsule") {
		return nil
	}
	if info, err := os.Stat(e.path(".capsule", "capsule.sock")); err == nil && info.Mode()&os.ModeSocket != 0 {
		return nil
	}
	return e.Sys.Run(nil, "capsule", "daemon", "install")
}

// mise withdraws trust whenever the file's content changes; this checkout
// changes it, so trust is renewed before every install.
func miseTrust(e Env) error {
	if !e.need("mise") {
		return nil
	}
	cfg := e.path(".config", "mise", "config.toml")
	if !exists(cfg) {
		return nil
	}
	return e.quiet(0, "mise", "trust", cfg)
}

// nvimDefault points ~/.config/nvim at lazyvim when it is not a working
// link already: absent, dangling, or a real directory (Omarchy seeds its own
// LazyVim there), which is moved aside first. A link, to a distribution or
// elsewhere, is the owner's choice and stays.
func nvimDefault(e Env) error {
	link := e.path(".config", "nvim")
	if info, err := os.Lstat(link); err == nil && info.IsDir() {
		aside, err := moveAside(link)
		if err != nil {
			return fmt.Errorf("moving %s aside: %w", link, err)
		}
		e.UI.Note("moved %s to %s", link, aside)
	} else if exists(link) {
		return nil
	}
	if err := nvim.Switch(e.Home, "lazyvim", e.Now()); err != nil {
		return err
	}
	e.UI.Note("~/.config/nvim is lazyvim")
	return nil
}

// --skip-repo: global filters only. A plain `git lfs install` inside this
// checkout adds a pre-push hook that fails under the agent sandbox.
func gitLFS(e Env) error {
	if !e.need("git-lfs") {
		return nil
	}
	return e.Sys.Run(nil, "git", "lfs", "install", "--skip-repo")
}

func ghExtensions(e Env) error {
	if !e.need("gh") {
		return nil
	}
	installed, _, _ := e.Sys.Capture(0, "gh", "extension", "list")
	for _, ext := range []string{"orangain/gh-pr-graph"} {
		if strings.Contains(installed, ext) {
			continue
		}
		if err := e.Sys.Run(nil, "gh", "extension", "install", ext); err != nil {
			return err
		}
	}
	return nil
}

func codebaseMemory(e Env) error {
	if !e.need("codebase-memory-mcp") {
		return nil
	}
	for _, key := range []string{"auto_index", "auto_watch"} {
		if err := e.quiet(0, "codebase-memory-mcp", "config", "set", key, "true"); err != nil {
			return err
		}
	}
	return nil
}

// The native installer keeps Claude Code up to date by itself.
func claudeCLI(e Env) error {
	if info, err := os.Stat(e.path(".local", "bin", "claude")); err == nil && info.Mode()&0o111 != 0 {
		return nil
	}
	return e.Sys.Run(nil, "bash", "-c", "set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash")
}

func piPackages(e Env) error {
	if !e.need("pi") {
		return nil
	}
	settings, _ := os.ReadFile(e.path(".pi", "agent", "settings.json"))
	for _, pkg := range []string{"pi-mcp-adapter", "@tintinweb/pi-subagents"} {
		if strings.Contains(string(settings), `"npm:`+pkg) {
			continue
		}
		if err := e.quiet(180*time.Second, "pi", "install", "npm:"+pkg); err != nil {
			e.UI.Warn("%v", err)
		}
	}
	return nil
}

func pacifica(e Env) error {
	if e.Sys.Has("pacifica") || !e.need("cargo") {
		return nil
	}
	return e.Sys.Run(nil, "cargo", "install", "--git", "https://github.com/serinuntius/pacifica")
}

// Warp rewrites settings.toml itself, so the live file is machine-local:
// seeded once from the tracked default, never overwritten.
func warpSeed(e Env) error {
	dir := filepath.Join(e.Repo, "home", "darwin", "warp", "config")
	live, def := filepath.Join(dir, "settings.toml"), filepath.Join(dir, "settings.toml.default")
	if exists(live) || !exists(def) {
		return nil
	}
	b, err := os.ReadFile(def)
	if err != nil {
		return err
	}
	return os.WriteFile(live, b, 0o644)
}

func zellijPlugins(e Env) error {
	dir := e.path(".config", "zellij", "plugins")
	if err := makeHomeDirs(e, dir); err != nil {
		return err
	}
	for _, repo := range []string{"dj95/zjstatus", "imsnif/monocle"} {
		name := repo[strings.Index(repo, "/")+1:]
		file := filepath.Join(dir, name+".wasm")
		if info, err := os.Stat(file); err == nil && info.Size() > 0 {
			continue
		}
		url := "https://github.com/" + repo + "/releases/latest/download/" + name + ".wasm"
		if err := e.Sys.Run(nil, "curl", "-fsSL", "-o", file, url); err != nil {
			e.UI.Warn("download of %s.wasm failed: %v", name, err)
		}
	}
	return nil
}

// Stylus's userstyles for every theme, generated in the checkout from its
// templates (home/shared/browsers/userstyles).
func userstyles(e Env) error {
	if !e.need("lessc") || !e.need("jq") {
		return nil
	}
	return e.Sys.Run(nil, "bash", filepath.Join(e.Repo, "home", "shared", "browsers", "userstyles", "scripts", "generate-userstyle.sh"), "all")
}

// omarchyBar runs each line of home/linux/omarchy-shell/bar as `omarchy bar
// <line>`. No omarchy: not an Omarchy machine, nothing to do. A refused
// command warns and the rest still run.
func omarchyBar(e Env) error {
	if !e.Sys.Has("omarchy") {
		return nil
	}
	list := filepath.Join(e.Repo, "home", "linux", "omarchy-shell", "bar")
	body, err := os.ReadFile(list)
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(body), "\n") {
		args := strings.Fields(line)
		if len(args) == 0 || strings.HasPrefix(args[0], "#") {
			continue
		}
		if err := e.quiet(time.Minute, "omarchy", append([]string{"bar"}, args...)...); err != nil {
			e.UI.Warn("%v", err)
		}
	}
	return nil
}

// OrbStack starts at login. `app.start_at_login` is not in OrbStack's
// settings reference; its maintainer added it in orbstack/orbstack#1581
// ("Added for the next version as `orb config set app.start_at_login true`"),
// so a refusal says how to do it by hand. No orb: the Mac has no role that
// installs it.
func orbstack(e Env) error {
	if !e.Sys.Has("orb") {
		return nil
	}
	if err := e.quiet(time.Minute, "orb", "config", "set", "app.start_at_login", "true"); err != nil {
		e.UI.Warn("could not set OrbStack to start at login (%v): turn on Settings → General → \"Start at login\" in OrbStack", err)
	}
	return nil
}
