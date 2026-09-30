# 整形と検査はプロジェクト自身の手順が最優先、jig の対応表は手順が無いときの既定

Status: accepted — 業界の多数派はハーネス側の薄い対応表だが、プロジェクトが自分の手順（lefthook / pre-commit）を持つ大規模リポジトリはそれに委譲している。持ち主の裁定（2026-09-23）で、プロジェクトの規則を最優先にする

rule: When the project defines its own hooks (`lefthook.yml` / `.lefthook.yml` or `.pre-commit-config.yaml` at the project root), jig's edit-time formatter and Stop-time gate run those on the touched files instead of jig's own table; jig's extension→formatter and marker→gate tables apply only to projects with no such file. Never override a project's own lint or format rules with harness defaults.

## Problem

jig の PostToolUse（編集ごとの整形）と Stop（応答の終わりの型検査・lint）は、拡張子 → 1 コマンド、印 → 1 コマンドの小さな対応表で何を走らせるかを決めている。プロジェクトが `lefthook.yml` や `.pre-commit-config.yaml` で自分の手順を持っていても、jig はそれを見ずに対応表で上書きする。どちらが強いべきか。

## Decision

- **プロジェクトの手順が最優先。** プロジェクトのルートに `lefthook.yml`（または `.lefthook.yml`）か `.pre-commit-config.yaml` があれば、編集ごとの整形は `lefthook run pre-commit --files <file>` / `pre-commit run --files <file>` を呼び、応答の終わりのゲートは同じ手順をそのターンで触ったファイルに対して走らせる。jig の対応表は使わない。
- **jig の対応表は既定に格下げ。** 上のファイルが無いプロジェクトでだけ、今の表（ts/js → biome か prettier、go → gofmt、py → ruff format、rs → rustfmt；`tsconfig.json` → `tsc --noEmit`、`go.mod` → `go vet`、`pyproject.toml` → `ruff check`、`Cargo.toml` → `cargo check`）が効く。
- 対応表の中身（どの言語に何を足すか、整形でも型検査でもない検査をどこに置くか、未対応 7 言語）は別の裁定。この決定は優先順位だけを決める。
- 手順ファイルはあるが道具（lefthook / pre-commit）が入っていないときは、対応表に落ちず、一度だけ「入れろ」と告げて何もしない（プロジェクトの規則を jig の規則で代用しない）。

## Alternatives considered

- **jig の対応表だけで行く（現状）**: 数の上では業界の多数派（PostToolUse から prettier 直書き 1,724 件、pre-commit 委譲 186 件、lefthook 委譲 4 件）。単純だが、プロジェクトの手順と二重管理になり、プロジェクトが除外や順序を決めていても jig が別の規則で上書きする。プロジェクトの規則を最優先にする要件に反する。却下。
- **手順ファイルの有無に関わらず両方走らせる**: 二重に整形・検査し、結果が食い違ったときにどちらが正か分からない。却下。
- **`package.json` の scripts や mise の tasks も「プロジェクトの手順」とみなす**: 実在するが、何が整形で何が検査かの規約が無く、勝手に走らせると副作用がある。前例が確認できた lefthook / pre-commit に限り、必要になったら広げる。

## Consequences

- `jig/src/domain/hooks/format.ts` と `gate.ts` に「プロジェクトの手順の検出」を最初の分岐として足す。ゲートは「このターンで触ったファイル」を `git diff --name-only`（+ untracked）で集めて手順に渡す。
- 手順の実行に失敗したとき（道具が無い等）は対応表に落とさず、その旨を一度だけ告げる。
- 前例なし: 対応表型と委譲型の A/B 測定。lefthook を PostToolUse から呼ぶ実例は 4 件ヒットしたが配線は未確認。

## Sources

- `rules/decisions/2026-09-23-all-languages-format-and-gate.md`
- 委譲の実例: dragonflydb（PostToolUse → `pre-commit run --files`）、ray-project（skill 経由で pre-commit）
- lefthook: https://github.com/evilmartians/lefthook 、pre-commit: https://pre-commit.com/
