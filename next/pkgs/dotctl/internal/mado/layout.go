package mado

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The AeroSpace layout and info tools (from the retired `ws` CLI), and the
// interactive menus. Layout files keep the old JSON shape.

type window struct {
	WindowID    string `json:"window_id"`
	AppName     string `json:"app_name"`
	AppID       string `json:"app_id"`
	WindowTitle string `json:"window_title"`
}

type layout struct {
	Name      string   `json:"name"`
	Workspace string   `json:"workspace"`
	Timestamp string   `json:"timestamp"`
	Windows   []window `json:"windows"`
}

func (c *Config) ask(prompt string) string {
	if c.in == nil {
		c.in = &input{r: bufio.NewReader(c.In)}
	}
	fmt.Fprint(c.Out, prompt)
	line, err := c.in.r.ReadString('\n')
	if err != nil && line == "" {
		c.in.eof = true
	}
	return strings.TrimSpace(line)
}

// choose asks for a number 1..n; ok is false on a blank or bad answer.
func (c *Config) choose(prompt string, n int) (int, bool) {
	v, err := strconv.Atoi(c.ask(prompt))
	if err != nil || v < 1 || v > n {
		return 0, false
	}
	return v - 1, true
}

// RequireAerospace refuses the layout and info tools unless AeroSpace runs.
func RequireAerospace(s Sys) error {
	if !s.Has("aerospace") {
		return errors.New("aerospace CLI not found")
	}
	if !s.Running("AeroSpace") {
		return errors.New("layout/info tools require the aerospace profile (mado use aerospace)")
	}
	return nil
}

func lines(out string) []string {
	var ls []string
	for _, l := range strings.Split(out, "\n") {
		if strings.TrimSpace(l) != "" {
			ls = append(ls, l)
		}
	}
	return ls
}

func (c *Config) layouts() []string {
	files, _ := filepath.Glob(filepath.Join(c.LayoutDir, "*.json"))
	sort.Strings(files)
	return files
}

// LayoutSave records the focused workspace's windows.
func LayoutSave(s Sys, c Config) error {
	name := c.ask("Enter layout name: ")
	if name == "" || filepath.Base(name) != name {
		return errors.New("layout name cannot be empty or a path")
	}
	file := filepath.Join(c.LayoutDir, name+".json")
	if _, err := os.Stat(file); err == nil {
		if a := c.ask(fmt.Sprintf("Layout '%s' already exists. Overwrite? [y/N]: ", name)); a != "y" && a != "Y" {
			c.say("cancelled")
			return nil
		}
	}
	ws, _ := s.Aerospace("list-workspaces", "--focused")
	apps, _ := s.Aerospace("list-apps")
	wins, _ := s.Aerospace("list-windows", "--workspace", "focused", "--format", "%{window-id}|%{app-name}|%{window-title}")
	l := layout{Name: name, Workspace: strings.TrimSpace(ws), Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05Z"), Windows: []window{}}
	for _, line := range lines(wins) {
		parts := strings.SplitN(line, "|", 3)
		for len(parts) < 3 {
			parts = append(parts, "")
		}
		w := window{WindowID: strings.TrimSpace(parts[0]), AppName: strings.TrimSpace(parts[1]), WindowTitle: strings.TrimSpace(parts[2])}
		for _, a := range lines(apps) {
			if f := strings.Fields(a); len(f) >= 2 && strings.Contains(a, w.AppName) {
				w.AppID = f[1]
				break
			}
		}
		if w.AppID != "" {
			l.Windows = append(l.Windows, w)
		}
	}
	b, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(file, append(b, '\n'), 0o644); err != nil {
		return err
	}
	c.say("layout %s saved to %s", name, file)
	return nil
}

func readLayout(file string) (layout, error) {
	var l layout
	b, err := os.ReadFile(file)
	if err != nil {
		return l, err
	}
	return l, json.Unmarshal(b, &l)
}

// LayoutList prints the saved layouts.
func LayoutList(c Config) error {
	files := c.layouts()
	if len(files) == 0 {
		c.say("no saved layouts")
		return nil
	}
	for i, f := range files {
		l, _ := readLayout(f)
		ts := l.Timestamp
		if ts == "" {
			ts = "Unknown"
		}
		c.say("%d) %s - %d windows (saved: %s)", i+1, strings.TrimSuffix(filepath.Base(f), ".json"), len(l.Windows), ts)
	}
	return nil
}

func (c *Config) pickLayout() (string, bool) {
	files := c.layouts()
	if len(files) == 0 {
		c.say("no saved layouts")
		return "", false
	}
	for i, f := range files {
		c.say("%d) %s", i+1, strings.TrimSuffix(filepath.Base(f), ".json"))
	}
	i, ok := c.choose("Select layout number: ", len(files))
	if !ok {
		c.say("invalid selection")
	}
	return files[max(i, 0)], ok
}

func (c *Config) pickMonitor(s Sys) (string, bool) {
	out, _ := s.Aerospace("list-monitors", "--format", "%{monitor-id}|%{monitor-name}")
	var ids []string
	for i, line := range lines(out) {
		id, name, _ := strings.Cut(line, "|")
		ids = append(ids, strings.TrimSpace(id))
		c.say("%d) %s", i+1, strings.TrimSpace(name))
	}
	i, ok := c.choose("Select monitor number: ", len(ids))
	if !ok {
		c.say("invalid selection")
		return "", false
	}
	return ids[i], true
}

// moveWindows moves every window whose line mentions match to a workspace.
func moveWindows(s Sys, match func(string) bool, workspace string) {
	all, _ := s.Aerospace("list-windows", "--all")
	for _, line := range lines(all) {
		if f := strings.Fields(line); len(f) > 0 && match(line) {
			_, _ = s.Aerospace("move-node-to-workspace", "--window-id", f[0], workspace)
		}
	}
}

// LayoutRestore opens a saved layout's apps and moves their windows.
func LayoutRestore(s Sys, c Config) error {
	file, ok := c.pickLayout()
	if !ok {
		return nil
	}
	monitor, ok := c.pickMonitor(s)
	if !ok {
		return nil
	}
	target := c.ask("Enter target workspace (e.g., C, W, 1): ")
	if target == "" {
		return errors.New("workspace cannot be empty")
	}
	l, err := readLayout(file)
	if err != nil {
		return err
	}
	c.say("restoring layout %s to monitor %s, workspace %s", l.Name, monitor, target)
	seen := map[string]bool{}
	for _, w := range l.Windows {
		if seen[w.AppID] {
			continue
		}
		seen[w.AppID] = true
		if !s.RunningMatching(w.AppID) {
			c.say("launching %s", w.AppName)
			if err := s.Shell("open -a '" + strings.ReplaceAll(w.AppName, "'", `'\''`) + "'"); err != nil {
				c.say("could not launch %s", w.AppName)
			}
			s.Sleep(2)
		}
	}
	s.Sleep(3)
	moveWindows(s, func(line string) bool { return seen[appIDIn(line, seen)] }, target)
	c.say("layout restored")
	return nil
}

func appIDIn(line string, ids map[string]bool) string {
	for id := range ids {
		if strings.Contains(line, id) {
			return id
		}
	}
	return ""
}

// LayoutDelete removes a saved layout after asking.
func LayoutDelete(c Config) error {
	file, ok := c.pickLayout()
	if !ok {
		return nil
	}
	name := strings.TrimSuffix(filepath.Base(file), ".json")
	if a := c.ask(fmt.Sprintf("Delete layout '%s'? [y/N]: ", name)); a == "y" || a == "Y" {
		if err := os.Remove(file); err != nil {
			return err
		}
		c.say("layout %s deleted", name)
		return nil
	}
	c.say("cancelled")
	return nil
}

// PresetCommunication puts Slack and Gather on workspace C.
func PresetCommunication(s Sys, c Config) error {
	monitor, ok := c.pickMonitor(s)
	if !ok {
		return nil
	}
	for _, app := range []string{"Slack", "Gather"} {
		if !s.Running(app) {
			c.say("launching %s", app)
			_ = s.Shell("open -a " + app)
			s.Sleep(3)
		}
	}
	moveWindows(s, func(line string) bool {
		return strings.Contains(line, "Slack") || strings.Contains(line, "Gather")
	}, "C")
	c.say("communication preset ready on monitor %s (resize with Alt+- if needed)", monitor)
	return nil
}

// menu shows options until the last one (Back/Quit) is picked.
func (c *Config) menu(title string, options []string, act func(int) error) {
	for {
		c.say("\n%s\n%s", title, strings.Repeat("─", len([]rune(title))))
		for i, o := range options {
			c.say("%d) %s", i+1, o)
		}
		i, ok := c.choose("Select option: ", len(options))
		if c.in.eof {
			return // input closed
		}
		if !ok {
			c.say("invalid option")
			continue
		}
		if i == len(options)-1 {
			return
		}
		if err := act(i); err != nil {
			c.say("error: %v", err)
		}
	}
}

// LayoutMenu is `mado layout`.
func LayoutMenu(s Sys, c Config) {
	_ = os.MkdirAll(c.LayoutDir, 0o755)
	c.menu("Layout Management (aerospace)", []string{"Save Current Layout", "Restore Layout", "List Saved Layouts",
		"Delete Layout", "Preset: Communication (Slack + Gather)", "Back"}, func(i int) error {
		return []func() error{
			func() error { return LayoutSave(s, c) },
			func() error { return LayoutRestore(s, c) },
			func() error { return LayoutList(c) },
			func() error { return LayoutDelete(c) },
			func() error { return PresetCommunication(s, c) },
		}[i]()
	})
}

// InfoMenu is `mado info`.
func InfoMenu(s Sys, c Config) {
	args := [][]string{{"list-windows", "--all"}, {"list-workspaces", "--all"}, {"list-monitors"}, {"list-apps"}}
	c.menu("Information (aerospace)", []string{"List Windows", "List Workspaces", "List Monitors", "List Apps", "Back"},
		func(i int) error {
			out, err := s.Aerospace(args[i]...)
			fmt.Fprint(c.Out, out)
			return err
		})
}

// MainMenu is `mado` with no command.
func MainMenu(s Sys, c Config) {
	c.menu("mado - WM Profile Switcher", []string{"Switch profile", "Status", "Stop everything",
		"Layout menu (aerospace only)", "Info menu (aerospace only)", "Quit"}, func(i int) error {
		switch i {
		case 0:
			names := c.profiles()
			rec := c.recorded()
			for n, name := range names {
				mark := ""
				if name == rec {
					mark = " (current)"
				}
				c.say("%d) %s%s", n+1, name, mark)
			}
			if k, ok := c.choose("Select profile number (blank to cancel): ", len(names)); ok {
				return Use(s, c, names[k])
			}
			return nil
		case 1:
			return Status(s, c)
		case 2:
			return Stop(s, c)
		case 3:
			if err := RequireAerospace(s); err != nil {
				return err
			}
			LayoutMenu(s, c)
		case 4:
			if err := RequireAerospace(s); err != nil {
				return err
			}
			InfoMenu(s, c)
		}
		return nil
	})
}
