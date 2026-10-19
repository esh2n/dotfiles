# 決定は全体用とリポジトリ用に分けて描く

Status: accepted — 持ち主の裁定（2026-10-18）。`2026-09-22-decision-records.md` の「`rule:` 行を AGENTS.md に写す」を、写す先を分ける形に細かくする。行の形（`- <rule> (<file>)`、太字にしない、メモへのリンクは付けず置き場所を節の頭で 1 回書く）は、`2026-09-22-decision-records.md` の「太字一行とメモへのリンク」と `2026-09-23-model-facing-english.md` の「AGENTS.md の太字一行に写す」を置き換える

rule: A decision note that rules only how this dotfiles repository is built carries `scope: repo` under its `rule:` line; jig renders those into the checkout's own untracked `AGENTS.md` (with a `CLAUDE.md` link), and only the rest into every harness's AGENTS.md. Each rendered line is plain, ends with its note's file name, and the notes' directory is named once per section.
scope: repo

## Problem

ユーザー全体の AGENTS.md は 38.8 KB あり、Codex が読む上限 32 KiB を超えて末尾が切れていた。73% は決定の節で、43 本のうち 34 本は Nix・dotctl・jig・LiteLLM の配線など、この dotfiles を触るときにしか要らない内容だった。それが仕事のリポジトリを含む全セッションに毎回載っていた。各行の後ろの絶対パスのリンクだけで 6.7 KB あり、どの行も全体が太字だった。

## Decision

1. 決定記録に `scope: repo` の行を置ける。無ければ全体用。
2. jig は全体用の決定だけをユーザー全体の AGENTS.md（Claude Code、Codex、pi、omp、DSH）に描く。`scope: repo` の決定は、dotfiles の checkout 直下の `AGENTS.md` に描き、`CLAUDE.md` をそれへのリンクにする。どちらも生成物なので git では無視する。どのハーネスも作業ディレクトリの AGENTS.md（Claude Code は CLAUDE.md）を読むので、dotfiles で作業するときだけ載る。
3. 行の形は `- <rule> (<file>)`。決定記録の置き場所は節の頭で 1 回だけ書く。太字はやめる。
4. 共通ルールのうち決定と同じ内容の文（Delegation 節の subagent と workflow の使い分け、Git 節の main への push の詳細）は消し、決定の側に残す。

振り分けの結果、全体用は 9 本（goal 運用、MCP の方針、記憶の扱い、調査の四方向、subagent と workflow、計画の大きさ、tier の固定、main への push、worktree の作法）、リポジトリ用は 34 本。全体の AGENTS.md は 14.4 KB になった。

## Alternatives considered

- **決定の文を短く書き直す**: `rule:` 行は人が書いた英文をそのまま写す決まりで、生成器が縮めることはしない。書き直すなら決定ごとに別途行う。
- **リポジトリ用の決定を AGENTS.md に描かず、決定記録を読ませるだけにする**: dotfiles で作業するときに効かなくなる。却下。
- **リポジトリ直下の AGENTS.md を commit する**: 生成物を commit しない決定（`2026-09-24-harness-top-level-dir.md`）に反する。却下。

## Consequences

- 新しい決定記録を書くときは、全体に効くかこのリポジトリだけかを決め、後者なら `scope: repo` を付ける。
- dotfiles の checkout 直下に `AGENTS.md` と `CLAUDE.md` が生成される。git の管理外。
- Patterns 節（Repository パターン、API の応答の形）、Testing 節（カバレッジ 80%、E2E 必須）、Compaction Timing 節は全体用に残っている。プロジェクトごとの慣習とぶつかる可能性があるが、方針の問題なので別に決める。
