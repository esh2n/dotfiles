package llm

import (
	"strings"
	"testing"
)

func TestOnceIsThePolicyEverywhereAndThePhoneOnTheObserver(t *testing.T) {
	w := newWorld(t, "darwin", Offer{LMStudio: true})
	if got := Once(w.env); len(got) != 1 || !strings.Contains(got[0], "make tailscale-acl") {
		t.Fatalf("a model provider only gets the policy: %q", got)
	}

	w = newWorld(t, "darwin", Offer{Console: true})
	w.running()
	w.sys.outputs["tailscale status --json"] = `{"Self": {"DNSName": "mac.example.ts.net.", "TailscaleIPs": ["100.64.0.7", "fd7a::7"]}}`
	got := Once(w.env)
	if len(got) != 3 {
		t.Fatalf("the observer gets three steps: %q", got)
	}
	if !strings.Contains(got[1], "https://mac.example.ts.net:3001") {
		t.Fatalf("Open WebUI's address is this Mac's: %q", got[1])
	}
	if !strings.Contains(got[2], "(100.64.0.7)") || !strings.Contains(got[2], "接続方法 = LAN") {
		t.Fatalf("Orca's step names this Mac's Tailscale IP: %q", got[2])
	}
}

func TestOnceWithoutTailscaleNamesPlaceholders(t *testing.T) {
	w := newWorld(t, "darwin", Offer{Console: true})
	got := Once(w.env)
	if !strings.Contains(got[1], "<this Mac's tailnet name>") || !strings.Contains(got[2], "100.x.y.z") {
		t.Fatalf("placeholders when the tailnet cannot be read: %q", got)
	}
}
