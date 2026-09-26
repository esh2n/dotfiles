// Package cachegc keeps Codebase-Memory's indexes within an age and a size
// limit without deleting SQLite files behind the server's back: projects are
// removed only through its lock-aware CLI (the Index interface).
//
// When a project was last used is recorded by this package, one stamp per
// repository root in StateDir (<sha256 of the root>.json, {"root_path",
// "last_used"}), the same files the old shell script wrote.
package cachegc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Project is one index as the Codebase-Memory CLI lists it.
type Project struct {
	Name string `json:"name"`
	Root string `json:"root_path"`
	Size int64  `json:"size_bytes"`
}

// Index lists and deletes projects; the real one runs codebase-memory-mcp.
type Index interface {
	List() ([]Project, error)
	Delete(name string) error
}

// Config holds the limits; Now is injected so tests control the clock.
type Config struct {
	StateDir string
	TTL      time.Duration
	MaxBytes int64
	Interval time.Duration // at most one run per interval unless Force
	Now      func() time.Time
	Force    bool
	DryRun   bool
}

// Removal is one index a run removed, and why: "expire" (unused for longer
// than TTL) or "evict" (least recently used while above MaxBytes).
type Removal struct {
	Project
	Reason string
}

// Result says what a run removed (or would remove, in a dry run).
type Result struct {
	Removed   []Removal
	Skipped   bool  // within the interval, or another run holds the lock
	OverLimit bool  // still above MaxBytes: only indexes used in the last day remain
	Total     int64 // bytes left after the run
	MaxBytes  int64
}

func hashOf(root string) string {
	sum := sha256.Sum256([]byte(root))
	return hex.EncodeToString(sum[:])
}

type stampFile struct {
	RootPath string `json:"root_path"`
	LastUsed int64  `json:"last_used"`
}

func (c Config) stampPath(root string) string {
	return filepath.Join(c.StateDir, hashOf(root)+".json")
}

func (c Config) writeStamp(root string, at time.Time) error {
	b, err := json.Marshal(stampFile{RootPath: root, LastUsed: at.Unix()})
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(c.StateDir, ".stamp-")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), c.stampPath(root))
}

// lastUsed reads a root's stamp; ok is false when there is none.
func (c Config) lastUsed(root string) (time.Time, bool) {
	b, err := os.ReadFile(c.stampPath(root))
	if err != nil {
		return time.Time{}, false
	}
	var s stampFile
	if json.Unmarshal(b, &s) != nil {
		return time.Unix(0, 0), true
	}
	return time.Unix(s.LastUsed, 0), true
}

// Touch records that the repository at root was just used.
func Touch(c Config, root string) error {
	if err := os.MkdirAll(c.StateDir, 0o700); err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	return c.writeStamp(root, c.Now())
}

// Run expires indexes unused for longer than TTL, then evicts the least
// recently used ones while the total is above MaxBytes — never one used in
// the last day. A project seen for the first time gets a full TTL.
func Run(c Config, idx Index) (Result, error) {
	var res Result
	if err := os.MkdirAll(c.StateDir, 0o700); err != nil {
		return res, err
	}
	now := c.Now()
	lastGC := filepath.Join(c.StateDir, ".last-gc")
	if !c.Force {
		if info, err := os.Stat(lastGC); err == nil && now.Sub(info.ModTime()) < c.Interval {
			res.Skipped = true
			return res, nil
		}
	}
	lock := filepath.Join(c.StateDir, ".gc-lock")
	if err := os.Mkdir(lock, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			res.Skipped = true
			return res, nil
		}
		return res, err
	}
	defer os.Remove(lock)

	projects, err := idx.List()
	if err != nil {
		return res, err
	}
	var total int64
	for _, p := range projects {
		total += p.Size
	}
	remove := func(p Project, reason string) error {
		res.Removed = append(res.Removed, Removal{p, reason})
		total -= p.Size
		if c.DryRun {
			return nil
		}
		if err := idx.Delete(p.Name); err != nil {
			return fmt.Errorf("delete %s: %w", p.Name, err)
		}
		return os.Remove(c.stampPath(p.Root))
	}

	type aged struct {
		Project
		used time.Time
	}
	var kept []aged
	for _, p := range projects {
		if p.Name == "" || p.Root == "" {
			continue
		}
		used, ok := c.lastUsed(p.Root)
		if !ok {
			if err := c.writeStamp(p.Root, now); err != nil {
				return res, err
			}
			continue
		}
		if now.Sub(used) > c.TTL {
			if err := remove(p, "expire"); err != nil {
				return res, err
			}
			continue
		}
		kept = append(kept, aged{p, used})
	}

	sort.SliceStable(kept, func(i, j int) bool { return kept[i].used.Before(kept[j].used) })
	for _, a := range kept {
		if total <= c.MaxBytes {
			break
		}
		if now.Sub(a.used) <= 24*time.Hour {
			continue
		}
		if err := remove(a.Project, "evict"); err != nil {
			return res, err
		}
	}
	res.OverLimit = total > c.MaxBytes
	res.Total, res.MaxBytes = total, c.MaxBytes

	if !c.DryRun {
		if err := os.WriteFile(lastGC, nil, 0o600); err != nil {
			return res, err
		}
		if err := os.Chtimes(lastGC, now, now); err != nil {
			return res, err
		}
	}
	return res, nil
}

// ParseProjects reads list_projects output; newer CLIs wrap the payload as
// MCP text content.
func ParseProjects(raw []byte) ([]Project, error) {
	var doc struct {
		Projects *[]Project `json:"projects"`
		Content  []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	if doc.Projects != nil {
		return *doc.Projects, nil
	}
	if len(doc.Content) > 0 {
		return ParseProjects([]byte(doc.Content[0].Text))
	}
	return nil, nil
}
