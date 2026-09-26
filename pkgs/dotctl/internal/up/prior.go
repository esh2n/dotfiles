package up

import (
	"os"
	"path/filepath"
	"strings"
)

// sweepPriorLinks deals with the links an earlier dotfiles setup left in
// the places they are made — ~, ~/.config and ~/bin, top level only —
// before the switch lays the new ones
// (rules/research/2026-09-26-dotfiles-prior-state-cleanup.md):
//
//   - a link into this checkout whose target is gone was made by this
//     repository's old layout: it is removed (dotbot's `clean` rule)
//   - a link into another dotfiles checkout, or any other broken link, is
//     not ours to judge: it is listed, never touched
//
// A path the new setup needs is not decided here: home-manager moves what
// is in its way aside (backupFileExtension "pre-next"), and so do the setup
// steps.
func sweepPriorLinks(c Config) {
	repos := []string{filepath.Clean(c.Repo)}
	if real, err := filepath.EvalSymlinks(c.Repo); err == nil && real != repos[0] {
		repos = append(repos, real)
	}
	var foreign []string
	for _, dir := range []string{c.Home, filepath.Join(c.Home, ".config"), filepath.Join(c.Home, "bin")} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.Type()&os.ModeSymlink == 0 {
				continue
			}
			link := filepath.Join(dir, entry.Name())
			target, err := os.Readlink(link)
			// home-manager's own links go through the store; its switch
			// replaces them, broken or not
			if err != nil || strings.HasPrefix(target, "/nix/store/") {
				continue
			}
			abs := target
			if !filepath.IsAbs(abs) {
				abs = filepath.Join(dir, abs)
			}
			abs = resolveExisting(filepath.Clean(abs))
			_, statErr := os.Stat(link)
			broken := statErr != nil
			switch {
			case within(abs, repos) && broken:
				if err := os.Remove(link); err != nil {
					c.warn("could not remove the stale link %s: %v", link, err)
					continue
				}
				c.log("removed %s -> %s (this checkout no longer has it)", link, target)
			case within(abs, repos):
			case broken:
				foreign = append(foreign, link+" -> "+target+" (broken)")
			case strings.Contains(abs, "dotfiles"):
				foreign = append(foreign, link+" -> "+target+" (another dotfiles checkout)")
			}
		}
	}
	if len(foreign) > 0 {
		c.warn("links from another setup were left as they are (remove them by hand if they are no longer wanted):\n  %s",
			strings.Join(foreign, "\n  "))
	}
}

// within is whether path is one of roots or below one.
func within(path string, roots []string) bool {
	for _, root := range roots {
		if path == root || strings.HasPrefix(path, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// resolveExisting resolves the links along the part of path that still
// exists, so a target spelled through a linked directory (/var on macOS)
// compares equal to the checkout's real path.
func resolveExisting(path string) string {
	rest := ""
	for dir := path; ; {
		if real, err := filepath.EvalSymlinks(dir); err == nil {
			return filepath.Join(real, rest)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return path
		}
		rest = filepath.Join(filepath.Base(dir), rest)
		dir = parent
	}
}
