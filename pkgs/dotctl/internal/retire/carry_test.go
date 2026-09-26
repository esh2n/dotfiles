package retire

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestCarryOverMovesLeftoversOnce(t *testing.T) {
	repo := t.TempDir()
	put := func(p, body string) {
		t.Helper()
		must(t, os.MkdirAll(filepath.Dir(filepath.Join(repo, p)), 0o755))
		must(t, os.WriteFile(filepath.Join(repo, p), []byte(body), 0o644))
	}
	put("lib/moved.txt", "# old new\ndomains/dev/config/git home/shared/git/config\n../escape x\nbad\n")
	put("domains/dev/config/git/conditional/work.conf", "mine")
	put("domains/dev/config/git/config.local", "old identity")
	put("home/shared/git/config/config.local", "new identity")
	var logs, warns []string
	c := Config{Repo: repo, Log: func(s string) { logs = append(logs, s) }, Warn: func(s string) { warns = append(warns, s) }}
	must(t, carryOver(c))
	if b, _ := os.ReadFile(filepath.Join(repo, "home/shared/git/config/conditional/work.conf")); string(b) != "mine" {
		t.Fatalf("conditional not carried: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(repo, "home/shared/git/config/config.local")); string(b) != "new identity" {
		t.Fatal("an existing file was overwritten")
	}
	if _, err := os.Stat(filepath.Join(repo, "domains/dev/config/git/conditional")); !os.IsNotExist(err) {
		t.Fatal("the emptied directory was kept")
	}
	if _, err := os.Stat(filepath.Join(repo, "domains/dev/config/git/config.local")); err != nil {
		t.Fatal("the clashing file was dropped")
	}
	joined := strings.Join(warns, "\n")
	for _, want := range []string{"already exists", `"../escape x"`, `"bad"`} {
		if !strings.Contains(joined, want) {
			t.Fatalf("warnings lack %q: %v", want, warns)
		}
	}
	if len(logs) != 1 || !strings.Contains(logs[0], "conditional") {
		t.Fatalf("the conditional directory should move whole, once: %v", logs)
	}
	must(t, carryOver(c)) // again: nothing new
	if len(logs) != 1 {
		t.Fatalf("second run carried again: %v", logs)
	}
	must(t, carryOver(Config{Repo: t.TempDir()})) // no list: nothing to do
}
