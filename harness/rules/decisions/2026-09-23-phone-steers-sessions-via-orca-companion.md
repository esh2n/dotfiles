# スマホからセッションを操作するのはOrcaのcompanion、経路はTailscale直結

Status: accepted — 持ち主の裁定（2026-09-23）。スマホからすべての操作ができること（Claude CodeやCursorのクラウド版と同じ）を要件に、調査記録の結論とOrcaのcompanionから推した形を採った

rule: Steer a coding-agent session running on the Mac from the phone through Orca's mobile companion, paired by code and connected directly over the tailnet (never Orca Relay); Claude Code's Remote Control is a fallback for when Orca is not running, not a requirement. Do not build or adopt a relay app (Happy Coder and the like), a custom omp/pi bridge, or a Tailscale SSH + terminal-app setup for this purpose. Chat with the home models from the phone stays Open WebUI over Tailscale, pointed at the LiteLLM tiers.
scope: repo

## Problem

ホームLLMの裁定は「スマホからMacのモデルとチャットする」（Open WebUI）までで、「Macで動いているcoding agentのセッションを見て操作する」（承認、diff、継続対話、新規起動）は扱っていなかった。要件は後者。

## Decision

- 主: **Orcaのmobile companion**（iOS / Android、純正）。全worktreeの状態、生の端末とスクロールバック、待ち状態への返答（continue / yes / 自由文）、Source Control（差分・stage・commit）、workspaceの作成、アカウント切替。
- 経路: MacのOrcaが出すペアリングコードをスマホに貼り、**Tailscale越しの直結**。Orca Relay（サインイン、中継）は使わない。
- 補助: Claude CodeのRemote Control（`claude remote-control`）。Orcaを閉じているときだけ。サブスク認証直結のClaude Codeでしか動かず、`ANTHROPIC_BASE_URL`をゲートウェイに向けると動かない制約は、今の構成（Claude Codeはベンダー直）で満たす。
- 採らない: リレー型アプリ（Happy Coderは既定で`--dangerously-skip-permissions`、#1514 open）、omp / piの非公式ブリッジ（★1〜25）、Tailscale SSH + 端末アプリ（Orca companionが同じ経路で端末そのものを見せる）。

## Alternatives considered

- **Claude Code Remote Controlを主に**: 純正だがClaude Code限定。omp / pi / DSH / Codexが対象外。補助に降格。
- **Tailscale SSH + tmux/mosh + Termius/Termux**: 実践者の主流で放棄報告なし。だがOrca companionが同じTailscale直結で、承認とSource Controlを画面として持つので、端末をスマホで打つ理由が無い。
- **Happy Coder等のリレー**: 承認を無効化する既定値の未修正issue。却下。
- **ompのRPCを叩く自作ブリッジ**: 前例が ★25以下。却下。

## Consequences

- 人手: MacのOrcaでペアリングコードを出し、スマホのOrcaアプリに貼る（一回）。人手の残作業の一覧に載せる（当時は`domains/dev/install.sh`、今の入口は`make up`）。
- 未確認: omp / pi / DSHのセッションがOrcaの「Chat UI」に載るか（非対応なら生の端末で、承認は端末に打つ）。Orca Relayがトラフィックを保存するかは文書に無い（使わないので影響なし）。
- Orca desktopを閉じると切れる（文書どおり）。常駐させるかは持ち主の運用。
- 前例なし: Orca companionをTailscale直結で運用した公開報告、計測（レイテンシ・再接続）。

## Sources

- Tailscale SSH + 端末アプリの実践者記録（放棄報告なし、補助に降格した根拠）: https://www.qu8n.com/posts/running-claude-code-from-my-phone 、https://www.skeptrune.com/posts/claude-code-on-mobile-termux-tailscale/
- https://onorca.dev/docs/mobile 、https://onorca.dev/
- https://code.claude.com/docs/en/remote-control
- https://github.com/slopus/happy/issues/1514
