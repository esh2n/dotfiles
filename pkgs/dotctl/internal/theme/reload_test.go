package theme

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"
)

// bordersEnv: pgrep finds borders for the first alive calls, then not.
func bordersEnv(alive int) (Env, *[]string, *[]string) {
	var log, warned []string
	e := Env{
		Home: "/nowhere", Repo: "/repo",
		Has: func(c string) bool { return c == "borders" },
		Run: func(cmd ...string) error {
			log = append(log, strings.Join(cmd, " "))
			if cmd[0] == "pgrep" {
				if alive > 0 {
					alive--
					return nil
				}
				return errors.New("no process")
			}
			return nil
		},
		Start: func(cmd ...string) error {
			log = append(log, "start "+strings.Join(cmd, " "))
			return nil
		},
		Warn:  func(m string) { warned = append(warned, m) },
		Sleep: func(time.Duration) {},
	}
	return e, &log, &warned
}

func TestBordersStartsOnlyOnceTheOldOneHasGone(t *testing.T) {
	e, log, warned := bordersEnv(3)
	reload(e)
	start := slices.Index(*log, "start /repo/home/darwin/borders/config/bordersrc")
	pgreps := 0
	for _, l := range (*log)[:start] {
		if l == "pgrep -x borders" {
			pgreps++
		}
	}
	if start < 0 || pgreps != 4 || len(*warned) != 0 {
		t.Fatalf("log %v, warned %v", *log, *warned)
	}
}

func TestBordersGivesUpWaitingAfterTwoSeconds(t *testing.T) {
	e, log, warned := bordersEnv(1000)
	reload(e)
	if !slices.Contains(*log, "start /repo/home/darwin/borders/config/bordersrc") {
		t.Fatalf("not started after the wait: %v", *log)
	}
	if len(*warned) != 1 || !strings.Contains((*warned)[0], "did not exit within 2s") {
		t.Fatalf("warned %v", *warned)
	}
}

func TestMissingThemeFilesAreWarnedAbout(t *testing.T) {
	var warned []string
	e := Env{Home: t.TempDir(), Repo: t.TempDir(), Warn: func(m string) { warned = append(warned, m) }}
	_ = applyWallpaper(e, "nord")
	_ = applyVSCode(e, "no-such-theme")
	want := []string{"Wallpaper for 'nord' not found", "VSCode theme mapping not found for 'no-such-theme'"}
	if !slices.Equal(warned, want) {
		t.Fatalf("warned %q, want %q", warned, want)
	}
}
