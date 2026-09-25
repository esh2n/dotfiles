// Package nvim switches which Neovim distribution ~/.config/nvim is.
//
// Each distribution lives in ~/.config/nvim-<name> (linked into the checkout
// by home-manager); ~/.config/nvim is a symlink to one of them. A real
// directory found at ~/.config/nvim is kept as nvim.backup.<time>, never
// deleted.
package nvim

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Distributions are the names a switch accepts, in the order List shows them.
var Distributions = []string{"custom", "nvchad", "lazyvim", "astrovim"}

func active(home string) string { return filepath.Join(home, ".config", "nvim") }

func distribution(home, name string) string {
	return filepath.Join(home, ".config", "nvim-"+name)
}

// Current names the distribution ~/.config/nvim points at; "custom" when it
// is not a symlink (the old default).
func Current(home string) string {
	target, err := os.Readlink(active(home))
	if err != nil {
		return "custom"
	}
	return strings.TrimPrefix(filepath.Base(target), "nvim-")
}

// Switch points ~/.config/nvim at ~/.config/nvim-<name>. now names the
// backup of a real directory found in the way.
func Switch(home, name string, now time.Time) error {
	if !slices.Contains(Distributions, name) {
		return fmt.Errorf("unknown distribution %q (known: %s)", name, strings.Join(Distributions, ", "))
	}
	target := distribution(home, name)
	if info, err := os.Stat(target); err != nil || !info.IsDir() {
		return fmt.Errorf("%s does not exist", target)
	}
	link := active(home)
	info, err := os.Lstat(link)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return err
	case info.Mode()&os.ModeSymlink != 0:
		if err := os.Remove(link); err != nil {
			return err
		}
	default:
		backup := filepath.Join(home, ".config", "nvim.backup."+now.Format("20060102-150405"))
		if err := os.Rename(link, backup); err != nil {
			return fmt.Errorf("keeping %s as %s: %w", link, backup, err)
		}
	}
	return os.Symlink(target, link)
}
