// Package theme switches the colour theme by swapping one link
// (plans/2026-09-24-dotfiles-architecture.md §7).
//
//	~/.config/theme/palettes/<name>/<file>  declared by home-manager: links to
//	                                        the checkout's theme files
//	~/.config/theme/current                 -> palettes/<name>; only Set moves it
//	<app pointer in the checkout>           -> ~/.config/theme/current/<file>
//
// An app reads its pointer (ghostty's `config-file = theme`, tmux's
// `source-file themes/current.conf`, ...), so moving `current` switches every
// app at once; Set then asks the running ones to reload.
package theme

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// App is one application whose theme is a file it includes.
type App struct {
	File    string // name inside a palette
	Pointer string // the link the app reads, relative to the checkout
	source  string // the theme file, relative to the checkout; %s = theme name
}

// Source is the checkout-relative theme file for name.
func (a App) Source(name string) string { return fmt.Sprintf(a.source, name) }

// Apps are those switched through `current`. The first one's link is also the
// record the old theme-switch kept, so Init can adopt its choice.
var Apps = []App{
	{File: "colors.lua", Pointer: "home/shared/theme/colors.lua", source: "home/shared/theme/themes/%s.lua"},
	{File: "ghostty", Pointer: "home/darwin/ghostty/config/theme", source: "home/darwin/ghostty/config/themes/%s"},
	{File: "tmux.conf", Pointer: "home/darwin/tmux/config/themes/current.conf", source: "home/darwin/tmux/config/themes/%s.conf"},
	{File: "sketchybar.lua", Pointer: "home/darwin/sketchybar/config/colors.lua", source: "home/darwin/sketchybar/config/themes/%s.lua"},
	{File: "borders.sh", Pointer: "home/darwin/borders/config/colors.sh", source: "home/darwin/borders/config/themes/%s.sh"},
}

// Env is the world a switch acts on; tests replace Run and Has.
type Env struct {
	Home, Repo string
	Run        func(cmd ...string) error // run and wait
	Start      func(cmd ...string) error // start and leave running
	Has        func(cmd string) bool
	Warn       func(msg string)
	Sleep      func(time.Duration) // nil: time.Sleep
}

func (e Env) themeDir() string { return filepath.Join(e.Home, ".config", "theme") }
func (e Env) current() string  { return filepath.Join(e.themeDir(), "current") }
func (e Env) palette(n string) string {
	return filepath.Join(e.themeDir(), "palettes", n)
}

func (e Env) warn(format string, a ...any) {
	if e.Warn != nil {
		e.Warn(fmt.Sprintf(format, a...))
	}
}

// List names the themes home-manager declared palettes for.
func List(e Env) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(e.themeDir(), "palettes"))
	if err != nil {
		return nil, err
	}
	var names []string
	for _, d := range entries {
		names = append(names, d.Name())
	}
	sort.Strings(names)
	return names, nil
}

// Current names the theme `current` points at.
func Current(e Env) (string, error) {
	target, err := os.Readlink(e.current())
	if err != nil {
		return "", err
	}
	return filepath.Base(target), nil
}

// relink points link at target, replacing a link already there atomically.
// A real file or directory in the way is never replaced: that is the
// owner's, and the error says so.
func relink(target, link string) error {
	if info, err := os.Lstat(link); err == nil && info.Mode()&os.ModeSymlink == 0 {
		return fmt.Errorf("%s is a real file, not a link; move it aside first", link)
	}
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp-%d", link, time.Now().UnixNano())
	if err := os.Symlink(target, tmp); err != nil {
		return err
	}
	return os.Rename(tmp, link)
}

// adopted reads the theme the old theme-switch left in the colors link.
func adopted(e Env) string {
	target, err := os.Readlink(filepath.Join(e.Repo, Apps[0].Pointer))
	if err != nil || strings.HasPrefix(target, e.current()) {
		return ""
	}
	return strings.TrimSuffix(filepath.Base(target), ".lua")
}

// Init makes the layout above exist, keeping any theme already chosen (by
// Set, or by the old theme-switch); fallback names the theme otherwise.
func Init(e Env, fallback string) error {
	if _, err := Current(e); err != nil {
		name := adopted(e)
		if _, statErr := os.Stat(e.palette(name)); name == "" || statErr != nil {
			name = fallback
		}
		if _, err := os.Stat(e.palette(name)); err != nil {
			return fmt.Errorf("no palette for theme %q (home-manager declares them)", name)
		}
		if err := relink(e.palette(name), e.current()); err != nil {
			return err
		}
	}
	for _, a := range Apps {
		want := filepath.Join(e.current(), a.File)
		p := filepath.Join(e.Repo, a.Pointer)
		if got, err := os.Readlink(p); err == nil && got == want {
			continue
		}
		if err := relink(want, p); err != nil {
			return err
		}
	}
	// make up renders zellij's config.kdl again, resetting its layout
	if cur, err := Current(e); err == nil {
		if err := applyZellij(e, cur); err != nil {
			e.warn("zellij: %v", err)
		}
	}
	return nil
}

// Set switches to name, then asks the running apps to reload. Only a failed
// switch is an error; a failed reload is a warning.
func Set(e Env, name string) error {
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name {
		return errors.New("a theme name, not a path, is required")
	}
	if _, err := os.Stat(e.palette(name)); err != nil {
		names, _ := List(e)
		return fmt.Errorf("unknown theme %q (known: %s)", name, strings.Join(names, ", "))
	}
	if err := relink(e.palette(name), e.current()); err != nil {
		return err
	}
	reload(e)
	applyValues(e, name)
	return nil
}

func reload(e Env) {
	has := func(c string) bool { return e.Has != nil && e.Has(c) }
	run := func(cmd ...string) {
		if e.Run != nil {
			if err := e.Run(cmd...); err != nil {
				e.warn("%s: %v", strings.Join(cmd, " "), err)
			}
		}
	}
	if has("tmux") && e.Run != nil && e.Run("tmux", "list-sessions") == nil {
		run("tmux", "source-file", filepath.Join(e.Home, ".config", "tmux", "tmux.conf"))
	}
	if has("sketchybar") {
		run("sketchybar", "--reload")
	}
	if has("borders") && e.Start != nil {
		_ = e.Run("pkill", "-x", "borders") // not running is fine
		if !waitGone(e, "borders", 2*time.Second) {
			e.warn("borders: the old process did not exit within 2s; starting the new one anyway")
		}
		if err := e.Start(filepath.Join(e.Repo, "home/darwin/borders/config/bordersrc")); err != nil {
			e.warn("borders: %v", err)
		}
	}
	// WezTerm reloads when its config changes; touching it is enough.
	wez := filepath.Join(e.Home, ".config", "wezterm", "wezterm.lua")
	if _, err := os.Stat(wez); err == nil {
		now := time.Now()
		_ = os.Chtimes(wez, now, now)
	}
}

// waitGone polls until no process is named name, for at most limit:
// pkill returns once the signal is sent, not once the process has exited,
// and a new borders started beside the old one fights it for the windows.
func waitGone(e Env, name string, limit time.Duration) bool {
	sleep := e.Sleep
	if sleep == nil {
		sleep = time.Sleep
	}
	const step = 50 * time.Millisecond
	for waited := time.Duration(0); ; waited += step {
		if e.Run("pgrep", "-x", name) != nil {
			return true
		}
		if waited >= limit {
			return false
		}
		sleep(step)
	}
}
