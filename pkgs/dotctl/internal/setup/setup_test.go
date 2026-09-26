package setup

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// fakeSys records every command; have names what is installed, and outputs
// answers Capture by the command line's start.
type fakeSys struct {
	have    map[string]bool
	outputs map[string]string
	fail    map[string]error
	calls   []string
	onRun   func(line string)
}

func (f *fakeSys) record(name string, args []string) string {
	line := strings.TrimSpace(name + " " + strings.Join(args, " "))
	f.calls = append(f.calls, line)
	return line
}

func (f *fakeSys) Run(_ []string, name string, args ...string) error {
	line := f.record(name, args)
	if f.onRun != nil {
		f.onRun(line)
	}
	return f.failFor(line)
}

func (f *fakeSys) Capture(_ time.Duration, name string, args ...string) (string, string, error) {
	line := f.record(name, args)
	for prefix, out := range f.outputs {
		if strings.HasPrefix(line, prefix) {
			return out, "", f.failFor(line)
		}
	}
	return "", "", f.failFor(line)
}

func (f *fakeSys) failFor(line string) error {
	for prefix, err := range f.fail {
		if strings.HasPrefix(line, prefix) {
			return err
		}
	}
	return nil
}

func (f *fakeSys) Has(name string) bool { return f.have[name] }

func (f *fakeSys) ran(line string) bool {
	for _, c := range f.calls {
		if c == line {
			return true
		}
	}
	return false
}

type world struct {
	env        Env
	sys        *fakeSys
	out, err   *bytes.Buffer
	home, repo string
}

func newWorld(t *testing.T, have ...string) world {
	t.Helper()
	root := t.TempDir()
	home, repo := filepath.Join(root, "home"), filepath.Join(root, "dotfiles")
	for _, d := range []string{home, repo} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	s := &fakeSys{have: map[string]bool{}, outputs: map[string]string{}, fail: map[string]error{}}
	for _, h := range have {
		s.have[h] = true
	}
	var out, errOut bytes.Buffer
	return world{
		env: Env{
			Home: home, Repo: repo, Sys: s,
			Getenv: func(string) string { return "" },
			UI:     ui.Printer{Out: &out, Err: &errOut, Prefix: "setup"},
			Now:    func() time.Time { return time.Unix(0, 0) },
		},
		sys: s, out: &out, err: &errOut, home: home, repo: repo,
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

func TestUnknownStepNamesTheKnownOnes(t *testing.T) {
	w := newWorld(t)
	err := Run(w.env, "no-such-step")
	if !errors.Is(err, ErrUnknownStep) || !strings.Contains(err.Error(), "tpm") {
		t.Fatalf("got %v", err)
	}
	if len(Names()) != len(steps) || Names()[0] != "capsule-daemon" {
		t.Fatalf("Names = %v", Names())
	}
}

func TestMissingToolSkipsWithAWarning(t *testing.T) {
	for _, name := range []string{"capsule-daemon", "mise-trust", "git-lfs", "gh-extensions", "codebase-memory", "pi-packages", "pacifica", "tpm", "userstyles", "sbarlua"} {
		w := newWorld(t)
		if err := Run(w.env, name); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(w.sys.calls) != 0 || !strings.Contains(w.out.String(), "is not installed; skipped") {
			t.Fatalf("%s: calls %v, out %q", name, w.sys.calls, w.out.String())
		}
	}
}

func TestSimpleStepsRunTheirCommandOnce(t *testing.T) {
	cases := []struct {
		step, tool, want string
		done             func(w world)
	}{
		{"capsule-daemon", "capsule", "capsule daemon install", nil},
		{"git-lfs", "git-lfs", "git lfs install --skip-repo", nil},
		{"pacifica", "cargo", "cargo install --git https://github.com/serinuntius/pacifica", func(w world) { w.sys.have["pacifica"] = true }},
		{"tpm", "git", "git clone https://github.com/tmux-plugins/tpm " + "{home}/.tmux/plugins/tpm", func(w world) { _ = os.MkdirAll(filepath.Join(w.home, ".tmux", "plugins", "tpm"), 0o755) }},
		{"claude-cli", "", "bash -c set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash", func(w world) {
			write(t, filepath.Join(w.home, ".local", "bin", "claude"), "#!/bin/sh\n")
			_ = os.Chmod(filepath.Join(w.home, ".local", "bin", "claude"), 0o755)
		}},
	}
	for _, c := range cases {
		w := newWorld(t, c.tool, "lessc", "jq")
		want := strings.NewReplacer("{home}", w.home, "{parent}", filepath.Dir(w.repo)).Replace(c.want)
		if err := Run(w.env, c.step); err != nil || !w.sys.ran(want) {
			t.Fatalf("%s: err %v, calls %v", c.step, err, w.sys.calls)
		}
		if c.done == nil {
			continue
		}
		c.done(w)
		w.sys.calls = nil
		if err := Run(w.env, c.step); err != nil || len(w.sys.calls) != 0 {
			t.Fatalf("%s second run: err %v, calls %v", c.step, err, w.sys.calls)
		}
	}
}

func TestMiseTrustOnlyWithTheManagedConfig(t *testing.T) {
	w := newWorld(t, "mise")
	if err := Run(w.env, "mise-trust"); err != nil || len(w.sys.calls) != 0 {
		t.Fatalf("no config: %v %v", err, w.sys.calls)
	}
	cfg := filepath.Join(w.home, ".config", "mise", "config.toml")
	write(t, cfg, "")
	w.sys.fail["mise trust"] = errors.New("exit status 1")
	err := Run(w.env, "mise-trust")
	if err == nil || !w.sys.ran("mise trust "+cfg) {
		t.Fatalf("a failing trust must be an error: %v %v", err, w.sys.calls)
	}
}

func TestNvimDefaultLinksLazyvimOnlyWhenAbsent(t *testing.T) {
	w := newWorld(t)
	if err := os.MkdirAll(filepath.Join(w.home, ".config", "nvim-lazyvim"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Run(w.env, "nvim-default"); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(w.home, ".config", "nvim")
	if target, _ := os.Readlink(link); target != filepath.Join(w.home, ".config", "nvim-lazyvim") {
		t.Fatalf("link = %q", target)
	}
	if err := Run(w.env, "nvim-default"); err != nil {
		t.Fatal("second run must leave the link alone:", err)
	}
}

func TestGhExtensionsInstallsOnlyMissing(t *testing.T) {
	w := newWorld(t, "gh")
	if err := Run(w.env, "gh-extensions"); err != nil || !w.sys.ran("gh extension install orangain/gh-pr-graph") {
		t.Fatalf("%v %v", err, w.sys.calls)
	}
	w.sys.calls = nil
	w.sys.outputs["gh extension list"] = "gh pr-graph  orangain/gh-pr-graph  v1\n"
	if err := Run(w.env, "gh-extensions"); err != nil || w.sys.ran("gh extension install orangain/gh-pr-graph") {
		t.Fatalf("%v %v", err, w.sys.calls)
	}
}

func TestCodebaseMemoryTurnsOnIndexAndWatch(t *testing.T) {
	w := newWorld(t, "codebase-memory-mcp")
	if err := Run(w.env, "codebase-memory"); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"auto_index", "auto_watch"} {
		if !w.sys.ran("codebase-memory-mcp config set " + k + " true") {
			t.Fatalf("%s not set: %v", k, w.sys.calls)
		}
	}
}

func TestPiPackagesInstallsWhatSettingsLacksAndWarnsOnFailure(t *testing.T) {
	w := newWorld(t, "pi")
	write(t, filepath.Join(w.home, ".pi", "agent", "settings.json"), `{"packages": ["npm:pi-mcp-adapter@1"]}`)
	w.sys.fail["pi install npm:@tintinweb"] = errors.New("exit status 1")
	if err := Run(w.env, "pi-packages"); err != nil {
		t.Fatal(err)
	}
	if w.sys.ran("pi install npm:pi-mcp-adapter") || !w.sys.ran("pi install npm:@tintinweb/pi-subagents") {
		t.Fatalf("calls %v", w.sys.calls)
	}
	if !strings.Contains(w.out.String(), "pi install npm:@tintinweb/pi-subagents") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestWarpSeedCopiesOnce(t *testing.T) {
	w := newWorld(t)
	dir := filepath.Join(w.repo, "home", "darwin", "warp", "config")
	write(t, filepath.Join(dir, "settings.toml.default"), "default")
	if err := Run(w.env, "warp-seed"); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(dir, "settings.toml"), "edited")
	if err := Run(w.env, "warp-seed"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "settings.toml")); string(b) != "edited" {
		t.Fatalf("live file overwritten: %q", b)
	}
}

func TestGitIdentityFromEnvironmentOrDotEnv(t *testing.T) {
	w := newWorld(t)
	out := filepath.Join(w.home, ".config", "git", "config.local")
	if err := Run(w.env, "git-identity"); err != nil || !strings.Contains(w.out.String(), "GIT_USER_EMAIL") {
		t.Fatalf("no values: %v %q", err, w.out.String())
	}
	if _, err := os.Stat(out); err == nil {
		t.Fatal("wrote an identity from nothing")
	}
	write(t, filepath.Join(w.repo, ".env"), "GIT_USER_NAME=Old\nGIT_USER_NAME=Someone\nGIT_USER_EMAIL=someone@example.com\n")
	w.env.Getenv = func(k string) string {
		if k == "GIT_USER_NAME" {
			return "From Env"
		}
		return ""
	}
	if err := Run(w.env, "git-identity"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(out)
	if !strings.Contains(string(b), "name = From Env") || !strings.Contains(string(b), "email = someone@example.com") {
		t.Fatalf("config.local = %q", b)
	}
	write(t, filepath.Join(w.repo, ".env"), "GIT_USER_NAME=X\nGIT_USER_EMAIL=x@example.com\n")
	if err := Run(w.env, "git-identity"); err != nil {
		t.Fatal(err)
	}
	if b2, _ := os.ReadFile(out); string(b2) != string(b) {
		t.Fatal("an existing identity was rewritten")
	}
}

func TestZellijPluginsDownloadsMissingAndWarnsOnFailure(t *testing.T) {
	w := newWorld(t)
	dir := filepath.Join(w.home, ".config", "zellij", "plugins")
	write(t, filepath.Join(dir, "zjstatus.wasm"), "wasm")
	w.sys.fail["curl"] = errors.New("exit status 22")
	if err := Run(w.env, "zellij-plugins"); err != nil {
		t.Fatal(err)
	}
	if len(w.sys.calls) != 1 || !strings.Contains(w.sys.calls[0], "monocle/releases/latest/download/monocle.wasm") {
		t.Fatalf("calls %v", w.sys.calls)
	}
	if !strings.Contains(w.out.String(), "download of monocle.wasm failed") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestUserstylesRunsTheCheckoutsGenerator(t *testing.T) {
	w := newWorld(t, "lessc", "jq")
	if err := Run(w.env, "userstyles"); err != nil {
		t.Fatal(err)
	}
	want := "bash " + filepath.Join(w.repo, "home", "darwin", "browsers", "userstyles", "scripts", "generate-userstyle.sh") + " all"
	if !w.sys.ran(want) {
		t.Fatalf("calls %v", w.sys.calls)
	}
}

func TestSbarluaKeepsAMatchingBuild(t *testing.T) {
	w := newWorld(t, "lua", "git", "make")
	w.sys.outputs["lua -v"] = "Lua 5.4.7  Copyright"
	write(t, filepath.Join(w.home, ".local", "share", "sketchybar_lua", "sketchybar.so"), "xx LuaVersion: Lua 5.4 xx")
	if err := Run(w.env, "sbarlua"); err != nil {
		t.Fatal(err)
	}
	for _, c := range w.sys.calls {
		if strings.HasPrefix(c, "git") || strings.HasPrefix(c, "make") {
			t.Fatalf("rebuilt a matching module: %v", w.sys.calls)
		}
	}
}

func TestSbarluaRebuildsPatchedForAnotherLua(t *testing.T) {
	w := newWorld(t, "lua", "git", "make")
	w.sys.outputs["lua -v"] = "Lua 5.5.0  Copyright"
	target := filepath.Join(w.home, ".local", "share", "sketchybar_lua", "sketchybar.so")
	write(t, target, "LuaVersion: Lua 5.4")
	src := filepath.Join(w.home, ".cache", "sbarlua")
	w.sys.onRun = func(line string) {
		switch {
		case strings.HasPrefix(line, "git clone"):
			write(t, filepath.Join(src, "src", "sketchybar.c"), "int x;\n"+orphanCheck+"\n")
		case line == "make -C "+src+" install":
			write(t, target, "LuaVersion: Lua 5.5")
		}
	}
	if err := Run(w.env, "sbarlua"); err != nil {
		t.Fatal(err)
	}
	if !w.sys.ran("git clone --depth 1 https://github.com/FelixKratz/SbarLua "+src) || !w.sys.ran("make -C "+src+" install") {
		t.Fatalf("calls %v", w.sys.calls)
	}
	if b, _ := os.ReadFile(filepath.Join(src, "src", "sketchybar.c")); strings.Contains(string(b), orphanCheck) {
		t.Fatal("orphan check not patched out")
	}
	if !strings.Contains(w.out.String(), "built for Lua 5.4, lua is 5.5") {
		t.Fatalf("stdout %q", w.out.String())
	}
	// an existing clone is updated in place, and a missing result is an error
	if err := os.MkdirAll(filepath.Join(src, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, target, "LuaVersion: Lua 5.3")
	w.sys.calls, w.sys.onRun = nil, func(line string) {
		if line == "make -C "+src+" install" {
			_ = os.Remove(target)
		}
	}
	err := Run(w.env, "sbarlua")
	if !w.sys.ran("git -C "+src+" reset --hard origin/HEAD") || err == nil || !strings.Contains(err.Error(), "is missing") {
		t.Fatalf("err %v, calls %v", err, w.sys.calls)
	}
}
