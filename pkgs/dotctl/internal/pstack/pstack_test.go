package pstack

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

const pinCommit = "101b274dd991f694e1f7024be2157e5f3adf07de"

// fakeSys records every command and models the little git state the code
// asks about: HEAD, and whether origin exists and where it points.
type fakeSys struct {
	runs    [][]string
	envs    [][]string
	head    string
	remote  string
	missing map[string]bool
	fail    string       // a command name whose Run fails
	onFetch func(string) // called with the checkout dir when fetch runs
}

func (f *fakeSys) Run(env []string, name string, args ...string) error {
	f.runs = append(f.runs, append([]string{name}, args...))
	f.envs = append(f.envs, env)
	if name == f.fail {
		return errors.New("boom")
	}
	if name != "git" {
		return nil
	}
	switch {
	case args[0] == "init":
		_ = os.MkdirAll(filepath.Join(args[len(args)-1], ".git"), 0o755)
	case len(args) > 4 && args[2] == "remote" && (args[3] == "add" || args[3] == "set-url"):
		f.remote = args[len(args)-1]
	case len(args) > 2 && args[2] == "fetch":
		f.head = args[len(args)-1]
		if f.onFetch != nil {
			f.onFetch(args[1])
		}
	}
	return nil
}

func (f *fakeSys) Output(name string, args ...string) (string, error) {
	switch {
	case len(args) > 2 && args[2] == "rev-parse":
		if f.head == "" {
			return "", errors.New("fatal: ambiguous argument 'HEAD'")
		}
		return f.head + "\n", nil
	case len(args) > 3 && args[2] == "remote" && args[3] == "get-url":
		if f.remote == "" {
			return "", errors.New("error: No such remote 'origin'")
		}
		return f.remote + "\n", nil
	}
	return "", errors.New("unexpected: " + strings.Join(args, " "))
}

func (f *fakeSys) Has(name string) bool { return !f.missing[name] }

func writePin(t *testing.T, repo, body string) {
	t.Helper()
	p := UpstreamPath(repo)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

const goodPin = `{
  "repo": "https://github.com/cursor/plugins",
  "commit": "` + pinCommit + `",
  "version": "0.15.25",
  "pluginDir": "harness/pstack/claude-code",
  "fixes": [{"file": "skills/poteto-mode/SKILL.md", "from": "name: Poteto Mode", "to": "name: poteto-mode", "why": "#237"}]
}`

func newEnv(t *testing.T, s System) (Env, *bytes.Buffer) {
	t.Helper()
	repo := t.TempDir()
	writePin(t, repo, goodPin)
	var out bytes.Buffer
	return Env{
		Home:    t.TempDir(),
		Repo:    repo,
		Sys:     s,
		UI:      ui.Printer{Out: &out, Err: &out},
		DataDir: t.TempDir(),
	}, &out
}

// plantPlugin writes what the pinned checkout contains: a plugin manifest and
// the skill whose frontmatter `name:` is the given one (body is extra text).
func plantPlugin(t *testing.T, e Env, name, body string) {
	t.Helper()
	u, err := LoadUpstream(e.Repo)
	if err != nil {
		t.Fatal(err)
	}
	plugin := e.PluginDir(u)
	for p, text := range map[string]string{
		".claude-plugin/plugin.json":  `{"name":"pstack"}`,
		"skills/poteto-mode/SKILL.md": "---\nname: " + name + "\ndescription: x\n---\n" + body,
	} {
		full := filepath.Join(plugin, p)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func skillText(t *testing.T, e Env) string {
	t.Helper()
	u, _ := LoadUpstream(e.Repo)
	b, err := os.ReadFile(filepath.Join(e.PluginDir(u), "skills/poteto-mode/SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// ready is a checkout already at the pin with origin set, as a previous setup leaves it.
func ready(t *testing.T, name, body string) (*fakeSys, Env, *bytes.Buffer) {
	t.Helper()
	s := &fakeSys{head: pinCommit, remote: "https://github.com/cursor/plugins"}
	e, out := newEnv(t, s)
	plantPlugin(t, e, name, body)
	if err := os.MkdirAll(filepath.Join(e.CheckoutDir(), ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	return s, e, out
}

func TestLoadUpstreamRejectsAnUnsafePin(t *testing.T) {
	for name, body := range map[string]string{
		"short commit": strings.Replace(goodPin, pinCommit, "101b274", 1),
		"http repo":    strings.Replace(goodPin, "https://", "http://", 1),
		"other host":   strings.Replace(goodPin, "github.com/cursor", "evil.example/cursor", 1),
		"userinfo":     strings.Replace(goodPin, "https://github.com", "https://x@github.com", 1),
		"deep path":    strings.Replace(goodPin, "cursor/plugins", "cursor/plugins/tree/main", 1),
		"escaping dir": strings.Replace(goodPin, "harness/pstack/claude-code", "../elsewhere", 1),
		"fix no to":    strings.Replace(goodPin, `"to": "name: poteto-mode", `, "", 1),
		"not json":     "{",
	} {
		repo := t.TempDir()
		writePin(t, repo, body)
		if _, err := LoadUpstream(repo); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	repo := t.TempDir()
	writePin(t, repo, goodPin)
	u, err := LoadUpstream(repo)
	if err != nil || u.Version != "0.15.25" || len(u.Fixes) != 1 {
		t.Fatalf("good pin: %+v, %v", u, err)
	}
}

func TestSetupFromNothingClonesThePinThenFixesThenApplies(t *testing.T) {
	s := &fakeSys{}
	e, out := newEnv(t, s)
	s.onFetch = func(string) { plantPlugin(t, e, "Poteto Mode", "") } // the fetch brings the tree
	if err := Setup(e); err != nil {
		t.Fatalf("setup: %v\n%s", err, out.String())
	}
	got := flatten(s.runs)
	want := []string{
		"git init -q " + e.CheckoutDir(),
		"git -C " + e.CheckoutDir() + " remote add origin https://github.com/cursor/plugins",
		"git -C " + e.CheckoutDir() + " fetch -q --depth 1 origin " + pinCommit,
		"git -C " + e.CheckoutDir() + " checkout -q -f --detach " + pinCommit,
		"bash " + filepath.Join(e.Repo, "harness/bin/jig") + " apply --target claude --write",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("ran\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if env := strings.Join(s.envs[len(s.envs)-1], " "); env != "CLAUDE_CONFIG_DIR="+e.ConfigDir()+" JIG_PROFILE=pstack" {
		t.Fatalf("jig ran with env %q", env)
	}
	if text := skillText(t, e); !strings.Contains(text, "\nname: poteto-mode\n") {
		t.Fatalf("fix not applied after the fetch: %q", text)
	}
	if info, err := os.Stat(e.ConfigDir()); err != nil || info.Mode().Perm() != 0o700 {
		t.Fatalf("config dir: %v %v", info, err)
	}
}

func TestSetupAgainFetchesNothingAndFixesNothing(t *testing.T) {
	s, e, out := ready(t, "poteto-mode", "")
	if err := Setup(e); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(flatten(s.runs), "\n")
	for _, absent := range []string{"init", "fetch", "checkout", "remote add", "set-url"} {
		if strings.Contains(joined, absent) {
			t.Errorf("second run ran %q:\n%s", absent, joined)
		}
	}
	if !strings.Contains(joined, "apply --target claude --write") || !strings.Contains(out.String(), "already at") {
		t.Fatalf("jig or the note is missing:\n%s\n%s", joined, out.String())
	}
	if strings.Contains(out.String(), "fixed ") {
		t.Fatalf("a fix was reported on an already-fixed tree:\n%s", out.String())
	}
}

func TestSetupRepairsAPartialInitAndAMovedRemote(t *testing.T) {
	// .git exists but origin was never added (interrupted first run)
	s, e, _ := ready(t, "poteto-mode", "")
	s.remote = ""
	if err := Setup(e); err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(flatten(s.runs), "\n"); !strings.Contains(joined, "remote add origin https://github.com/cursor/plugins") {
		t.Fatalf("origin not repaired:\n%s", joined)
	}
	// origin points elsewhere than the pin
	s, e, out := ready(t, "poteto-mode", "")
	s.remote = "https://github.com/someone/else"
	if err := Setup(e); err != nil {
		t.Fatal(err)
	}
	if joined := strings.Join(flatten(s.runs), "\n"); !strings.Contains(joined, "remote set-url origin https://github.com/cursor/plugins") || !strings.Contains(out.String(), "origin was") {
		t.Fatalf("origin not repointed:\n%s", joined)
	}
}

func TestSetupMovesThePinOverAFixedTree(t *testing.T) {
	// a previous run left the fixed (dirty) file; the pin now names another commit
	s, e, _ := ready(t, "poteto-mode", "")
	newPin := strings.Repeat("ab", 20)
	writePin(t, e.Repo, strings.Replace(goodPin, pinCommit, newPin, 1))
	s.onFetch = func(string) { plantPlugin(t, e, "Poteto Mode", "") } // upstream still has the bug
	if err := Setup(e); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(flatten(s.runs), "\n")
	if !strings.Contains(joined, "checkout -q -f --detach "+newPin) {
		t.Fatalf("the checkout must be forced over the previous fixes:\n%s", joined)
	}
	if text := skillText(t, e); !strings.Contains(text, "\nname: poteto-mode\n") {
		t.Fatalf("fix not reapplied: %q", text)
	}
}

func TestFixIsAppliedWhenTheFixedTextAppearsElsewhere(t *testing.T) {
	_, e, out := ready(t, "Poteto Mode", "Example frontmatter:\nname: poteto-mode\n")
	if err := Setup(e); err != nil {
		t.Fatal(err)
	}
	text := skillText(t, e)
	if !strings.HasPrefix(text, "---\nname: poteto-mode\n") || strings.Contains(text, "Poteto Mode") {
		t.Fatalf("the frontmatter line was not the one fixed: %q", text)
	}
	if strings.Count(out.String(), "fixed skills/poteto-mode") != 1 {
		t.Fatalf("fix reported other than once:\n%s", out.String())
	}
}

func TestSetupRefusesAFixThroughASymlinkOutOfTheCheckout(t *testing.T) {
	_, e, _ := ready(t, "Poteto Mode", "")
	u, _ := LoadUpstream(e.Repo)
	target := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(target, []byte("name: Poteto Mode\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	skill := filepath.Join(e.PluginDir(u), "skills/poteto-mode/SKILL.md")
	if err := os.Remove(skill); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, skill); err != nil {
		t.Fatal(err)
	}
	err := Setup(e)
	if err == nil || !strings.Contains(err.Error(), "outside the plugin directory") {
		t.Fatalf("err = %v", err)
	}
	if b, _ := os.ReadFile(target); string(b) != "name: Poteto Mode\n" {
		t.Fatalf("the file outside was written: %q", b)
	}
}

func TestSetupStopsWhenUpstreamChangedTheLine(t *testing.T) {
	_, e, _ := ready(t, "Something Else", "")
	err := Setup(e)
	if err == nil || !strings.Contains(err.Error(), "upstream changed") {
		t.Fatalf("err = %v", err)
	}
}

func TestSetupNeedsTheTools(t *testing.T) {
	for _, tool := range []string{"git", "bash", "bun", "claude"} {
		s := &fakeSys{missing: map[string]bool{tool: true}}
		e, _ := newEnv(t, s)
		if err := Setup(e); err == nil || !strings.Contains(err.Error(), tool+" is not on PATH") {
			t.Fatalf("%s: err = %v", tool, err)
		}
	}
}

func TestRunNeedsSetupThenLaunchesClaudeInTheProfile(t *testing.T) {
	s := &fakeSys{head: pinCommit}
	e, _ := newEnv(t, s)
	if err := Run(e, nil); err == nil || !strings.Contains(err.Error(), "dotctl pstack setup") {
		t.Fatalf("before setup: %v", err)
	}
	plantPlugin(t, e, "poteto-mode", "")
	if err := Run(e, nil); err == nil || !strings.Contains(err.Error(), "settings.json") {
		t.Fatalf("plugin but no profile: %v", err)
	}
	if err := os.MkdirAll(e.ConfigDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.ConfigDir(), "settings.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Run(e, []string{"--model", "opus", "fix the tests"}); err != nil {
		t.Fatal(err)
	}
	u, _ := LoadUpstream(e.Repo)
	got := strings.Join(s.runs[len(s.runs)-1], " ")
	want := "claude --plugin-dir " + e.PluginDir(u) + " --model opus fix the tests"
	if got != want {
		t.Fatalf("ran %q, want %q", got, want)
	}
	if env := strings.Join(s.envs[len(s.envs)-1], " "); !strings.Contains(env, "CLAUDE_CONFIG_DIR="+e.ConfigDir()) {
		t.Fatalf("env %q lacks the profile", env)
	}
}

func TestStatusReportsEachPart(t *testing.T) {
	s := &fakeSys{}
	e, out := newEnv(t, s)
	if err := Status(e); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"checkout: none", "not generated yet", "no evaluation.tsv"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in\n%s", want, out.String())
		}
	}
	s.head = pinCommit
	out.Reset()
	if err := os.MkdirAll(e.ConfigDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.ConfigDir(), "settings.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.ConfigDir(), "evaluation.tsv"), []byte("a\tb\n\nc\td\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Status(e); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"at the pin", "2 run(s)"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in\n%s", want, out.String())
		}
	}
}

func TestCheckoutDirFollowsXDG(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", "/xdg")
	e := Env{Home: "/h"}
	if got := e.CheckoutDir(); got != "/xdg/dotctl/pstack/cursor-plugins" {
		t.Fatalf("xdg: %s", got)
	}
	t.Setenv("XDG_DATA_HOME", "")
	if got := e.CheckoutDir(); got != "/h/.local/share/dotctl/pstack/cursor-plugins" {
		t.Fatalf("default: %s", got)
	}
}

func flatten(runs [][]string) []string {
	out := make([]string, 0, len(runs))
	for _, r := range runs {
		out = append(out, strings.Join(r, " "))
	}
	return out
}
