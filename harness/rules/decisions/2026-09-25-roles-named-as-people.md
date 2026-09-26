# 役割は「その機械が家の中で誰か」を表す人の名前にする

Status: accepted — 持ち主の裁定（2026-09-25、「role は通常の web app の admin のような人の名前がいい」「observer はいい」、提案一式に「ok」）。`plans/2026-09-24-dotfiles-architecture.md` §11 の未決 2 のうち、役割の一覧を閉じる

rule: Name each machine role for who the machine is to the rest of the home — developer, desk-user, model-provider, observer — never for a product (lmstudio), a part (gpu) or coined jargon (llm-console). A role grants capabilities the way a web app's role grants permissions: feature modules check only their own capability option, never a role name. Every machine is base without listing it; one role covers one job, and the engine behind it follows the detected platform (model-provider is LM Studio on macOS, llama-server on Linux with NVIDIA).

## Problem

役割の名前が直感的でなかった。`dev`・`desktop` は使い方、`lmstudio` は製品名、`gpu` は部品の名前、`llm-console` は造語と、名前の観点が混ざっていた。しかも `lmstudio` と `gpu` は「自分のモデルを tailnet で他の機械に貸す」という同じ仕事なのに、OS ごとに別の名前だった。

## Decision

| 旧 | 新 | 意味 |
|---|---|---|
| base | （書かない） | 全部の機械。ログイン済みユーザーと同じで、いつも有効 |
| dev | developer | コーディングエージェントで開発する |
| desktop | desk-user | 人が前に座る。GUI アプリ・フォント・メディアの道具 |
| lmstudio、gpu | model-provider | 自分のローカルモデルを tailnet で貸す。Mac は LM Studio、Linux + NVIDIA は llama-server（OS を検出して決める） |
| llm-console | observer | Prometheus・Grafana・コストの台帳・Open WebUI（スマホのチャット）を持つ一台 |

- 役割は Web アプリの権限の仕組みと同じ形にする。役割ファイル（`roles.json`）が機械に役割を割り当て、`roles/<name>.nix` が役割ごとに機能のスイッチ（`dotfiles.services.*`、`dotfiles.packages.*`、`dotfiles.homeLlm.*`）を入れる。機能の側は自分のスイッチだけを見て、役割名では分岐しない（テストで検査済み）。
- 役割ファイルの `consoleHost` は `observerHost` にする。
- 旧名が役割ファイルに残っていれば、`facts.nix` は新しい名前を示して止まる（`roles/renamed.nix`）。この Mac の役割ファイルは `adopt-mac.sh` が一度だけ書き換える。
- Open WebUI（スマホのチャット）は「見る」仕事ではないが、observer に含める（持ち主の裁定）。

## Alternatives considered

- **旧名のまま**: 名前の観点が混ざったまま残り、読み手がそのつど中身を確かめる必要がある。却下。
- **機能の名前（`gui`、`llm-dashboard` など）**: 何が入るかは表すが、機械の立場を表さない。持ち主が人の名前を選んだ。却下。
- **lmstudio と gpu を別の役割のまま残す**: 同じ仕事に二つの名前があり、しかも OS で分かれる。「機械の種類は検出し、名前では決めない」（`2026-09-24-dotfiles-nix-only-roles-symlink.md`）とも合わない。却下。
- **旧名を別名として受け付け続ける**: 名前が二重になり、いつまでも消せない。旧名は分かりやすい誤りで止め、書き換えは一度きりにする。却下。

## Consequences

- 以前の決定メモと調査記録にある `llm-console`・`lmstudio`・`gpu`（役割名として）は、履歴なのでそのまま残す。読み替えはこのメモの表による。
- CI の Linux のビルドは model-provider を入れない（llama.cpp の CUDA 版はどのバイナリキャッシュにも無く重い）。

## Sources

- `plans/2026-09-24-dotfiles-architecture.md` §11 の 2
- `2026-09-24-dotfiles-nix-only-roles-symlink.md`（機械の種類は検出する）
