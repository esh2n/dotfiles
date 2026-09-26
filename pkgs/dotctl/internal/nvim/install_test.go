package nvim

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestInstallClonesMissingDistributionsWithoutGit(t *testing.T) {
	repo := t.TempDir()
	existing := filepath.Join(repo, "home", "shared", "nvim", "nvchad")
	if err := os.MkdirAll(existing, 0o755); err != nil {
		t.Fatal(err)
	}
	var cloned []string
	clone := func(url, dir string) error {
		cloned = append(cloned, url)
		return os.MkdirAll(filepath.Join(dir, ".git"), 0o755)
	}
	done, err := Install(repo, clone)
	if err != nil || !reflect.DeepEqual(done, []string{"lazyvim", "astrovim"}) {
		t.Fatalf("done %v err %v", done, err)
	}
	if !reflect.DeepEqual(cloned, []string{Sources["lazyvim"], Sources["astrovim"]}) {
		t.Fatalf("cloned %v", cloned)
	}
	if _, err := os.Stat(filepath.Join(repo, "home", "shared", "nvim", "lazyvim", ".git")); !os.IsNotExist(err) {
		t.Fatal(".git kept")
	}
	if done, _ := Install(repo, clone); len(done) != 0 {
		t.Fatalf("second run installed %v", done)
	}
	if _, err := Install(t.TempDir(), func(string, string) error { return errors.New("offline") }); err == nil {
		t.Fatal("a failed clone is not an error")
	}
}
