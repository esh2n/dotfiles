package llm

import (
	"fmt"
	"strings"
)

// Once is what only a person can do, once: the tailnet policy on every
// machine, and on the observer Mac the phone's two pairings — Open WebUI
// through the tailnet, and Orca's companion straight over it
// (rules/decisions/2026-09-23-phone-steers-sessions-via-orca-companion.md).
// The names and addresses are this machine's own, read from the tailnet.
func Once(e Env) []string {
	e = e.withDefaults()
	steps := []string{
		"The tailnet policy (once per tailnet, and again after editing acl.hujson):\n" +
			"make tailscale-acl, then paste it in the admin console and Save.",
	}
	if !e.Offer.Console {
		return steps
	}
	name, ip := "<this Mac's tailnet name>", "100.x.y.z"
	if ts := e.tailscale(); ts != "" {
		st := e.status(ts)
		if n := strings.TrimSuffix(st.Self.DNSName, "."); n != "" {
			name = n
		}
		if len(st.Self.TailscaleIPs) > 0 {
			ip = st.Self.TailscaleIPs[0]
		}
	}
	return append(steps,
		"The phone joins the tailnet: install the Tailscale app, log in with the same account and switch it on —\n"+
			"it must appear in `tailscale status`. Then open "+fmt.Sprintf("https://%s:3001", name)+"\n"+
			"and create the first (admin) account of Open WebUI.",
		"The phone pairs Orca's companion, straight over the tailnet (a pairing made through Orca Relay must be redone):\n"+
			"Orca → 設定 → セットアップ → モバイル → 接続方法 = LAN (not Orca Relay)\n"+
			"→ open 「より速いローカル経路も使う」 and pick this Mac's Tailscale IP ("+ip+"), not the Wi-Fi 192.168.x.x\n"+
			"→ remove the old paired device → QRコードを生成 → on the phone: Orca Mobile → Pair Desktop → scan.\n"+
			"Check it with Wi-Fi off and Tailscale on: the worktree list must show (https://onorca.dev/docs/mobile).",
	)
}
