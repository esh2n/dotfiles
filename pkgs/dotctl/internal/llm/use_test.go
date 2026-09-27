package llm

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestUsePointsTheTierRegeneratesThenRestarts(t *testing.T) {
	w := newWorld(t, "darwin", Offer{})
	jig := filepath.Join(w.env.Repo, "harness", "bin", "jig")
	restarted := 0
	if err := Use(w.env, "main", []string{"mimo-v2.6-flash"}, func() error { restarted++; return nil }); err != nil {
		t.Fatal(err)
	}
	want := []string{jig + " tiers use main mimo-v2.6-flash", jig + " apply --target all --write"}
	if len(w.sys.calls) != 2 || w.sys.calls[0] != want[0] || w.sys.calls[1] != want[1] {
		t.Fatalf("calls %v", w.sys.calls)
	}
	if restarted != 1 || !strings.Contains(w.out.String(), "LiteLLM is up with main → mimo-v2.6-flash") {
		t.Fatalf("restarted %d, out %q", restarted, w.out.String())
	}
}

func TestUseStopsAtTheFirstFailureAndSaysWhatJigSaid(t *testing.T) {
	w := newWorld(t, "linux", Offer{})
	jig := filepath.Join(w.env.Repo, "harness", "bin", "jig")
	w.sys.fail[jig+" tiers use"] = true
	w.sys.stderr[jig+" tiers use"] = `jig tiers: tier "main" names "nope", which policy/models.json does not have`
	restarted := false
	err := Use(w.env, "main", []string{"nope"}, func() error { restarted = true; return nil })
	if err == nil || !strings.Contains(err.Error(), "does not have") || restarted || len(w.sys.calls) != 1 {
		t.Fatalf("err %v, restarted %v, calls %v", err, restarted, w.sys.calls)
	}
}

func TestUseReportsARestartThatFails(t *testing.T) {
	w := newWorld(t, "linux", Offer{})
	err := Use(w.env, "complex", []string{"mimo-v2.6-pro"}, func() error { return errors.New("no answer") })
	if err == nil || !strings.Contains(err.Error(), "restart LiteLLM: no answer") {
		t.Fatalf("err %v", err)
	}
	if err := Use(w.env, "complex", nil, func() error { return nil }); err == nil {
		t.Fatal("no models accepted")
	}
}
