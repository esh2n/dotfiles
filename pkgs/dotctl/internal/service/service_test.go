package service

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/esh2n/dotfiles/pkgs/dotctl/internal/ui"
)

type fakeSys struct {
	os    string
	calls []string
	fail  bool
	// failing counts down the failures still due for a command's first
	// argument ("bootstrap": 2 fails the next two bootstraps)
	failing map[string]int
	sleeps  []time.Duration
}

func (f *fakeSys) Quiet(name string, args ...string) error {
	_, _, err := f.Capture(0, name, args...)
	return err
}

func (f *fakeSys) Capture(_ time.Duration, name string, args ...string) (string, string, error) {
	f.calls = append(f.calls, name+" "+strings.Join(args, " "))
	if f.fail {
		return "", "launchctl says no", errors.New("exit 1")
	}
	if len(args) > 0 && f.failing[args[0]] > 0 {
		f.failing[args[0]]--
		return "", args[0] + " failed: 5: Input/output error", errors.New("exit 5")
	}
	return "", "", nil
}
func (f *fakeSys) OS() string { return f.os }

func env(f *fakeSys, out *bytes.Buffer, answers int) Env {
	n := 0
	return Env{Sys: f, UI: ui.Printer{Out: out, Err: out, Prefix: "service"}, UID: 501, Home: "/Users/me",
		Stat:  func(string) error { return nil },
		Sleep: func(d time.Duration) { f.sleeps = append(f.sleeps, d) }, Tries: 3,
		Get: func(string) error {
			n++
			if n >= answers {
				return nil
			}
			return errors.New("not yet")
		}}
}

// On macOS a restart is bootout then bootstrap, never `kickstart -k`: that
// waits out the job's ThrottleInterval (600 s for task-sync, about twice that
// in practice) when the job was spawned recently, as a job that exits for want
// of a secret was.
func TestRestartOnEachPlatform(t *testing.T) {
	var out bytes.Buffer
	mac := &fakeSys{os: "darwin"}
	if err := Restart(env(mac, &out, 2), "litellm-proxy", "http://x/health"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"launchctl bootout gui/501/com.esh2n.litellm-proxy",
		"launchctl bootstrap gui/501 /Users/me/Library/LaunchAgents/com.esh2n.litellm-proxy.plist",
	}
	if strings.Join(mac.calls, "\n") != strings.Join(want, "\n") || !strings.Contains(out.String(), "answers at http://x/health") {
		t.Fatalf("calls %v out %q", mac.calls, out.String())
	}
	linux := &fakeSys{os: "linux"}
	if err := Restart(env(linux, &out, 1), "litellm-proxy", ""); err != nil || linux.calls[0] != "systemctl --user restart litellm-proxy" {
		t.Fatalf("err %v calls %v", err, linux.calls)
	}
}

func TestRestartOnMacLoadsAJobThatWasNotLoaded(t *testing.T) {
	var out bytes.Buffer
	mac := &fakeSys{os: "darwin", failing: map[string]int{"bootout": 1}}
	if err := Restart(env(mac, &out, 1), "task-sync", ""); err != nil || len(mac.calls) != 2 {
		t.Fatalf("err %v calls %v", err, mac.calls)
	}
}

func TestRestartOnMacLeavesTheJobWhenItsPlistIsMissing(t *testing.T) {
	var out bytes.Buffer
	mac := &fakeSys{os: "darwin"}
	e := env(mac, &out, 1)
	e.Stat = func(string) error { return errors.New("no such file") }
	err := Restart(e, "task-sync", "")
	if err == nil || len(mac.calls) != 0 || !strings.Contains(err.Error(), "left as it was") {
		t.Fatalf("err %v calls %v", err, mac.calls)
	}
}

// bootout returns before the old process exits (measured: at once, for a job
// that takes 8 s to stop), and bootstrap fails until it has.
func TestRestartOnMacRetriesABootstrapWhileTheOldJobUnloads(t *testing.T) {
	var out bytes.Buffer
	mac := &fakeSys{os: "darwin", failing: map[string]int{"bootstrap": 2}}
	if err := Restart(env(mac, &out, 1), "task-sync", ""); err != nil || len(mac.calls) != 4 || len(mac.sleeps) != 2 {
		t.Fatalf("err %v calls %v sleeps %v", err, mac.calls, mac.sleeps)
	}
	mac = &fakeSys{os: "darwin", failing: map[string]int{"bootout": 1, "bootstrap": 99}}
	err := Restart(env(mac, &out, 1), "task-sync", "")
	if err == nil || len(mac.calls) != 1+bootstrapTries || len(mac.sleeps) != bootstrapTries-1 {
		t.Fatalf("err %v calls %d sleeps %d", err, len(mac.calls), len(mac.sleeps))
	}
	// past launchd's 20 s ExitTimeOut, after which the old process is killed
	var waited time.Duration
	for _, d := range mac.sleeps {
		waited += d
	}
	if waited < 20*time.Second {
		t.Fatalf("gave up after %v", waited)
	}
	for _, w := range []string{"/Users/me/Library/LaunchAgents/com.esh2n.task-sync.plist", "bootstrap failed: 5", "bootout failed", "print-disabled"} {
		if !strings.Contains(err.Error(), w) {
			t.Fatalf("err %v lacks %q", err, w)
		}
	}
}

func TestRestartFailuresSayWhereToLook(t *testing.T) {
	var out bytes.Buffer
	if err := Restart(env(&fakeSys{os: "darwin", fail: true}, &out, 1), "jig-decision", ""); err == nil || !strings.Contains(err.Error(), "launchctl says no") {
		t.Fatalf("err %v", err)
	}
	if err := Restart(env(&fakeSys{os: "linux"}, &out, 99), "litellm-proxy", "http://x"); err == nil || !strings.Contains(err.Error(), "did not answer") {
		t.Fatalf("err %v", err)
	}
	if err := Restart(env(&fakeSys{os: "linux"}, &out, 1), "../etc", ""); err == nil {
		t.Fatal("a path is not a service name")
	}
}
