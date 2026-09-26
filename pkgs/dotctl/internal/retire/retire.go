// Package retire takes the old layout (domains/, core/, next/) off this
// Mac, once. It is the only code that knows that layout; `make up` does
// not. adopt-mac.sh runs it (`dotctl retire-old-layout`) after main is
// fast-forwarded and before `make up`, and the package leaves the
// repository with adopt-mac.sh and lib/moved.txt once the Mac has moved.
//
// In order, every step safe to run again:
//  1. carry: what a moved directory left behind goes to its new place
//     (lib/moved.txt); a file already there is never overwritten
//  2. links in ~, ~/.config and ~/bin into the old layout are removed, even
//     live ones: the old linker made them, and home-manager lays the new
//     ones in the switch that follows
//  3. what can be rebuilt (node_modules, __pycache__, jig's adapter builds,
//     Nix result links) is deleted
//  4. anything else left there is moved to <state>/retired/<date>/, never
//     deleted, and listed
//  5. empty directories go, and with them the old roots
//
// Backups home-manager made under the old name (*.pre-next) are listed, not
// touched: they are the owner's files.
package retire

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Roots are the old layout's top directories.
var Roots = []string{"domains", "core", "next"}

// Config is this checkout and this user.
type Config struct {
	Home, Repo string
	StateDir   string // default ~/.local/state/dotfiles
	Now        func() time.Time
	Log, Warn  func(string)
}

func (c Config) log(format string, a ...any) {
	if c.Log != nil {
		c.Log(fmt.Sprintf(format, a...))
	}
}

func (c Config) warn(format string, a ...any) {
	if c.Warn != nil {
		c.Warn(fmt.Sprintf(format, a...))
	}
}

// Run does the five steps.
func Run(c Config) error {
	if c.StateDir == "" {
		c.StateDir = filepath.Join(c.Home, ".local", "state", "dotfiles")
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	if err := carryOver(c); err != nil {
		c.warn("carrying machine-local files to moved directories: %v", err)
	}
	roots := c.oldRoots()
	unlinkOld(c, roots)
	var kept []string
	for _, root := range roots {
		kept = append(kept, clearRoot(c, root)...)
	}
	if len(kept) > 0 {
		c.warn("moved aside, not deleted (they differ from what the checkout has now):\n  %s", strings.Join(kept, "\n  "))
	}
	listPreNext(c)
	return nil
}

// oldRoots are the old layout's directories that still exist, absolute.
func (c Config) oldRoots() []string {
	var roots []string
	for _, r := range Roots {
		p := filepath.Join(c.Repo, r)
		if info, err := os.Lstat(p); err == nil && info.IsDir() {
			roots = append(roots, p)
		}
	}
	return roots
}

// unlinkOld removes the links in the places links are made that point into
// the old layout, broken or not.
func unlinkOld(c Config, roots []string) {
	if len(roots) == 0 {
		return
	}
	all := append([]string{}, roots...)
	for _, r := range roots {
		if real, err := filepath.EvalSymlinks(r); err == nil && real != r {
			all = append(all, real)
		}
	}
	for _, dir := range []string{c.Home, filepath.Join(c.Home, ".config"), filepath.Join(c.Home, "bin")} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.Type()&os.ModeSymlink == 0 {
				continue
			}
			link := filepath.Join(dir, e.Name())
			target, err := os.Readlink(link)
			if err != nil {
				continue
			}
			abs := target
			if !filepath.IsAbs(abs) {
				abs = filepath.Join(dir, abs)
			}
			if !under(filepath.Clean(abs), all) {
				continue
			}
			if err := os.Remove(link); err != nil {
				c.warn("could not remove %s: %v", link, err)
				continue
			}
			c.log("removed %s -> %s (the old layout's link)", link, target)
		}
	}
}

func under(path string, roots []string) bool {
	for _, r := range roots {
		if path == r || strings.HasPrefix(path, r+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// rebuildable is what the old layout held that its tools make again.
func rebuildable(path string, d fs.DirEntry) bool {
	name := d.Name()
	switch {
	case d.IsDir() && (name == "node_modules" || name == "__pycache__"):
		return true
	case d.IsDir() && name == "lib" && strings.Contains(path, "/adapters/"):
		return true // jig's adapter builds
	case d.Type()&os.ModeSymlink != 0 && strings.HasPrefix(name, "result"):
		target, _ := os.Readlink(path)
		return strings.HasPrefix(target, "/nix/store/")
	}
	return false
}

// clearRoot empties one old root: rebuildable things deleted, the rest
// moved aside; it returns what was moved aside.
func clearRoot(c Config, root string) []string {
	aside := filepath.Join(c.StateDir, "retired", c.Now().Format("2006-01-02"))
	var kept, dirs []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(c.Repo, path)
		if rebuildable(path, d) {
			if err := os.RemoveAll(path); err != nil {
				c.warn("could not delete %s: %v", path, err)
			} else {
				c.log("deleted %s (rebuilt by its tools)", rel)
			}
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			dirs = append(dirs, path)
			return nil
		}
		dest := filepath.Join(aside, rel)
		if _, err := os.Lstat(dest); err == nil {
			dest = fmt.Sprintf("%s.%d", dest, c.Now().UnixNano())
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
			c.warn("could not move %s aside: %v", path, err)
			return nil
		}
		if err := os.Rename(path, dest); err != nil {
			c.warn("could not move %s aside: %v", path, err)
			return nil
		}
		kept = append(kept, rel+" -> "+dest)
		return nil
	})
	sort.Sort(sort.Reverse(sort.StringSlice(dirs))) // deepest first
	for _, d := range dirs {
		_ = os.Remove(d) // one still holding something stays
	}
	if _, err := os.Lstat(root); errors.Is(err, fs.ErrNotExist) {
		c.log("removed %s", filepath.Base(root)+"/")
	}
	return kept
}

// listPreNext names the backups home-manager kept under the old suffix.
func listPreNext(c Config) {
	var found []string
	for _, dir := range []string{c.Home, filepath.Join(c.Home, ".config")} {
		matches, _ := filepath.Glob(filepath.Join(dir, "*.pre-next"))
		found = append(found, matches...)
		more, _ := filepath.Glob(filepath.Join(dir, ".*.pre-next"))
		found = append(found, more...)
	}
	if len(found) > 0 {
		sort.Strings(found)
		c.warn("backups made while moving here (.pre-next), yours to keep or delete:\n  %s", strings.Join(found, "\n  "))
	}
}
