// Package editor installs the checkout's editor extensions
// (home/darwin/vscode/config/extensions.txt) into every VS Code-family
// editor that is installed (was install-extensions).
//
// A line is a marketplace id, or the https URL of a .vsix file for
// extensions published only as release assets. In a URL, {platform}
// stands for this machine's VS Code target (darwin-arm64, linux-x64, ...).
package editor

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/sys"
	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
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

// Platform is the VS Code target name for an OS and architecture, as
// release assets are named; "" for one VS Code does not target.
func Platform(goos, goarch string) string {
	system := map[string]string{"darwin": "darwin", "linux": "linux", "windows": "win32"}[goos]
	arch := map[string]string{"arm64": "arm64", "amd64": "x64"}[goarch]
	if system == "" || arch == "" {
		return ""
	}
	return system + "-" + arch
}

// isURL reports whether a list entry is a .vsix to download rather than
// a marketplace id.
func isURL(entry string) bool { return strings.HasPrefix(entry, "https://") }

// resolve turns each entry into what --install-extension takes: ids as
// they are, URLs downloaded once into dir. An entry that cannot be
// fetched is warned about and left out.
func resolve(s Sys, p ui.Printer, entries []string, dir string) []string {
	platform := Platform(runtime.GOOS, runtime.GOARCH)
	var out []string
	for i, e := range entries {
		if !isURL(e) {
			out = append(out, e)
			continue
		}
		url := strings.ReplaceAll(e, "{platform}", platform)
		if strings.Contains(e, "{platform}") && platform == "" {
			p.Warn("%s: no build for %s/%s; skipped", e, runtime.GOOS, runtime.GOARCH)
			continue
		}
		file := filepath.Join(dir, fmt.Sprintf("%d-%s", i, filepath.Base(url)))
		if _, _, err := s.Exec(sys.Cmd{Name: "curl", Args: []string{"-fsSL", "-o", file, url}, Timeout: 5 * time.Minute}); err != nil {
			p.Warn("%s: download failed: %v", url, err)
			continue
		}
		out = append(out, file)
	}
	return out
}

// Install installs the list into each editor present, warning per
// extension that fails. The error is only for a missing list.
func Install(s Sys, p ui.Printer, repo string) error {
	file := filepath.Join(repo, "home", "darwin", "vscode", "config", "extensions.txt")
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "dotctl-extensions-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	ids := resolve(s, p, List(string(b)), dir)
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
