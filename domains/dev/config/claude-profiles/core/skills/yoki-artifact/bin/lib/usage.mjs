// usage.mjs — the help text, kept apart from the dispatcher so `--help` stays
// one string that is easy to read and easy to diff.

export const USAGE = `yoki-artifact — publish and manage yoki artifacts.

Usage:
  yoki-artifact publish <file.html> --channel <c> [--title t] [--label l] [--note n]
                                    [--allow-external] [--json] [--open]
  yoki-artifact list [--json]
  yoki-artifact versions <channel> [--json]
  yoki-artifact revoke <channel> [--json]
  yoki-artifact share <channel> --to a@b [--to c@d] [--json]
  yoki-artifact unshare <channel> --to a@b [--json]
  yoki-artifact open <channel>
  yoki-artifact comments <channel> [--since ISO] [--to-agent] [--json]
  yoki-artifact reply <channel> <comment-id> <text> [--json]
  yoki-artifact resolve <channel> <comment-id> [--json]
  yoki-artifact seen <channel> <comment-id> [--json]
  yoki-artifact watch <channel...> [--interval 30] [--once] [--json]
  yoki-artifact doctor [--json]

Publish refuses, before any network call, a file that is missing, not a single
HTML file, over 16 MiB, that matches a credential pattern, or that references a
host outside the artifact CSP allowlist (--allow-external downgrades the last
one to a warning). A writeup-kit page is additionally run through
writeup-kit's self-check when that skill is installed.

Configuration (~/.config/yoki-artifact/config.json):
  { "baseUrl": "https://...", "clientId": "...<id>.access",
    "secretCommand": "op read op://Private/yoki-artifact/credential" }

Environment overrides (these win over the file):
  YOKI_ARTIFACT_URL, YOKI_ARTIFACT_CLIENT_ID, YOKI_ARTIFACT_CLIENT_SECRET

The client secret is never read from, or written to, the config file.

Exit codes:
  0 ok   1 usage   2 network/auth   3 external refs   4 secret scan   5 too large
`;
