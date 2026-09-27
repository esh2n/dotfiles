// Package records keeps the checkout's flow documents from piling up
// (harness/rules/decisions/2026-09-27-records-flow-and-stock.md). Research
// records and plans are flow: each lives TTL from the day it was written,
// then it is promoted into stock (harness/rules/knowledge/ or a decision
// note) by the records-triage skill, or it goes. Expired finds what is past
// its time; Prune removes it, with its line in the research INDEX.
package records

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// TTL is how long a flow document stays before it is promoted or removed.
const TTL = 14 * 24 * time.Hour

// FlowDirs are the checkout's flow directories, slash-separated from the root.
var FlowDirs = []string{"harness/rules/research", "plans"}

// kept are the entries of a flow directory that are not documents.
var kept = map[string]bool{"INDEX.md": true, "README.md": true}

var datePrefix = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})-`)

// Item is one flow entry (a file or a directory) and the day it was written.
type Item struct {
	Path string // slash-separated, from the checkout's root
	Date time.Time
}

// DateOf dates an entry whose name carries no date, by its first commit;
// false when that is unknown too.
type DateOf func(rel string) (time.Time, bool)

// Expired lists the flow entries older than ttl at now, oldest first. An
// entry's date is its name's YYYY-MM-DD prefix, else dateOf's; an entry with
// neither is left out rather than guessed.
func Expired(repo string, now time.Time, ttl time.Duration, dateOf DateOf) ([]Item, error) {
	// whole days: an entry written on the 13th is still inside on the 27th
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var out []Item
	for _, dir := range FlowDirs {
		entries, err := os.ReadDir(filepath.Join(repo, filepath.FromSlash(dir)))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			if kept[e.Name()] || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			rel := path.Join(dir, e.Name())
			date, ok := nameDate(e.Name())
			if !ok {
				date, ok = dateOf(rel)
			}
			if ok && today.Sub(date) > ttl {
				out = append(out, Item{Path: rel, Date: date})
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Date.Before(out[j].Date) })
	return out, nil
}

func nameDate(name string) (time.Time, bool) {
	m := datePrefix.FindStringSubmatch(name)
	if m == nil {
		return time.Time{}, false
	}
	d, err := time.Parse("2006-01-02", m[1])
	return d, err == nil
}

// Prune removes each item and drops the research INDEX lines that link to
// it. It refuses, before touching anything, a path that is not directly
// inside a flow directory — stock (decisions, knowledge) is never pruned.
func Prune(repo string, items []Item) error {
	for _, it := range items {
		if !inFlow(it.Path) {
			return fmt.Errorf("not a flow document: %s", it.Path)
		}
	}
	for _, it := range items {
		if err := os.RemoveAll(filepath.Join(repo, filepath.FromSlash(it.Path))); err != nil {
			return err
		}
	}
	return dropIndexLines(repo, items)
}

func inFlow(rel string) bool {
	clean := path.Clean(rel)
	if clean != rel {
		return false
	}
	dir, name := path.Split(clean)
	dir = strings.TrimSuffix(dir, "/")
	if kept[name] || name == "" || name == ".." {
		return false
	}
	for _, d := range FlowDirs {
		if dir == d {
			return true
		}
	}
	return false
}

// dropIndexLines rewrites research/INDEX.md without the lines that link into
// a removed research entry. Other lines are kept byte for byte.
func dropIndexLines(repo string, items []Item) error {
	research := FlowDirs[0]
	index := filepath.Join(repo, filepath.FromSlash(research), "INDEX.md")
	body, err := os.ReadFile(index)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var targets []string
	for _, it := range items {
		if dir, name := path.Split(it.Path); strings.TrimSuffix(dir, "/") == research {
			targets = append(targets, "]("+name+")", "]("+name+"/")
		}
	}
	lines := strings.SplitAfter(string(body), "\n")
	var rest strings.Builder
	for _, line := range lines {
		if !linksAny(line, targets) {
			rest.WriteString(line)
		}
	}
	if rest.Len() == len(body) {
		return nil
	}
	return os.WriteFile(index, []byte(rest.String()), 0o644)
}

func linksAny(line string, targets []string) bool {
	for _, t := range targets {
		if strings.Contains(line, t) {
			return true
		}
	}
	return false
}
