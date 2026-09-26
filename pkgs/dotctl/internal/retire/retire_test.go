package retire

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunTakesTheOldLayoutOff(t *testing.T) {
	root := t.TempDir()
	home, repo := filepath.Join(root, "home"), filepath.Join(root, "dotfiles")
	put := func(p, body string) {
		t.Helper()
		must(t, os.MkdirAll(filepath.Dir(p), 0o755))
		must(t, os.WriteFile(p, []byte(body), 0o644))
	}
	link := func(target, at string) {
		t.Helper()
		must(t, os.MkdirAll(filepath.Dir(at), 0o755))
		must(t, os.Symlink(target, at))
	}
	// the old layout's leftovers
	put(filepath.Join(repo, "domains/dev/config/jig/policy/guard-rules.json"), "old")
	put(filepath.Join(repo, "domains/creative/dopa-shorts/video/node_modules/x/index.js"), "dep")
	put(filepath.Join(repo, "domains/dev/llm/harness/jig/adapters/dsh/lib/index.js"), "build")
	put(filepath.Join(repo, "domains/dev/llm/harness/skills/s/__pycache__/a.pyc"), "pyc")
	put(filepath.Join(repo, "domains/dev/home/.gitconfig"), "rendered")
	link("/nix/store/0000-darwin-system", filepath.Join(repo, "core/nix/result"))
	// links: the old layout's (live and broken), home-manager's, another's
	link(filepath.Join(repo, "domains/dev/config/jig"), filepath.Join(home, ".config/jig"))
	link(filepath.Join(repo, "domains/dev/config/gone"), filepath.Join(home, ".config/gone"))
	link("/nix/store/1111-home-manager-files/.zshrc", filepath.Join(home, ".zshrc"))
	link(filepath.Join(root, "other/vimrc"), filepath.Join(home, ".vimrc"))
	put(filepath.Join(home, ".config/nvim.pre-next"), "backup")

	var logs, warns []string
	c := Config{Home: home, Repo: repo, Now: func() time.Time { return time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC) },
		Log: func(s string) { logs = append(logs, s) }, Warn: func(s string) { warns = append(warns, s) }}
	must(t, Run(c))

	for _, gone := range []string{filepath.Join(home, ".config/jig"), filepath.Join(home, ".config/gone"), filepath.Join(repo, "domains"), filepath.Join(repo, "core")} {
		if _, err := os.Lstat(gone); !os.IsNotExist(err) {
			t.Errorf("%s is still there", gone)
		}
	}
	for _, kept := range []string{filepath.Join(home, ".zshrc"), filepath.Join(home, ".vimrc"), filepath.Join(home, ".config/nvim.pre-next")} {
		if _, err := os.Lstat(kept); err != nil {
			t.Errorf("%s was touched", kept)
		}
	}
	aside := filepath.Join(home, ".local/state/dotfiles/retired/2026-09-26")
	for rel, body := range map[string]string{
		"domains/dev/home/.gitconfig":                    "rendered",
		"domains/dev/config/jig/policy/guard-rules.json": "old",
	} {
		if b, err := os.ReadFile(filepath.Join(aside, rel)); err != nil || string(b) != body {
			t.Errorf("%s not moved aside: %q %v", rel, b, err)
		}
	}
	all := strings.Join(warns, "\n")
	for _, want := range []string{"domains/dev/home/.gitconfig ->", "nvim.pre-next"} {
		if !strings.Contains(all, want) {
			t.Errorf("warnings lack %q: %v", want, warns)
		}
	}
	if strings.Contains(all, "node_modules") || strings.Contains(all, "__pycache__") {
		t.Errorf("rebuildable things were kept: %v", warns)
	}

	// again: nothing left to do
	logs, warns = nil, nil
	must(t, Run(c))
	if len(logs) != 0 || len(warns) != 1 { // only the .pre-next list
		t.Fatalf("second run did something: logs %v warns %v", logs, warns)
	}
}
