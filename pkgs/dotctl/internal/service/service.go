// Package service restarts one of the resident services lib/mk-service.nix
// declares: a launchd agent labelled com.esh2n.<name> on macOS, a systemd
// user service <name> on Linux. The shell and the person name a service the
// same way on both.
package service

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// Sys is the part of the machine a restart needs.
type Sys interface {
	Quiet(name string, args ...string) error
	Capture(timeout time.Duration, name string, args ...string) (stdout, stderr string, err error)
	OS() string
}

// Env is one restart.
type Env struct {
	Sys   Sys
	UI    ui.Printer
	UID   int
	Home  string                  // the launchd agents' plists are in Home/Library/LaunchAgents
	Get   func(url string) error  // nil: an HTTP GET that must answer 2xx
	Stat  func(path string) error // nil: os.Stat
	Sleep func(time.Duration)     // nil: time.Sleep
	Tries int                     // health probes; 0: 20
}

var validName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// Restart restarts name, then, when health is set, waits for it to answer.
func Restart(e Env, name, health string) error {
	if !validName.MatchString(name) {
		return fmt.Errorf("%q is not a service name (lib/mk-service.nix names: lowercase, digits, -)", name)
	}
	var err error
	switch e.Sys.OS() {
	case "darwin":
		if err = restartLaunchd(e, "com.esh2n."+name); err != nil {
			return err
		}
	case "linux":
		if err = e.Sys.Quiet("systemctl", "--user", "restart", name); err != nil {
			return fmt.Errorf("systemctl --user restart %s: %w (journalctl --user -u %s)", name, err, name)
		}
	default:
		return fmt.Errorf("unsupported platform %s", e.Sys.OS())
	}
	e.UI.Note("restarting %s", name)
	if health == "" {
		return nil
	}
	return waitHealthy(e, name, health)
}

// bootstrapTries spans launchd's default ExitTimeOut (20 s before it kills
// the old process) and a margin: bootout returns at once, and bootstrap fails
// (launchctl's error 5) until the old process has exited.
const bootstrapTries = 25

// restartLaunchd unloads the agent and loads it again, as Homebrew's
// `brew services restart` does. Not `launchctl kickstart -k`: it waits out the
// job's ThrottleInterval when the job was spawned recently (a job that exits
// for want of a secret was), up to about twice that interval; a bootstrap
// starts the job at once.
func restartLaunchd(e Env, label string) error {
	domain := fmt.Sprintf("gui/%d", e.UID)
	plist := filepath.Join(e.Home, "Library", "LaunchAgents", label+".plist")
	stat, sleep := e.Stat, e.Sleep
	if stat == nil {
		stat = func(p string) error { _, err := os.Stat(p); return err }
	}
	if sleep == nil {
		sleep = time.Sleep
	}
	// without its plist the job could not be loaded again, so it stays as it is
	if err := stat(plist); err != nil {
		return fmt.Errorf("%w (make up writes it); %s was left as it was", err, label)
	}
	// a bootout fails when the job is not loaded; the bootstrap loads it then
	bootoutErr := launchctl(e, "bootout", domain+"/"+label)
	var err error
	for i := 0; i < bootstrapTries; i++ {
		if i > 0 {
			sleep(time.Second)
		}
		if err = launchctl(e, "bootstrap", domain, plist); err == nil {
			return nil
		}
	}
	return fmt.Errorf("launchctl bootstrap %s %s: %w (bootout: %v); %s is not loaded now — a disabled job fails here too: launchctl print-disabled %s",
		domain, plist, err, bootoutErr, label, domain)
}

// launchctl runs launchctl and puts its own reason into the error.
func launchctl(e Env, args ...string) error {
	_, errOut, err := e.Sys.Capture(10*time.Second, "launchctl", args...)
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(errOut))
	}
	return nil
}

func waitHealthy(e Env, name, url string) error {
	get, sleep, tries := e.Get, e.Sleep, e.Tries
	if get == nil {
		client := &http.Client{Timeout: 2 * time.Second}
		get = func(u string) error {
			resp, err := client.Get(u)
			if err != nil {
				return err
			}
			resp.Body.Close()
			if resp.StatusCode/100 != 2 {
				return fmt.Errorf("status %d", resp.StatusCode)
			}
			return nil
		}
	}
	if sleep == nil {
		sleep = time.Sleep
	}
	if tries == 0 {
		tries = 20
	}
	for i := 0; i < tries; i++ {
		sleep(2 * time.Second)
		if get(url) == nil {
			e.UI.Success("%s answers at %s", name, url)
			return nil
		}
	}
	return fmt.Errorf("%s did not answer at %s within ~%ds (see its log)", name, url, tries*2)
}
