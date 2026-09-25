package nvim

import (
	"fmt"
	"os"
	"path/filepath"
)

// Sources are where each distribution's files come from. custom is the
// checkout's own and has none.
var Sources = map[string]string{
	"lazyvim":  "https://github.com/LazyVim/starter",
	"nvchad":   "https://github.com/NvChad/NvChad",
	"astrovim": "https://github.com/AstroNvim/AstroNvim",
}

// Cloner fetches a repository into a directory (git clone).
type Cloner func(url, dir string) error

// Install puts every distribution's files into the checkout's
// domains/dev/config/nvim-<name> (which home-manager links as
// ~/.config/nvim-<name>), cloned once and kept without their .git so the
// checkout tracks them. It returns the names it installed.
func Install(repo string, clone Cloner) ([]string, error) {
	var done []string
	for _, name := range []string{"lazyvim", "nvchad", "astrovim"} {
		dir := filepath.Join(repo, "domains", "dev", "config", "nvim-"+name)
		if _, err := os.Stat(dir); err == nil {
			continue
		}
		if err := clone(Sources[name], dir); err != nil {
			return done, fmt.Errorf("cloning %s: %w", name, err)
		}
		if err := os.RemoveAll(filepath.Join(dir, ".git")); err != nil {
			return done, err
		}
		done = append(done, name)
	}
	return done, nil
}
