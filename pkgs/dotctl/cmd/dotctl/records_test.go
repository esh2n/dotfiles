package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func recordsRepo(t *testing.T) string {
	t.Helper()
	repo := t.TempDir()
	dir := filepath.Join(repo, "harness", "rules", "research")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	old := time.Now().AddDate(0, 0, -30).Format("2006-01-02") + "-old.md"
	for name, body := range map[string]string{old: "", "INDEX.md": "- [old](" + old + ")\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return repo
}

func TestRecordsPruneListsUntilToldYes(t *testing.T) {
	repo := recordsRepo(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"records", "--repo", repo, "prune"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d, stderr %q", code, errOut.String())
	}
	if !strings.Contains(out.String(), "-old.md") || !strings.Contains(out.String(), "--yes") {
		t.Fatalf("dry run must list and say how to remove: %q", out.String())
	}
	entries, _ := os.ReadDir(filepath.Join(repo, "harness", "rules", "research"))
	if len(entries) != 2 {
		t.Fatal("a dry run removed something")
	}
	out.Reset()
	if code := run([]string{"records", "--repo", repo, "prune", "--yes"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d, stderr %q", code, errOut.String())
	}
	entries, _ = os.ReadDir(filepath.Join(repo, "harness", "rules", "research"))
	if len(entries) != 1 || entries[0].Name() != "INDEX.md" {
		t.Fatalf("left %v", entries)
	}
}

func TestRecordsCheckAndBadUsage(t *testing.T) {
	repo := recordsRepo(t)
	var out, errOut bytes.Buffer
	if code := run([]string{"records", "--repo", repo, "check"}, &out, &errOut); code != 0 || !strings.Contains(out.String(), "-old.md") {
		t.Fatalf("check: exit %d, out %q", code, out.String())
	}
	if code := run([]string{"records", "--repo", repo, "frob"}, &out, &errOut); code != 2 {
		t.Fatalf("bad subcommand: exit %d", code)
	}
	t.Setenv("DOTFILES_ROOT", "")
	if code := run([]string{"records", "check"}, &out, &errOut); code != 2 {
		t.Fatalf("no checkout: exit %d", code)
	}
}
