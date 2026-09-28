# スマホからセッションを操作するのは Orca の companion、経路は Tailscale 直結

Status: accepted — 持ち主の裁定（2026-09-23）。スマホからすべての操作ができること（Claude Code や Cursor のクラウド版と同じ）を要件に、調査記録の結論と Orca の companion から推した形を採った

rule: Steer a coding-agent session running on the Mac from the phone through Orca's mobile companion, paired by code and connected directly over the tailnet (never Orca Relay); Claude Code's Remote Control is a fallback for when Orca is not running, not a requirement. Do not build or adopt a relay app (Happy Coder and the like), a custom omp/pi bridge, or a Tailscale SSH + terminal-app setup for this purpose. Chat with the home models from the phone stays Open WebUI over Tailscale, pointed at the LiteLLM tiers.

## Problem

ホーム LLM の裁定は「スマホから Mac のモデルとチャットする」（Open WebUI）までで、「Mac で動いている coding agent のセッションを見て操作する」（承認、diff、継続対話、新規起動）は扱っていなかった。要件は後者。

## Decision

- 主: **Orca の mobile companion**（iOS / Android、純正）。全 worktree の状態、生の端末とスクロールバック、待ち状態への返答（continue / yes / 自由文）、Source Control（差分・stage・commit）、workspace の作成、アカウント切替。
- 経路: Mac の Orca が出すペアリングコードをスマホに貼り、**Tailscale 越しの直結**。Orca Relay（サインイン、中継）は使わない。
- 補助: Claude Code の Remote Control（`claude remote-control`）。Orca を閉じているときだけ。サブスク認証直結の Claude Code でしか動かず、`ANTHROPIC_BASE_URL` をゲートウェイに向けると動かない制約は、今の構成（Claude Code はベンダー直）で満たす。
- 採らない: リレー型アプリ（Happy Coder は既定で `--dangerously-skip-permissions`、#1514 open）、omp / pi の非公式ブリッジ（★1〜25）、Tailscale SSH + 端末アプリ（Orca companion が同じ経路で端末そのものを見せる）。

## Alternatives considered

- **Claude Code Remote Control を主に**: 純正だが Claude Code 限定。omp / pi / DSH / Codex が対象外。補助に降格。
- **Tailscale SSH + tmux/mosh + Termius/Termux**: 実践者の主流で放棄報告なし。だが Orca companion が同じ Tailscale 直結で、承認と Source Control を画面として持つので、端末をスマホで打つ理由が無い。
- **Happy Coder 等のリレー**: 承認を無効化する既定値の未修正 issue。却下。
- **omp の RPC を叩く自作ブリッジ**: 前例が ★25 以下。却下。

## Consequences

- 人手: Mac の Orca でペアリングコードを出し、スマホの Orca アプリに貼る（一回）。`domains/dev/install.sh` の残作業に載せる。
- 未確認: omp / pi / DSH のセッションが Orca の「Chat UI」に載るか（非対応なら生の端末で、承認は端末に打つ）。Orca Relay がトラフィックを保存するかは文書に無い（使わないので影響なし）。
- Orca desktop を閉じると切れる（文書どおり）。常駐させるかは持ち主の運用。
- 前例なし: Orca companion を Tailscale 直結で運用した公開報告、計測（レイテンシ・再接続）。

## Sources

- `rules/research/2026-09-23-phone-access-to-agent-sessions.md`（追記に Orca）
- https://onorca.dev/docs/mobile 、https://onorca.dev/
- https://code.claude.com/docs/en/remote-control
- https://github.com/slopus/happy/issues/1514
