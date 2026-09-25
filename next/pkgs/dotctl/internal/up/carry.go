package up

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// movedList is the committed record of directories the layout moved
// ("<old> <new>" per line, paths from the checkout's root).
const movedList = "next/lib/moved.txt"

// carryOver moves what a moved directory left behind at its old place into
// its new one. git moves only the files it tracks; the machine-local ones
// beside them (git's conditional includes, an app's own state, rendered
// files) stay in the old directory, and the link now points at the new one.
// A file already at the new place is never overwritten; what is left over
// is reported. Empty old directories are removed.
func carryOver(c Config) error {
	f, err := os.Open(filepath.Join(c.Repo, movedList))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 || !local(fields[0]) || !local(fields[1]) {
			c.warn("%s: skipping %q (want \"<old> <new>\" inside the checkout)", movedList, line)
			continue
		}
		carryDir(c, filepath.Join(c.Repo, fields[0]), filepath.Join(c.Repo, fields[1]))
	}
	return sc.Err()
}

// local is a clean relative path that stays inside the checkout.
func local(p string) bool {
	return p != "" && !filepath.IsAbs(p) && filepath.Clean(p) == p && !strings.HasPrefix(p, "..")
}

func carryDir(c Config, oldDir, newDir string) {
	info, err := os.Lstat(oldDir)
	if err != nil || !info.IsDir() {
		return
	}
	var dirs []string
	_ = filepath.WalkDir(oldDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(oldDir, path)
		dest := filepath.Join(newDir, rel)
		if d.IsDir() {
			// a directory the new place does not have moves whole, in one
			// rename (an app's state tree can hold thousands of files)
			if path != oldDir {
				if _, err := os.Lstat(dest); errors.Is(err, fs.ErrNotExist) {
					if err := os.MkdirAll(filepath.Dir(dest), 0o755); err == nil && os.Rename(path, dest) == nil {
						c.log("carried %s to %s", path, dest)
						return filepath.SkipDir
					}
				}
			}
			dirs = append(dirs, path)
			return nil
		}
		if _, err := os.Lstat(dest); err == nil {
			c.warn("%s was left at the old place and %s already exists; keeping both", path, dest)
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			c.warn("carrying %s: %v", path, err)
			return nil
		}
		if err := os.Rename(path, dest); err != nil {
			c.warn("carrying %s: %v", path, err)
			return nil
		}
		c.log("carried %s to %s", path, dest)
		return nil
	})
	// deepest first; a directory that still holds something stays
	for i := len(dirs) - 1; i >= 0; i-- {
		_ = os.Remove(dirs[i])
	}
}
