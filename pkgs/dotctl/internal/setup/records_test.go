package setup

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRecordsTTLWarnsOfExpiredFlowAndNamesTheWayOut(t *testing.T) {
	w := newWorld(t, "git")
	w.env.Now = func() time.Time { return time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC) }
	write(t, filepath.Join(w.repo, "harness", "rules", "research", "2026-09-01-old.md"), "")
	write(t, filepath.Join(w.repo, "harness", "rules", "research", "2026-09-26-new.md"), "")
	write(t, filepath.Join(w.repo, "harness", "rules", "research", "experiment", "data.json"), "")
	w.sys.outputs["git -C "+w.repo+" log --diff-filter=A --format=%as --reverse -- harness/rules/research/experiment"] = "2026-09-02\n2026-09-20\n"
	if err := Run(w.env, "records-ttl"); err != nil {
		t.Fatal(err)
	}
	out := w.out.String()
	for _, want := range []string{"2026-09-01-old.md", "experiment", "/records-triage", "dotctl records prune --yes"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in %q", want, out)
		}
	}
	if strings.Contains(out, "2026-09-26-new.md") {
		t.Fatalf("a fresh record must not be listed: %q", out)
	}
}

func TestRecordsTTLIsQuietWhenNothingExpired(t *testing.T) {
	w := newWorld(t, "git")
	w.env.Now = func() time.Time { return time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC) }
	write(t, filepath.Join(w.repo, "plans", "2026-09-26-plan.md"), "")
	if err := Run(w.env, "records-ttl"); err != nil {
		t.Fatal(err)
	}
	if w.out.Len() != 0 {
		t.Fatalf("out %q", w.out.String())
	}
}
