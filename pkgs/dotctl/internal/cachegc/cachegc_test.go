package cachegc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

type fakeIndex struct {
	projects []Project
	deleted  []string
}

func (f *fakeIndex) List() ([]Project, error) { return f.projects, nil }
func (f *fakeIndex) Delete(name string) error {
	f.deleted = append(f.deleted, name)
	return nil
}

var now = time.Unix(1_800_000_000, 0)

func stamp(t *testing.T, dir, root string, lastUsed time.Time) {
	t.Helper()
	sum := sha256.Sum256([]byte(root))
	b, _ := json.Marshal(map[string]any{"root_path": root, "last_used": lastUsed.Unix()})
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, hex.EncodeToString(sum[:])+".json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func config(t *testing.T) Config {
	return Config{
		StateDir: filepath.Join(t.TempDir(), "dotfiles-access"),
		TTL:      30 * 24 * time.Hour,
		MaxBytes: 5 << 30,
		Interval: 24 * time.Hour,
		Now:      func() time.Time { return now },
		Force:    true,
	}
}

func TestFirstSightingGetsAGracePeriod(t *testing.T) {
	c := config(t)
	idx := &fakeIndex{projects: []Project{{Name: "a", Root: "/r/a", Size: 10}}}
	if _, err := Run(c, idx); err != nil {
		t.Fatal(err)
	}
	if len(idx.deleted) != 0 {
		t.Fatalf("deleted on first sight: %v", idx.deleted)
	}
	if _, err := os.Stat(filepath.Join(c.StateDir, hashOf("/r/a")+".json")); err != nil {
		t.Fatal("no stamp written on first sight")
	}
}

func TestExpiredProjectsAreDeletedThroughTheIndex(t *testing.T) {
	c := config(t)
	stamp(t, c.StateDir, "/r/old", now.Add(-31*24*time.Hour))
	stamp(t, c.StateDir, "/r/new", now.Add(-time.Hour))
	idx := &fakeIndex{projects: []Project{{Name: "old", Root: "/r/old", Size: 1}, {Name: "new", Root: "/r/new", Size: 1}}}
	if _, err := Run(c, idx); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(idx.deleted, []string{"old"}) {
		t.Fatalf("deleted %v, want [old]", idx.deleted)
	}
}

func TestSizePressureEvictsLeastRecentButNeverTheLastDay(t *testing.T) {
	c := config(t)
	c.MaxBytes = 50
	stamp(t, c.StateDir, "/r/a", now.Add(-10*24*time.Hour))
	stamp(t, c.StateDir, "/r/b", now.Add(-5*24*time.Hour))
	stamp(t, c.StateDir, "/r/c", now.Add(-time.Hour))
	idx := &fakeIndex{projects: []Project{
		{Name: "a", Root: "/r/a", Size: 60},
		{Name: "b", Root: "/r/b", Size: 60},
		{Name: "c", Root: "/r/c", Size: 60},
	}}
	res, err := Run(c, idx)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(idx.deleted, []string{"a", "b"}) {
		t.Fatalf("evicted %v, want [a b] (oldest first, c used today)", idx.deleted)
	}
	if !res.OverLimit {
		t.Fatal("still above the limit, but not reported")
	}
}

func TestDryRunDeletesNothing(t *testing.T) {
	c := config(t)
	c.DryRun = true
	stamp(t, c.StateDir, "/r/old", now.Add(-40*24*time.Hour))
	idx := &fakeIndex{projects: []Project{{Name: "old", Root: "/r/old", Size: 1}}}
	res, err := Run(c, idx)
	if err != nil {
		t.Fatal(err)
	}
	if len(idx.deleted) != 0 || !slices.Equal(res.Removed, []string{"old"}) {
		t.Fatalf("dry run deleted %v, reported %v", idx.deleted, res.Removed)
	}
}

func TestRunsAtMostOncePerIntervalUnlessForced(t *testing.T) {
	c := config(t)
	c.Force = false
	stamp(t, c.StateDir, "/r/old", now.Add(-40*24*time.Hour))
	idx := &fakeIndex{projects: []Project{{Name: "old", Root: "/r/old", Size: 1}}}
	if _, err := Run(c, idx); err != nil {
		t.Fatal(err)
	}
	idx.deleted = nil
	stamp(t, c.StateDir, "/r/old", now.Add(-40*24*time.Hour))
	if _, err := Run(c, idx); err != nil {
		t.Fatal(err)
	}
	if len(idx.deleted) != 0 {
		t.Fatal("ran again within the interval")
	}
}

func TestTouchWritesTheStampTheShellScriptWrote(t *testing.T) {
	c := config(t)
	root := t.TempDir()
	if err := Touch(c, root); err != nil {
		t.Fatal(err)
	}
	resolved, _ := filepath.EvalSymlinks(root)
	b, err := os.ReadFile(filepath.Join(c.StateDir, hashOf(resolved)+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var s struct {
		RootPath string `json:"root_path"`
		LastUsed int64  `json:"last_used"`
	}
	if err := json.Unmarshal(b, &s); err != nil || s.RootPath != resolved || s.LastUsed != now.Unix() {
		t.Fatalf("stamp = %s (%v)", b, err)
	}
}

func TestParseProjectsAcceptsBothCLIShapes(t *testing.T) {
	direct := `{"projects":[{"name":"a","root_path":"/r/a","size_bytes":3}]}`
	wrapped := `{"content":[{"type":"text","text":"{\"projects\":[{\"name\":\"a\",\"root_path\":\"/r/a\",\"size_bytes\":3}]}"}]}`
	for _, raw := range []string{direct, wrapped} {
		ps, err := ParseProjects([]byte(raw))
		if err != nil || len(ps) != 1 || ps[0] != (Project{Name: "a", Root: "/r/a", Size: 3}) {
			t.Fatalf("ParseProjects(%s) = %v, %v", raw, ps, err)
		}
	}
}
