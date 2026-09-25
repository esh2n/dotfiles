package nvim

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// home builds a fake home with the given ~/.config/nvim-<name> directories.
func home(t *testing.T, distros ...string) string {
	t.Helper()
	h := t.TempDir()
	for _, d := range distros {
		if err := os.MkdirAll(filepath.Join(h, ".config", "nvim-"+d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return h
}

func link(t *testing.T, h string) string {
	t.Helper()
	target, err := os.Readlink(filepath.Join(h, ".config", "nvim"))
	if err != nil {
		t.Fatalf("~/.config/nvim is not a link: %v", err)
	}
	return target
}

func TestSwitchLinksTheDistribution(t *testing.T) {
	h := home(t, "lazyvim", "nvchad")
	if err := Switch(h, "lazyvim", time.Now()); err != nil {
		t.Fatal(err)
	}
	if got, want := link(t, h), filepath.Join(h, ".config", "nvim-lazyvim"); got != want {
		t.Fatalf("link = %q, want %q", got, want)
	}
	if err := Switch(h, "nvchad", time.Now()); err != nil {
		t.Fatal(err)
	}
	if got, want := link(t, h), filepath.Join(h, ".config", "nvim-nvchad"); got != want {
		t.Fatalf("after switching again, link = %q, want %q", got, want)
	}
}

func TestSwitchKeepsARealDirectoryAsABackup(t *testing.T) {
	h := home(t, "lazyvim")
	own := filepath.Join(h, ".config", "nvim")
	if err := os.MkdirAll(own, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(own, "init.lua"), []byte("mine"), 0o644); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 9, 25, 3, 4, 5, 0, time.Local)
	if err := Switch(h, "lazyvim", at); err != nil {
		t.Fatal(err)
	}
	kept, err := os.ReadFile(filepath.Join(h, ".config", "nvim.backup.20260925-030405", "init.lua"))
	if err != nil || string(kept) != "mine" {
		t.Fatalf("backup = %q, %v", kept, err)
	}
	link(t, h)
}

func TestSwitchRefusesUnknownAndMissing(t *testing.T) {
	h := home(t, "lazyvim")
	if err := Switch(h, "emacs", time.Now()); err == nil {
		t.Fatal("unknown distribution was accepted")
	}
	if err := Switch(h, "astrovim", time.Now()); err == nil {
		t.Fatal("missing ~/.config/nvim-astrovim was accepted")
	}
	if _, err := os.Lstat(filepath.Join(h, ".config", "nvim")); !os.IsNotExist(err) {
		t.Fatal("a refused switch touched ~/.config/nvim")
	}
}

func TestCurrent(t *testing.T) {
	h := home(t, "lazyvim")
	if got := Current(h); got != "custom" {
		t.Fatalf("with no link, Current = %q, want custom", got)
	}
	if err := Switch(h, "lazyvim", time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := Current(h); got != "lazyvim" {
		t.Fatalf("Current = %q, want lazyvim", got)
	}
}
