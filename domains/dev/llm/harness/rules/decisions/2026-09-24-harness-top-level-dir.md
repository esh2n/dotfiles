# ハーネスの元はリポジトリ直下の harness/ に置く（domains/ の解体に合わせて）

Status: accepted — 持ち主の裁定（2026-09-24、ディレクトリ構造の提案に「ok」）。`2026-09-22-config-layout-no-personal-layer.md` の置き場所の部分（`domains/dev/llm/harness/`）だけを置き換える。種類ごとに一か所、personal 層を作らない、翻訳は生成器（jig）が持つ、生成物を commit しない、は変わらない

rule: Keep harness source files under harness/ at the repository root, organized by kind (rules/, skills/, agents/, hooks/, mcp/, policy/, jig/), never a separate personal/ layer. Do all per-harness translation inside the jig apply generator, and never commit its generated output to the repository.

## Problem

dotfiles のアーキテクチャ（`plans/2026-09-24-dotfiles-architecture.md`）で、生活領域で分けていた `domains/` を解体し、一機能一ディレクトリ・評価の文脈ごとの置き場（`lib/`・`roles/`・`system/`・`home/`・`pkgs/`）に組み直す。ハーネスだけが `domains/dev/llm/harness/` に残ると、解体したはずの軸が一か所だけ残る。

## Decision

- ハーネスの元（jig、rules、skills、agents、hooks、mcp、policy、workflows）はリポジトリ直下の `harness/` に置く。テストと CI を持つ一つのアプリとして扱う。
- 配線（`~/.claude` などへ届ける activation）は `home/shared/harness/` のモジュールが持ち、中身は `harness/` を参照する。
- 移動はアーキテクチャ移行の M6。それまでのパスは今のまま。

## Alternatives considered

- **`domains/dev/llm/harness/` のまま**: `domains/` を解体すると一か所だけ旧軸が残る。却下。
- **`home/shared/harness/` に中身ごと入れる**: jig は TypeScript のアプリで、テスト・lint・型検査を持つ。home-manager のモジュールと同じ木に置くと、Nix の配線と独立したアプリの境界がぼやける。却下。

## Consequences

- 移動時に書き換えるもの: jig の中の相対パス、AGENTS.md の生成元、`~/.config/jig/policy` のリンク元、`.gitignore`、CI、docs、各決定メモと調査記録の中のパス表記（履歴として残すものは書き換えない）。
- 移動は一回の commit で行い、`jig apply` の出力が移動前と同じことを確かめる。

## Sources

- `plans/2026-09-24-dotfiles-architecture.md`
- `rules/research/2026-09-24-nix-config-architecture.md`（ryan4yin・Misterio77 の `pkgs/`・`projects/`、britter.dev の同居）
