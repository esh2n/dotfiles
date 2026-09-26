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
}

func (f *fakeSys) Quiet(name string, args ...string) error {
	f.calls = append(f.calls, name+" "+strings.Join(args, " "))
	if f.fail {
		return errors.New("exit 1")
	}
	return nil
}
func (f *fakeSys) OS() string { return f.os }

func env(f *fakeSys, out *bytes.Buffer, answers int) Env {
	n := 0
	return Env{Sys: f, UI: ui.Printer{Out: out, Err: out, Prefix: "service"}, UID: 501,
		Sleep: func(time.Duration) {}, Tries: 3,
		Get: func(string) error {
			n++
			if n >= answers {
				return nil
			}
			return errors.New("not yet")
		}}
}

func TestRestartOnEachPlatform(t *testing.T) {
	var out bytes.Buffer
	mac := &fakeSys{os: "darwin"}
	if err := Restart(env(mac, &out, 2), "litellm-proxy", "http://x/health"); err != nil {
		t.Fatal(err)
	}
	if mac.calls[0] != "launchctl kickstart -k gui/501/com.esh2n.litellm-proxy" || !strings.Contains(out.String(), "answers at http://x/health") {
		t.Fatalf("calls %v out %q", mac.calls, out.String())
	}
	linux := &fakeSys{os: "linux"}
	if err := Restart(env(linux, &out, 1), "litellm-proxy", ""); err != nil || linux.calls[0] != "systemctl --user restart litellm-proxy" {
		t.Fatalf("err %v calls %v", err, linux.calls)
	}
}

func TestRestartFailuresSayWhereToLook(t *testing.T) {
	var out bytes.Buffer
	if err := Restart(env(&fakeSys{os: "darwin", fail: true}, &out, 1), "jig-decision", ""); err == nil || !strings.Contains(err.Error(), "launchctl print") {
		t.Fatalf("err %v", err)
	}
	if err := Restart(env(&fakeSys{os: "linux"}, &out, 99), "litellm-proxy", "http://x"); err == nil || !strings.Contains(err.Error(), "did not answer") {
		t.Fatalf("err %v", err)
	}
	if err := Restart(env(&fakeSys{os: "linux"}, &out, 1), "../etc", ""); err == nil {
		t.Fatal("a path is not a service name")
	}
}
