package setup

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// makeHomeDirs creates dir under the home directory the way home-manager
// treats a path it needs (rules/knowledge/dotfiles-migration-cleanup.md):
// anything standing where a directory has to be — a file, a broken link, a
// link to a file, often left by an earlier dotfiles setup — is moved aside
// with the ".pre-dotfiles" suffix, never deleted.
func makeHomeDirs(e Env, dir string) error {
	rel, err := filepath.Rel(e.Home, dir)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return os.MkdirAll(dir, 0o755)
	}
	at := e.Home
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		at = filepath.Join(at, part)
		if _, err := os.Lstat(at); os.IsNotExist(err) {
			break
		}
		if info, err := os.Stat(at); err == nil && info.IsDir() {
			continue
		}
		aside, err := moveAside(at)
		if err != nil {
			return err
		}
		e.UI.Warn("%s was in the way (not a directory); moved to %s", at, aside)
		break
	}
	return os.MkdirAll(dir, 0o755)
}

// moveAside renames path to path.pre-dotfiles, or path.pre-dotfiles.N when that is
// taken, and says where it went.
func moveAside(path string) (string, error) {
	aside := path + ".pre-dotfiles"
	for n := 1; ; n++ {
		if _, err := os.Lstat(aside); os.IsNotExist(err) {
			break
		}
		aside = fmt.Sprintf("%s.pre-dotfiles.%d", path, n)
	}
	return aside, os.Rename(path, aside)
}
