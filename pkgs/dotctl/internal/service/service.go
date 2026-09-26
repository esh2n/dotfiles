// Package service restarts one of the resident services lib/mk-service.nix
// declares: a launchd agent labelled com.esh2n.<name> on macOS, a systemd
// user service <name> on Linux. The shell and the person name a service the
// same way on both.
package service

import (
	"fmt"
	"net/http"
	"regexp"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

// Sys is the part of the machine a restart needs.
type Sys interface {
	Quiet(name string, args ...string) error
	OS() string
}

// Env is one restart.
type Env struct {
	Sys   Sys
	UI    ui.Printer
	UID   int
	Get   func(url string) error // nil: an HTTP GET that must answer 2xx
	Sleep func(time.Duration)    // nil: time.Sleep
	Tries int                    // health probes; 0: 20
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
		label := "com.esh2n." + name
		err = e.Sys.Quiet("launchctl", "kickstart", "-k", fmt.Sprintf("gui/%d/%s", e.UID, label))
		if err != nil {
			return fmt.Errorf("launchctl kickstart %s: %w (is it loaded? launchctl print gui/%d/%s)", label, err, e.UID, label)
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
