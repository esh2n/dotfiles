package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/mado"
)

// madoSys is the real Mac for `dotctl mado`.
type madoSys struct{}

func quiet(name string, args ...string) error { return exec.Command(name, args...).Run() }

func (madoSys) Shell(cmd string) error {
	c := exec.Command("/bin/sh", "-c", cmd)
	c.Stdout, c.Stderr = os.Stdout, os.Stderr
	return c.Run()
}
func (madoSys) Running(p string) bool         { return quiet("pgrep", "-x", p) == nil }
func (madoSys) RunningMatching(p string) bool { return quiet("pgrep", "-f", p) == nil }
func (madoSys) Kill(p string)                 { _ = quiet("pkill", "-x", p) }

// launchd directly, not `brew services list`, which loads every formula's
// ruby and breaks whenever one of them trips a Homebrew bug.
func (madoSys) ServiceRunning(svc string) bool {
	return quiet("launchctl", "print", "gui/"+strconv.Itoa(os.Getuid())+"/homebrew.mxcl."+svc) == nil
}
func (madoSys) Service(action, svc string) error {
	c := exec.Command("brew", "services", action, svc)
	c.Stdout, c.Stderr = os.Stdout, os.Stderr
	return c.Run()
}
func (madoSys) Sleep(s float64) { time.Sleep(time.Duration(s * float64(time.Second))) }
func (madoSys) Aerospace(args ...string) (string, error) {
	out, err := exec.Command("aerospace", args...).Output()
	return string(out), err
}
func (madoSys) Has(cmd string) bool { _, err := exec.LookPath(cmd); return err == nil }

func xdg(env, home, def string) string {
	if v := os.Getenv(env); v != "" {
		return v
	}
	return filepath.Join(home, def)
}

const madoUsage = `mado - WM profile switcher

usage:
  mado                             interactive menu
  mado use [profile] [--dry-run]   switch to a profile (no name: re-apply the current one)
  mado stop                        stop every WM and managed service
  mado status                      recorded profile against the running processes
  mado list                        list the profiles
  mado layout                      layout save/restore menu (aerospace only)
  mado info                        AeroSpace info menu (aerospace only)
`

// runMado is `dotctl mado ...`, also installed as `mado`.
func runMado(home string, args []string, out, errOut io.Writer) int {
	c := mado.Config{
		ProfileDir: filepath.Join(xdg("XDG_CONFIG_HOME", home, ".config"), "mado", "profiles"),
		StateDir:   filepath.Join(xdg("XDG_STATE_HOME", home, ".local/state"), "mado"),
		LayoutDir:  filepath.Join(home, ".config", "aerospace", "layouts"),
		Out:        out,
		In:         os.Stdin,
	}
	var rest []string
	for _, a := range args {
		if a == "--dry-run" {
			c.DryRun = true
		} else {
			rest = append(rest, a)
		}
	}
	s := madoSys{}
	cmd, name := "", ""
	if len(rest) > 0 {
		cmd = rest[0]
	}
	if len(rest) > 1 {
		name = rest[1]
	}
	var err error
	switch cmd {
	case "":
		mado.MainMenu(s, c.Interactive())
	case "use":
		err = mado.Use(s, c, name)
	case "stop":
		err = mado.Stop(s, c)
	case "status":
		err = mado.Status(s, c)
	case "list":
		err = mado.List(c)
	case "layout", "info":
		if err = mado.RequireAerospace(s); err == nil {
			if cmd == "layout" {
				mado.LayoutMenu(s, c.Interactive())
			} else {
				mado.InfoMenu(s, c.Interactive())
			}
		}
	case "help", "-h", "--help":
		fmt.Fprint(out, madoUsage)
	default:
		fmt.Fprintf(errOut, "mado: unknown command %q\n%s", cmd, madoUsage)
		return 1
	}
	if err != nil {
		fmt.Fprintln(errOut, "mado:", err)
		return 1
	}
	return 0
}
