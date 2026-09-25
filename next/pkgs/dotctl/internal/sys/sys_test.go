package sys

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestWithEnvSetsAndRemovesWithoutTouchingBase(t *testing.T) {
	base := []string{"A=1", "B=2", "AB=3"}
	got := WithEnv(base, []string{"A=9", "B=", "C=4"})
	want := []string{"AB=3", "A=9", "C=4"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if !reflect.DeepEqual(base, []string{"A=1", "B=2", "AB=3"}) {
		t.Fatalf("base changed: %v", base)
	}
}

func TestCaptureSeparatesStreamsAndTimesOut(t *testing.T) {
	var s OS
	out, errOut, err := s.Capture(0, "sh", "-c", "echo out; echo err >&2")
	if err != nil || out != "out\n" || errOut != "err\n" {
		t.Fatalf("got %q %q %v", out, errOut, err)
	}
	_, _, err = s.Capture(50*time.Millisecond, "sh", "-c", "sleep 5")
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("want a timeout, got %v", err)
	}
	if !s.Has("sh") || s.Has("no-such-command-here") {
		t.Fatal("Has is wrong")
	}
}
