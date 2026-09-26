package setup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTpmMovesABrokenTmuxLinkAside(t *testing.T) {
	w := newWorld(t, "git")
	tmux := filepath.Join(w.home, ".tmux")
	if err := os.Symlink(filepath.Join(w.home, "gone", "tmux"), tmux); err != nil {
		t.Fatal(err)
	}
	if err := Run(w.env, "tpm"); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(tmux); err != nil || !info.IsDir() {
		t.Fatalf("~/.tmux is not a directory now: %v", err)
	}
	if target, err := os.Readlink(tmux + ".pre-next"); err != nil || target != filepath.Join(w.home, "gone", "tmux") {
		t.Fatalf("the old link was not kept aside: %q %v", target, err)
	}
	if !strings.Contains(w.out.String(), "[WARN]") || !strings.Contains(w.out.String(), "moved to "+tmux+".pre-next") {
		t.Fatalf("out %q", w.out.String())
	}
}

func TestMoveAsideNeverOverwritesAnEarlierBackup(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "x")
	for _, f := range []string{p, p + ".pre-next"} {
		if err := os.WriteFile(f, []byte(f), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	aside, err := moveAside(p)
	if err != nil || aside != p+".pre-next.1" {
		t.Fatalf("moved to %q: %v", aside, err)
	}
	if b, _ := os.ReadFile(p + ".pre-next"); string(b) != p+".pre-next" {
		t.Fatal("the earlier backup was overwritten")
	}
}

func TestMakeHomeDirsLeavesARealDirectoryAlone(t *testing.T) {
	w := newWorld(t)
	dir := filepath.Join(w.home, ".config", "zellij", "plugins")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := makeHomeDirs(w.env, dir); err != nil || w.out.Len() != 0 {
		t.Fatalf("err %v, out %q", err, w.out.String())
	}
}
