package records

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

var now = time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)

func noGit(string) (time.Time, bool) { return time.Time{}, false }

func paths(items []Item) []string {
	var out []string
	for _, it := range items {
		out = append(out, it.Path)
	}
	return out
}

func TestExpiredTakesTheDateFromTheName(t *testing.T) {
	repo := t.TempDir()
	research := filepath.Join(repo, "harness", "rules", "research")
	write(t, filepath.Join(research, "2026-09-10-old.md"), "")
	write(t, filepath.Join(research, "2026-09-13-edge.md"), "") // exactly 14 days: still inside
	write(t, filepath.Join(research, "2026-09-20-new.md"), "")
	write(t, filepath.Join(research, "INDEX.md"), "")
	write(t, filepath.Join(repo, "plans", "2026-09-01-plan.md"), "")
	write(t, filepath.Join(repo, "plans", "README.md"), "")
	got, err := Expired(repo, now, TTL, noGit)
	if err != nil {
		t.Fatal(err)
	}
	want := "plans/2026-09-01-plan.md|harness/rules/research/2026-09-10-old.md" // oldest first
	if strings.Join(paths(got), "|") != want {
		t.Fatalf("got %v, want %s", paths(got), want)
	}
}

func TestExpiredDatesAnUndatedEntryByItsFirstCommit(t *testing.T) {
	repo := t.TempDir()
	research := filepath.Join(repo, "harness", "rules", "research")
	write(t, filepath.Join(research, "experiment", "data.json"), "")
	write(t, filepath.Join(research, "fresh", "data.json"), "")
	write(t, filepath.Join(research, "unknown", "data.json"), "")
	dateOf := func(rel string) (time.Time, bool) {
		switch rel {
		case "harness/rules/research/experiment":
			return time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), true
		case "harness/rules/research/fresh":
			return time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC), true
		}
		return time.Time{}, false
	}
	got, err := Expired(repo, now, TTL, dateOf)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(paths(got), "|") != "harness/rules/research/experiment" {
		t.Fatalf("got %v", paths(got))
	}
}

func TestExpiredWithoutTheFlowDirsIsEmpty(t *testing.T) {
	got, err := Expired(t.TempDir(), now, TTL, noGit)
	if err != nil || len(got) != 0 {
		t.Fatalf("%v %v", got, err)
	}
}

func TestPruneRemovesTheEntriesAndTheirIndexLines(t *testing.T) {
	repo := t.TempDir()
	research := filepath.Join(repo, "harness", "rules", "research")
	write(t, filepath.Join(research, "2026-09-10-old.md"), "")
	write(t, filepath.Join(research, "experiment", "data.json"), "")
	write(t, filepath.Join(research, "2026-09-20-new.md"), "")
	write(t, filepath.Join(research, "INDEX.md"),
		"# Index\n- [old](2026-09-10-old.md) — gone\n- [exp](experiment/README.md) — gone\n- [new](2026-09-20-new.md) — kept\n")
	items := []Item{
		{Path: "harness/rules/research/2026-09-10-old.md"},
		{Path: "harness/rules/research/experiment"},
	}
	if err := Prune(repo, items); err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{"2026-09-10-old.md", "experiment"} {
		if _, err := os.Stat(filepath.Join(research, gone)); !os.IsNotExist(err) {
			t.Fatalf("%s still there", gone)
		}
	}
	index, _ := os.ReadFile(filepath.Join(research, "INDEX.md"))
	if string(index) != "# Index\n- [new](2026-09-20-new.md) — kept\n" {
		t.Fatalf("index %q", index)
	}
}

func TestPruneRefusesAPathOutsideTheFlowDirs(t *testing.T) {
	repo := t.TempDir()
	write(t, filepath.Join(repo, "harness", "rules", "decisions", "2026-09-01-x.md"), "")
	for _, p := range []string{"harness/rules/decisions/2026-09-01-x.md", "plans/../harness", "../outside"} {
		if err := Prune(repo, []Item{{Path: p}}); err == nil {
			t.Fatalf("%s: must refuse", p)
		}
	}
	if _, err := os.Stat(filepath.Join(repo, "harness", "rules", "decisions", "2026-09-01-x.md")); err != nil {
		t.Fatal("a stock record was touched")
	}
}
