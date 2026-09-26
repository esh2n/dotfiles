package up

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSweepPriorLinks(t *testing.T) {
	root := t.TempDir()
	home, repo, other := filepath.Join(root, "home"), filepath.Join(root, "dotfiles"), filepath.Join(root, "old-dotfiles")
	for _, d := range []string{filepath.Join(home, ".config"), filepath.Join(home, "bin"), filepath.Join(repo, "home", "shared", "jj"), filepath.Join(other, "vim")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	link := func(target, at string) {
		t.Helper()
		if err := os.Symlink(target, at); err != nil {
			t.Fatal(err)
		}
	}
	// this checkout's old layout, now gone: removed
	link(filepath.Join(repo, "domains", "dev", "config", "jig"), filepath.Join(home, ".config", "jig"))
	link(filepath.Join(repo, "domains", "dev", "bin", "jig"), filepath.Join(home, "bin", "jig"))
	// this checkout, still there: kept
	link(filepath.Join(repo, "home", "shared", "jj"), filepath.Join(home, ".config", "jj"))
	// another dotfiles checkout, alive: listed, kept
	link(filepath.Join(other, "vim"), filepath.Join(home, ".vim"))
	// broken, somewhere else: listed, kept
	link(filepath.Join(root, "gone", "tmux"), filepath.Join(home, ".tmux"))
	// home-manager's, through the store, even broken: its switch owns it
	link("/nix/store/0000000000000000000000000000000-hm_zellij", filepath.Join(home, ".config", "zellij"))
	// not a link at all: untouched
	if err := os.WriteFile(filepath.Join(home, ".zshrc.local"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	var logged, warned []string
	sweepPriorLinks(Config{Home: home, Repo: repo,
		Log:  func(s string) { logged = append(logged, s) },
		Warn: func(s string) { warned = append(warned, s) },
	})

	for _, gone := range []string{filepath.Join(home, ".config", "jig"), filepath.Join(home, "bin", "jig")} {
		if _, err := os.Lstat(gone); !os.IsNotExist(err) {
			t.Errorf("%s: stale link into this checkout kept", gone)
		}
	}
	for _, kept := range []string{filepath.Join(home, ".config", "zellij"), filepath.Join(home, ".config", "jj"), filepath.Join(home, ".vim"), filepath.Join(home, ".tmux"), filepath.Join(home, ".zshrc.local")} {
		if _, err := os.Lstat(kept); err != nil {
			t.Errorf("%s: removed, but it was not ours", kept)
		}
	}
	if len(logged) != 2 {
		t.Errorf("logged %q", logged)
	}
	if len(warned) != 1 || !strings.Contains(warned[0], ".vim -> ") || !strings.Contains(warned[0], "(another dotfiles checkout)") ||
		!strings.Contains(warned[0], ".tmux -> ") || !strings.Contains(warned[0], "(broken)") {
		t.Errorf("warned %q", warned)
	}
}

func TestSweepPriorLinksFollowsTheCheckoutThroughALink(t *testing.T) {
	root := t.TempDir()
	home, real := filepath.Join(root, "home"), filepath.Join(root, "real-dotfiles")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "dotfiles")
	if err := os.Symlink(real, alias); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(real, "core", "x"), filepath.Join(home, ".x")); err != nil {
		t.Fatal(err)
	}
	sweepPriorLinks(Config{Home: home, Repo: alias})
	if _, err := os.Lstat(filepath.Join(home, ".x")); !os.IsNotExist(err) {
		t.Fatal("a stale link into the checkout's real path was kept")
	}
}
