package main

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunDispatch(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	if err := os.MkdirAll(filepath.Join(h, ".config", "nvim-lazyvim"), 0o755); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run(nil, &out, &errOut); code != 2 {
		t.Fatalf("no args: exit %d, want 2", code)
	}
	if code := run([]string{"frobnicate"}, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "frobnicate") {
		t.Fatalf("unknown command: exit %d, stderr %q", code, errOut.String())
	}
	out.Reset()
	if code := run([]string{"nvim", "lazyvim"}, &out, &errOut); code != 0 {
		t.Fatalf("nvim lazyvim: exit %d, stderr %q", code, errOut.String())
	}
	out.Reset()
	run([]string{"nvim", "list"}, &out, &errOut)
	if !strings.Contains(out.String(), "Available configurations:\n") || !strings.Contains(out.String(), "* lazyvim (active)") {
		t.Fatalf("list did not mark lazyvim active: %q", out.String())
	}
	out.Reset()
	run([]string{"nvim", "current"}, &out, &errOut)
	if out.String() != "Current: lazyvim\n" {
		t.Fatalf("current: %q", out.String())
	}
	if code := run([]string{"nvim", "emacs"}, &out, &errOut); code != 1 {
		t.Fatalf("nvim emacs: exit %d, want 1", code)
	}
}

// Asking any command for help is a success: the usage on stdout, exit 0.
func TestHelpIsASuccessEverywhere(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	for _, args := range [][]string{
		{"help"}, {"--help"}, {"wallpaper", "help"}, {"wallpaper", "-h"}, {"llm", "--help"},
		{"setup", "help"}, {"theme", "-h"}, {"mado", "help"}, {"gh", "--help"}, {"cache-gc", "-h"},
	} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 0 || !strings.Contains(out.String(), "usage") && !strings.Contains(out.String(), "mado") || errOut.Len() != 0 {
			t.Errorf("%v: exit %d, stdout %q, stderr %q", args, code, out.String(), errOut.String())
		}
	}
	var out, errOut bytes.Buffer
	if run([]string{"wallpaper", "--help"}, &out, &errOut); !strings.Contains(out.String(), "dotctl wallpaper") {
		t.Fatalf("wallpaper help is not the wallpaper usage: %q", out.String())
	}
}

func TestCacheGCReadsItsLimitsFromTheEnvironment(t *testing.T) {
	t.Setenv("CBM_CACHE_DIR", t.TempDir())
	t.Setenv("CODE_GRAPH_CACHE_TTL_DAYS", "seven")
	var out, errOut bytes.Buffer
	if code := runCacheGC(t.TempDir(), []string{"--force"}, nil, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "CODE_GRAPH_CACHE_TTL_DAYS") {
		t.Fatalf("bad TTL: exit %d, stderr %q", code, errOut.String())
	}
	t.Setenv("CODE_GRAPH_CACHE_TTL_DAYS", "7")
	repo := t.TempDir()
	if code := runCacheGC(t.TempDir(), []string{"--touch", repo}, nil, &out, &errOut); code != 0 {
		t.Fatalf("--touch: exit %d, stderr %q", code, errOut.String())
	}
	if code := runCacheGC(t.TempDir(), []string{"--bogus"}, nil, &out, &errOut); code != 2 {
		t.Fatalf("unknown flag: exit %d", code)
	}
}

func TestThemeNeedsTheCheckout(t *testing.T) {
	t.Setenv("DOTFILES_ROOT", "")
	var out, errOut bytes.Buffer
	if code := runTheme(t.TempDir(), []string{"list"}, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "--repo") {
		t.Fatalf("exit %d, stderr %q", code, errOut.String())
	}
	if code := runTheme(t.TempDir(), []string{"--repo", t.TempDir(), "set"}, &out, &errOut); code != 2 {
		t.Fatalf("set without a name: exit %d", code)
	}
}

func TestLLMRefusesWhatItDoesNotKnow(t *testing.T) {
	t.Setenv("DOTFILES_ROOT", "")
	var out, errOut bytes.Buffer
	for _, args := range [][]string{nil, {"serve"}, {"setup", "--hub"}, {"check", "extra"}} {
		if code := runLLM(t.TempDir(), args, &out, &errOut); code != 2 {
			t.Fatalf("%v: exit %d", args, code)
		}
	}
	if code := runLLM(t.TempDir(), []string{"check"}, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "--repo") {
		t.Fatalf("no checkout: exit %d, stderr %q", code, errOut.String())
	}
}

func TestSetupRefusesWhatItDoesNotKnow(t *testing.T) {
	t.Setenv("DOTFILES_ROOT", "")
	var out, errOut bytes.Buffer
	if code := runSetup(t.TempDir(), []string{"tpm"}, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "--repo") {
		t.Fatalf("no checkout: exit %d", code)
	}
	errOut.Reset()
	if code := runSetup(t.TempDir(), []string{"--repo", t.TempDir(), "no-such-step"}, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "no-such-step") {
		t.Fatalf("unknown step: exit %d, stderr %q", code, errOut.String())
	}
	if code := runSetup(t.TempDir(), nil, &out, &errOut); code != 2 {
		t.Fatalf("no step: exit %d", code)
	}
}

func TestCheckLogFollowsXDGState(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", "/s")
	if checkLog("/h") != "/s/home-llm/check.log" {
		t.Fatal(checkLog("/h"))
	}
	t.Setenv("XDG_STATE_HOME", "")
	if checkLog("/h") != "/h/.local/state/home-llm/check.log" {
		t.Fatal(checkLog("/h"))
	}
	if isTerminal(&bytes.Buffer{}) {
		t.Fatal("a buffer is not a terminal")
	}
}

func TestOldNamesBecomeTheirSubcommands(t *testing.T) {
	cases := map[string][2][]string{
		"/x/code-graph-cache-gc":  {{"--quiet"}, {"cache-gc", "--quiet"}},
		"nvim-switch":             {{"lazyvim"}, {"nvim", "lazyvim"}},
		"theme-switch":            {nil, {"theme", "list"}},
		"gh-switch":               {nil, {"gh", "switch"}},
		"gh-pr-graph-update":      {nil, {"gh", "pr-graph-update"}},
		"setup-neovim-distros":    {nil, {"nvim", "install"}},
		"install-extensions":      {nil, {"editor", "extensions"}},
		"wallpaper":               {{"random"}, {"wallpaper", "random"}},
		"mado":                    {{"status"}, {"mado", "status"}},
		"/nix/store/x/bin/dotctl": {{"up"}, {"up"}},
	}
	for argv0, c := range cases {
		if got := aliasArgs(argv0, c[0]); strings.Join(got, " ") != strings.Join(c[1], " ") {
			t.Errorf("%s %v: got %v, want %v", argv0, c[0], got, c[1])
		}
	}
	if got := aliasArgs("theme-switch", []string{"nord"}); strings.Join(got, " ") != "theme set nord" {
		t.Errorf("theme-switch nord: %v", got)
	}
}

func TestToolsRefuseWhatTheyDoNotKnow(t *testing.T) {
	t.Setenv("DOTFILES_ROOT", "")
	var out, errOut bytes.Buffer
	for name, code := range map[string]int{
		"gh":             runGH(nil, strings.NewReader(""), &out, &errOut),
		"gh nope":        runGH([]string{"nope"}, strings.NewReader(""), &out, &errOut),
		"editor":         runEditor(nil, &out, &errOut),
		"editor no repo": runEditor([]string{"extensions"}, &out, &errOut),
		"wallpaper":      runWallpaper(t.TempDir(), nil, &out, &errOut),
		"nvim install":   runNvimInstall(nil, &out, &errOut),
	} {
		if code != 2 {
			t.Errorf("%s: exit %d", name, code)
		}
	}
	repo := t.TempDir()
	for _, args := range [][]string{{"--repo", repo}, {"--repo", repo, "search"}, {"--repo", repo, "random", "extra"}, {"--repo", repo, "set"}, {"--repo", repo, "search", "--sorting"}, {"--repo", repo, "dance"}} {
		if code := runWallpaper(t.TempDir(), args, &out, &errOut); code != 2 {
			t.Errorf("wallpaper %v: exit %d", args, code)
		}
	}
}

func TestParseInterspersedTakesFlagsAnywhere(t *testing.T) {
	fs := flag.NewFlagSet("t", flag.ContinueOnError)
	p := fs.String("purity", "", "")
	words, err := parseInterspersed(fs, []string{"anime", "--purity", "110", "scenery"})
	if err != nil || strings.Join(words, " ") != "anime scenery" || *p != "110" {
		t.Fatalf("%v %v %q", words, err, *p)
	}
}

func TestEditorExtensionsWithAMissingList(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := runEditor([]string{"extensions", "--repo", t.TempDir()}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "editor extensions:") {
		t.Fatalf("exit %d, stderr %q", code, errOut.String())
	}
}

func TestLLMServersRefuseWhatTheyCannotDo(t *testing.T) {
	t.Setenv("DOTFILES_ROOT", "")
	repo := t.TempDir()
	var out, errOut bytes.Buffer
	for _, args := range [][]string{
		{"models", "--repo", repo, "extra"},
		{"load", "--repo", repo, "mac"},
		{"unload", "--repo", repo, "mac", "m", "extra"},
		{"load", "mac", "m"}, // no checkout
	} {
		if code := runLLM(t.TempDir(), args, &out, &errOut); code != 2 {
			t.Fatalf("%v: exit %d, stderr %q", args, code, errOut.String())
		}
	}
	errOut.Reset()
	if code := runLLM(t.TempDir(), []string{"load", "--repo", repo, "windows", "m"}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "unknown model server") {
		t.Fatalf("unknown server: exit %d, stderr %q", code, errOut.String())
	}
	errOut.Reset()
	if code := runLLM(t.TempDir(), []string{"unload", "--repo", repo, "linux", ""}, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "name the model") {
		t.Fatalf("empty model: exit %d, stderr %q", code, errOut.String())
	}
}
