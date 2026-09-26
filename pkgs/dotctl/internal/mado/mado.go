// Package mado switches between exclusive macOS window-manager profiles
// (aerospace / paneru / omniwm / loop / none), each naming its WM process and
// the Homebrew services it needs. Ported from domains/workspace/bin/mado; the
// profile files, the state files (hammerspoon reads services, one per line)
// and the commands are unchanged.
package mado

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Sys is the machine. Tests replace it.
type Sys interface {
	Shell(cmd string) error              // a profile's WM_START
	Running(proc string) bool            // pgrep -x
	RunningMatching(pattern string) bool // pgrep -f
	Kill(proc string)
	ServiceRunning(svc string) bool
	Service(action, svc string) error // brew services start|stop
	Sleep(seconds float64)
	Aerospace(args ...string) (string, error)
	Has(cmd string) bool
}

// Config is where profiles and state live, and the terminal.
type Config struct {
	ProfileDir, StateDir, LayoutDir string
	DryRun                          bool
	Out                             io.Writer
	In                              io.Reader
	in                              *input // shared by every copy; set by Interactive
}

// input is the terminal the menus read, shared so a closed input ends every
// menu, however deep.
type input struct {
	r   *bufio.Reader
	eof bool
}

// Interactive prepares c for the menus.
func (c Config) Interactive() Config {
	c.in = &input{r: bufio.NewReader(c.In)}
	return c
}

// Every WM mado knows; `use` stops all of them first, so a stale state file
// can never leave two running.
var knownWMs = []string{"Loop", "AeroSpace", "paneru", "OmniWM"}
var managedServices = []string{"sketchybar", "borders"}

const defaultProfile = "loop"

// Profile is one *.profile file.
type Profile struct {
	Name, Start, Pgrep string
	On, Off            []string
}

// parseProfile reads the assignments the shell version sourced:
// KEY="value" and KEY=(word word).
func parseProfile(src string) (Profile, error) {
	var p Profile
	for n, line := range strings.Split(src, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			return p, fmt.Errorf("line %d: not an assignment: %s", n+1, line)
		}
		switch {
		case strings.HasPrefix(val, "("):
			words := strings.Fields(strings.Trim(val, "()"))
			switch key {
			case "SERVICES_ON":
				p.On = words
			case "SERVICES_OFF":
				p.Off = words
			}
		default:
			v := strings.Trim(val, `"`)
			switch key {
			case "WM_NAME":
				p.Name = v
			case "WM_START":
				p.Start = v
			case "WM_PGREP":
				p.Pgrep = v
			}
		}
	}
	return p, nil
}

func (c *Config) say(format string, a ...any) { fmt.Fprintf(c.Out, format+"\n", a...) }

func (c *Config) profiles() []string {
	files, _ := filepath.Glob(filepath.Join(c.ProfileDir, "*.profile"))
	var names []string
	for _, f := range files {
		names = append(names, strings.TrimSuffix(filepath.Base(f), ".profile"))
	}
	sort.Strings(names)
	return names
}

func (c *Config) load(name string) (Profile, error) {
	b, err := os.ReadFile(filepath.Join(c.ProfileDir, name+".profile"))
	if err != nil {
		return Profile{}, fmt.Errorf("unknown profile %q (known: %s)", name, strings.Join(c.profiles(), ", "))
	}
	return parseProfile(string(b))
}

func (c *Config) recorded() string {
	b, _ := os.ReadFile(filepath.Join(c.StateDir, "profile"))
	return strings.TrimSpace(string(b))
}

func (c *Config) record(profile string, services []string) error {
	if c.DryRun {
		c.say("[dry-run] record state: profile=%s services=[%s]", profile, strings.Join(services, " "))
		return nil
	}
	if err := os.MkdirAll(c.StateDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(c.StateDir, "profile"), []byte(profile+"\n"), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(c.StateDir, "services"), []byte(strings.Join(services, "\n")+"\n"), 0o644)
}

func (c *Config) do(what string, act func() error) error {
	if c.DryRun {
		c.say("[dry-run] %s", what)
		return nil
	}
	return act()
}

func stopWMs(s Sys, c *Config) {
	for _, p := range knownWMs {
		if s.Running(p) {
			_ = c.do("pkill -x "+p, func() error { s.Kill(p); return nil })
		}
	}
}

// Use switches to a profile; "" re-applies the recorded one (or the default).
func Use(s Sys, c Config, name string) error {
	if name == "" {
		name = c.recorded()
		if name == "" || name == "stopped" {
			name = defaultProfile
		}
	}
	p, err := c.load(name)
	if err != nil {
		return err
	}
	c.say("switching to profile %s%s", name, map[bool]string{true: " (WM: " + p.Name + ")", false: ""}[p.Name != ""])
	stopWMs(s, &c)
	for _, svc := range p.On {
		if !s.ServiceRunning(svc) {
			if err := c.do("brew services start "+svc, func() error { return s.Service("start", svc) }); err != nil {
				return err
			}
		}
	}
	for _, svc := range p.Off {
		if s.ServiceRunning(svc) {
			if err := c.do("brew services stop "+svc, func() error { return s.Service("stop", svc) }); err != nil {
				return err
			}
		}
	}
	if p.Start != "" {
		if err := c.do(p.Start, func() error { return s.Shell(p.Start) }); err != nil {
			return err
		}
		if !c.DryRun && p.Pgrep != "" {
			started := false
			for range 25 {
				if s.Running(p.Pgrep) {
					started = true
					break
				}
				s.Sleep(0.2)
			}
			if !started {
				return fmt.Errorf("%s did not start within 5s (check: pgrep -x %s)", p.Name, p.Pgrep)
			}
		}
	}
	if err := c.record(name, p.On); err != nil {
		return err
	}
	c.say("profile %s active", name)
	return nil
}

// Stop stops every WM and managed service.
func Stop(s Sys, c Config) error {
	stopWMs(s, &c)
	for _, svc := range managedServices {
		if s.ServiceRunning(svc) {
			if err := c.do("brew services stop "+svc, func() error { return s.Service("stop", svc) }); err != nil {
				return err
			}
		}
	}
	if err := c.record("stopped", nil); err != nil {
		return err
	}
	c.say("everything stopped")
	return nil
}

// Status compares the recorded profile with what is running.
func Status(s Sys, c Config) error {
	rec := c.recorded()
	c.say("recorded profile: %s", map[bool]string{true: rec, false: "(none)"}[rec != ""])
	found := false
	for _, p := range knownWMs {
		if s.Running(p) {
			c.say("WM running: %s", p)
			found = true
		}
	}
	if !found {
		c.say("no WM running")
	}
	for _, svc := range managedServices {
		state := "stopped"
		if s.ServiceRunning(svc) {
			state = "running"
		}
		c.say("  %s: %s", svc, state)
	}
	if rec != "" && rec != "stopped" {
		if p, err := c.load(rec); err == nil && p.Pgrep != "" && !s.Running(p.Pgrep) {
			c.say("State drift: recorded %s but %s is not running (fix: mado use)", rec, p.Name)
		}
	}
	return nil
}

// List names the profiles, marking the recorded one.
func List(c Config) error {
	rec := c.recorded()
	c.say("profiles in %s", c.ProfileDir)
	for _, n := range c.profiles() {
		if n == rec {
			c.say("* %s (current)", n)
		} else {
			c.say("  %s", n)
		}
	}
	return nil
}
