package theme

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The apps whose theme is a value inside their own config, not a file they
// include. Set rewrites those values after moving `current`, as the old
// theme-switch did (domains/system/bin/theme-switch); each failure is a
// warning.

var vscodeThemes = map[string]string{
	"catppuccin": "Catppuccin Mocha", "catppuccin-latte": "Catppuccin Latte", "dracula": "Dracula",
	"everforest": "Everforest Dark", "everforest-light": "Everforest Light", "gruvbox": "Gruvbox Dark Medium",
	"kanagawa": "Kanagawa Wave", "nord": "Nord", "onedark": "Atom One Dark", "rosepine": "Rosé Pine",
	"solarized": "Solarized Dark", "tokyonight": "Tokyo Night", "tokyonight-day": "Tokyo Night Day",
}

var nvchadThemes = map[string]string{
	"catppuccin": "catppuccin", "catppuccin-latte": "catppuccin", "dracula": "chadracula",
	"everforest": "everforest", "everforest-light": "everforest_light", "gruvbox": "gruvbox",
	"kanagawa": "kanagawa", "nord": "nord", "onedark": "onedark", "rosepine": "rosepine",
	"solarized": "solarized_dark", "tokyonight": "tokyonight", "tokyonight-day": "tokyonight",
}

var statuslineColors = map[string]string{
	"catppuccin": "lavender", "catppuccin-latte": "lavender", "dracula": "rose", "everforest": "green",
	"everforest-light": "green", "gruvbox": "gold", "kanagawa": "blue", "nord": "cyan", "onedark": "blue",
	"rosepine": "rose", "solarized": "teal", "tokyonight": "blue", "tokyonight-day": "blue",
}

func or(m map[string]string, k, def string) string {
	if v, ok := m[k]; ok {
		return v
	}
	return def
}

// rewrite replaces the first-group pattern in a file, keeping it when absent.
func rewrite(path string, re *regexp.Regexp, repl string) (bool, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	if !re.Match(b) {
		return false, nil
	}
	out := re.ReplaceAll(b, []byte(repl))
	// a temp name of its own: two switches at once must not share one
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return false, err
	}
	defer os.Remove(tmp.Name()) // gone after the rename; cleans up on failure
	if _, err := tmp.Write(out); err != nil {
		tmp.Close()
		return false, err
	}
	if err := tmp.Close(); err != nil {
		return false, err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return false, err
	}
	return true, os.Rename(tmp.Name(), path)
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func (e Env) repo(rel string) string { return filepath.Join(e.Repo, rel) }

func applyValues(e Env, name string) {
	steps := []struct {
		what string
		do   func() error
	}{
		{"zellij", func() error { return applyZellij(e, name) }},
		{"warp", func() error { return applyWarp(e, name) }},
		{"starship", func() error { return applyStarship(e, name) }},
		{"vscode", func() error { return applyVSCode(e, name) }},
		{"neovim", func() error { return applyNeovim(e, name) }},
		{"wallpaper", func() error { return applyWallpaper(e, name) }},
		{"userstyles", func() error { return applyUserstyles(e, name) }},
		{"cli colours", func() error { return applyCLI(e, name) }},
		{"orca", func() error { return applyOrca(e, name) }},
	}
	for _, s := range steps {
		if err := s.do(); err != nil {
			e.warn("%s: %v", s.what, err)
		}
	}
}

// applyZellij sets default_layout in the file ~/.config/zellij/config.kdl
// resolves to (the checkout's rendered copy), keeping home-manager's link.
func applyZellij(e Env, name string) error {
	cfg, err := filepath.EvalSymlinks(filepath.Join(e.Home, ".config", "zellij", "config.kdl"))
	if err != nil || !exists(filepath.Join(filepath.Dir(cfg), "layouts", name+".kdl")) {
		return nil
	}
	_, err = rewrite(cfg, regexp.MustCompile(`default_layout "[^"]*"`), fmt.Sprintf(`default_layout "%s"`, name))
	return err
}

func applyWarp(e Env, name string) error {
	settings := e.repo("domains/dev/config/warp/settings.toml")
	if !exists(e.repo("domains/dev/config/warp/themes/"+name+".yaml")) || !exists(settings) {
		return nil
	}
	_, err := rewrite(settings, regexp.MustCompile(`(?m)^theme = .*$`), fmt.Sprintf(`theme = "%s"`, name))
	return err
}

func applyStarship(e Env, name string) error {
	cfg := e.repo("domains/dev/config/starship/starship.toml")
	b, err := os.ReadFile(cfg)
	if err != nil {
		return nil // not rendered on this machine
	}
	if !regexp.MustCompile(`(?m)^\[palettes\.` + regexp.QuoteMeta(name) + `\]`).Match(b) {
		return nil
	}
	_, err = rewrite(cfg, regexp.MustCompile(`(?m)^palette = "[^"]*"`), fmt.Sprintf(`palette = "%s"`, name))
	return err
}

func applyVSCode(e Env, name string) error {
	theme, ok := vscodeThemes[name]
	if !ok {
		return nil
	}
	for _, rel := range []string{
		"Library/Application Support/Code/User/settings.json",
		"Library/Application Support/Cursor/User/settings.json",
		".config/Code/User/settings.json",
		".config/Cursor/User/settings.json",
	} {
		real, err := filepath.EvalSymlinks(filepath.Join(e.Home, rel))
		if err != nil {
			continue
		}
		re := regexp.MustCompile(`"workbench\.colorTheme": *"[^"]*"`)
		if _, err := rewrite(real, re, fmt.Sprintf(`"workbench.colorTheme": "%s"`, theme)); err != nil {
			return err
		}
	}
	return nil
}

func applyWallpaper(e Env, name string) error {
	for _, ext := range []string{"jpg", "jpeg", "png", "heic"} {
		img := e.repo("domains/workspace/assets/background/" + name + "." + ext)
		if !exists(img) {
			continue
		}
		if e.Has == nil || !e.Has("desktoppr") {
			return nil
		}
		return e.Run("desktoppr", img)
	}
	return nil
}

// Stylus reads each site's active.user.css; point it at the theme's.
func applyUserstyles(e Env, name string) error {
	dir := e.repo("domains/system/userstyles")
	sites, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, s := range sites {
		switch s.Name() {
		case "templates", "scripts", "vars":
			continue
		}
		site := filepath.Join(dir, s.Name())
		if !s.IsDir() || !exists(filepath.Join(site, name+".user.css")) {
			continue
		}
		if err := relink(name+".user.css", filepath.Join(site, "active.user.css")); err != nil {
			e.warn("userstyles: %v", err)
		}
	}
	return nil
}

func applyOrca(e Env, name string) error {
	support := filepath.Join(e.Home, "Library/Application Support/orca")
	if !exists(filepath.Join(support, "orca-profile-index.json")) || e.Run == nil {
		return nil
	}
	// The running app overwrites external edits of its state file.
	if e.Run("pgrep", "-xq", "Orca") == nil {
		e.warn("orca: Orca is running, theme not applied (quit it and switch again)")
		return nil
	}
	p, err := readPalette(e.repo(Apps[0].Source(name)))
	if err != nil {
		return err
	}
	warpName := ""
	if b, err := os.ReadFile(e.repo("domains/dev/config/warp/themes/" + name + ".yaml")); err == nil {
		if m := regexp.MustCompile(`(?m)^name:\s*["']?([^"'\n]*)["']?\s*$`).FindSubmatch(b); m != nil {
			warpName = strings.TrimSpace(string(m[1]))
		}
	}
	return e.Run("python3", e.repo("domains/system/bin/orca-theme-apply.py"), support, p.Variant(), warpName)
}
