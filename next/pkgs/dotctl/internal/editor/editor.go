// Package editor installs the checkout's editor extensions
// (next/home/darwin/vscode/config/extensions.txt) into every VS Code-family
// editor that is installed (was install-extensions).
package editor

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/next/pkgs/dotctl/internal/ui"
)

// Sys is the machine. sys.OS is the real one.
type Sys interface {
	Exec(c sys.Cmd) (string, string, error)
	Has(name string) bool
}

// Editors are the command and name of each editor that reads the list.
var Editors = [][2]string{{"code", "VS Code"}, {"cursor", "Cursor"}}

// List reads the extension ids: one per line, # starts a comment.
func List(text string) []string {
	var ids []string
	for _, line := range strings.Split(text, "\n") {
		if i := strings.Index(line, "#"); i >= 0 {
			line = line[:i]
		}
		if id := strings.TrimSpace(line); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

// Install installs the list into each editor present, warning per
// extension that fails. The error is only for a missing list.
func Install(s Sys, p ui.Printer, repo string) error {
	file := filepath.Join(repo, "next", "home", "darwin", "vscode", "config", "extensions.txt")
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	ids := List(string(b))
	for _, ed := range Editors {
		cmd, name := ed[0], ed[1]
		if !s.Has(cmd) {
			p.Warn("%s is not installed; skipped", name)
			continue
		}
		p.Note("installing %d %s extensions", len(ids), name)
		failed := 0
		for _, id := range ids {
			if _, _, err := s.Exec(sys.Cmd{Name: cmd, Args: []string{"--install-extension", id}, Timeout: 5 * time.Minute}); err != nil {
				p.Warn("%s: %s failed: %v", name, id, err)
				failed++
			}
		}
		list, _, _ := s.Exec(sys.Cmd{Name: cmd, Args: []string{"--list-extensions"}, Timeout: time.Minute})
		p.Note("%s: %d installed, %d failed; %d extensions in all", name, len(ids)-failed, failed, len(List(list)))
	}
	return nil
}
