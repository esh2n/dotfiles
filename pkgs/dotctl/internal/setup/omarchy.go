package setup

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Omarchy's extras beyond its own shell: themes from git and the Quickshell
// Rise bar. Both are installed once, on a machine that lacks them, and then
// belong to the machine — Omarchy's theme switcher and Rise's own updater
// change them from there, so a second make up never reinstalls either.

var omarchyThemeAffixes = regexp.MustCompile(`^omarchy-|-theme$`)

// omarchyThemeName is the directory omarchy-theme-install clones into: the
// repository's name without .git, an omarchy- prefix or a -theme suffix,
// lower-cased (the same rule as /usr/bin/omarchy-theme-install).
func omarchyThemeName(url string) string {
	name := strings.ToLower(strings.TrimSuffix(filepath.Base(url), ".git"))
	return omarchyThemeAffixes.ReplaceAllString(name, "")
}

// omarchyThemes installs each theme listed in home/linux/omarchy-shell/themes
// that ~/.config/omarchy/themes lacks. omarchy-theme-install also switches to
// the theme, so a new machine starts on the last one it installed; a machine
// that has them keeps whichever theme it is on.
func omarchyThemes(e Env) error {
	if !e.Sys.Has("omarchy") || !e.need("omarchy-theme-install") {
		return nil
	}
	body, err := os.ReadFile(filepath.Join(e.Repo, "home", "linux", "omarchy-shell", "themes"))
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(body), "\n") {
		url := strings.TrimSpace(line)
		if url == "" || strings.HasPrefix(url, "#") {
			continue
		}
		if exists(e.path(".config", "omarchy", "themes", omarchyThemeName(url))) {
			continue
		}
		if err := e.quiet(5*time.Minute, "omarchy-theme-install", url); err != nil {
			e.UI.Warn("%v", err)
		}
	}
	return nil
}

// quickshellRiseInstaller is Rise's own installer; it clones the bar from the
// same repository's main branch.
const quickshellRiseInstaller = "https://raw.githubusercontent.com/HANCORE-linux/quickshell-dots/main/install.sh"

// quickshellRiseFonts are the fonts the installer requires, by the name
// fc-list shows, with the pacman package that provides each.
var quickshellRiseFonts = []struct{ family, pkg string }{
	{"JetBrainsMono Nerd", "ttf-jetbrains-mono-nerd"},
	{"Material Symbols", "ttf-material-symbols-variable"},
}

// quickshellRise installs the Rise bar (V1, started at login, which hides
// Omarchy's stock bar; no AI usage backend, which would read Claude Code's
// credentials) unless ~/.config/quickshell/bar already holds it. The
// installer runs `sudo pacman` for a missing font, which activation cannot
// answer, so a missing font is named for the owner to install and the bar
// waits for the next make up.
func quickshellRise(e Env) error {
	if !e.Sys.Has("omarchy") || !e.need("qs") {
		return nil
	}
	if exists(e.path(".config", "quickshell", "bar", ".qsrise")) {
		return nil
	}
	fonts, _, err := e.Sys.Capture(time.Minute, "fc-list")
	if err != nil {
		return err
	}
	var missing []string
	for _, f := range quickshellRiseFonts {
		if !strings.Contains(fonts, f.family) {
			missing = append(missing, f.pkg)
		}
	}
	if len(missing) > 0 {
		e.UI.Warn("Quickshell Rise needs fonts first: sudo pacman -S %s, then make up", strings.Join(missing, " "))
		return nil
	}
	dir, err := os.MkdirTemp("", "quickshell-rise-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	installer := filepath.Join(dir, "install.sh")
	if err := e.Sys.Run(nil, "curl", "-fsSL", "-o", installer, quickshellRiseInstaller); err != nil {
		e.UI.Warn("download of the Quickshell Rise installer failed: %v", err)
		return nil
	}
	if err := e.Sys.Run(nil, "bash", installer, "V1", "--autostart", "--no-ai-backend"); err != nil {
		e.UI.Warn("Quickshell Rise installer failed: %v", err)
	}
	return nil
}
