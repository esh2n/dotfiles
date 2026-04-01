---
name: sdd
description: Spec-Driven Development workflow. Use when starting a new feature, bugfix, or any task that benefits from structured specification before implementation. Manages tasks and specs in ~/.config/work/{org}/{repo}/tasks/. Subcommands - init, clarify, research, design, tasks, implement, validate, status, list.
---

# Spec-Driven Development (SDD)

## Overview

Structured specification-driven development workflow that separates planning from implementation. Specs are stored outside the repository at `~/.config/work/{org}/{repo}/tasks/` so they are accessible from any git worktree.

**Announce at start:** "SDD スキルを使用します。"

## Core Concepts

- **task** = 作業の最上位単位。全ての作業はtaskとして管理される
- **spec** = taskに付随するオプショナルな構造化仕様（SDD成果物）
- **notes** = 探索的・断片的な仕様メモ。specのインプットになりうる

## Directory Resolution

### 1. Detect Repository Identity

```bash
# Get org/repo from git remote
remote_url=$(git remote get-url origin 2>/dev/null)
# Extract org/repo (handles both HTTPS and SSH)
org_repo=$(echo "$remote_url" | sed -E 's#.*(github\.com|gitlab\.com)[:/]##' | sed 's/\.git$//')
org=$(echo "$org_repo" | cut -d'/' -f1)
repo=$(echo "$org_repo" | cut -d'/' -f2)

WORK_ROOT="$HOME/.config/work/${org}/${repo}"
TASKS_DIR="${WORK_ROOT}/tasks"
TEMPLATES_DIR="$HOME/.config/work/_templates"
```

### 2. Initialize Work Directory (if needed)

```bash
mkdir -p "${TASKS_DIR}"
mkdir -p "${WORK_ROOT}/decisions"
mkdir -p "${WORK_ROOT}/docs"
```

## Subcommands

### `/sdd init <name>` — タスク作成

新しいタスクを作成し、必要に応じてSDD specを初期化する。

1. 連番を自動採番（既存の最大番号 + 1、ゼロパディング3桁）
2. slug を生成（英語ケバブケース）
3. タスクディレクトリを作成
4. `meta.md` と `notes.md` をテンプレートから生成
5. ユーザーに確認: **「このタスクにSDD specは必要ですか？」**
   - feature/大きめの変更 → spec推奨
   - bugfix/chore → specなしでOK
6. spec必要なら `spec/` ディレクトリを作成し、テンプレートから各ファイルを生成

**生成されるファイル:**
```
tasks/{NNN}-{slug}/
├── meta.md
├── notes.md
└── spec/              # SDD有効時のみ
    ├── requirements.md
    ├── research.md
    ├── design.md
    ├── contracts/
    ├── tasks.md
    └── checklist.md
```

**meta.md の初期値:**
```yaml
---
id: "{NNN}"
slug: "{slug}"
title: "{ユーザーが指定したタスク名}"
type: feature | bugfix | chore | exploration
status: draft
branch: ""
worktree: ""
created: "{YYYY-MM-DD}"
updated: "{YYYY-MM-DD}"
has_spec: true | false
---
```

**`_index.md` を更新:**
タスク一覧テーブルに新しいタスクを追加する。`_index.md` が存在しなければ作成する。

### `/sdd clarify` — 曖昧さの解消

**前提:** カレントタスクが特定されていること（meta.md の status が draft or clarify）

1. `notes.md` と `spec/requirements.md` の現在の内容を読む
2. 要件の曖昧な点を **最大5つ** の質問として提示する
3. ユーザーの回答を `spec/requirements.md` に反映する
4. `meta.md` の status を `clarify` → `requirements-done` に更新

**質問の観点:**
- 入出力の具体的な形式
- エッジケースの扱い
- 非機能要件（パフォーマンス、セキュリティ）
- 既存コードとの統合ポイント
- スコープの境界（何をやらないか）

### `/sdd research` — 調査

1. コードベースを探索し、関連するファイル・パターン・依存関係を調査
2. 結果を `spec/research.md` に記録
3. `meta.md` の status を `researching` に更新

**research.md に記録する内容:**
- 関連する既存コード（ファイルパス + 概要）
- 使用されているパターン・ライブラリ
- 影響範囲の分析
- 参考にすべき既存実装
- リスク・懸念点

### `/sdd design` — 設計

**前提:** requirements と research が完了していること

1. `spec/requirements.md` と `spec/research.md` を読む
2. アーキテクチャ設計を `spec/design.md` に作成
3. 必要に応じて `spec/contracts/` に API契約を作成
4. `meta.md` の status を `designing` に更新
5. **ユーザーに設計レビューを依頼する**

**design.md に含める内容:**
- システム構成図（Mermaid）
- データモデル
- コンポーネント間の依存関係
- 主要な処理フロー（Mermaid sequence diagram）
- 技術的判断とその理由

**contracts/ に含める内容（該当する場合）:**
- API エンドポイント定義
- リクエスト/レスポンス型
- エラーハンドリング仕様

### `/sdd tasks` — タスク分解

**前提:** design が完了しユーザーに承認されていること

1. `spec/design.md` を読む
2. 実装タスクを `spec/tasks.md` に分解
3. `spec/checklist.md` に Done 定義を作成
4. `meta.md` の status を `planned` に更新

**tasks.md のフォーマット:**
```markdown
# Implementation Tasks

## Phase 1: Foundation
- [ ] T001 データモデルの定義 (`src/models/user.ts`)
- [ ] T002 [P] バリデーションロジック (`src/validators/`)
- [ ] T003 [P] データベースマイグレーション (`migrations/`)

## Phase 2: Core Logic
- [ ] T004 [depends:T001] 認証サービスの実装 (`src/services/auth.ts`)
- [ ] T005 [depends:T001] API エンドポイント (`src/routes/auth.ts`)

## Phase 3: Integration
- [ ] T006 [depends:T004,T005] E2Eテスト (`tests/e2e/auth.test.ts`)
```

- `[P]` = 並列実行可能
- `[depends:TXXX]` = 依存タスク
- ファイルパスを明記してコンテキストを与える

**checklist.md のフォーマット:**
```markdown
# Definition of Done

## Functional
- [ ] 全ての requirements が実装されている
- [ ] エッジケースが処理されている

## Quality
- [ ] ユニットテストが書かれている
- [ ] lint/format が通っている
- [ ] 型エラーがない

## Integration
- [ ] 既存テストが壊れていない
- [ ] API契約に準拠している
```

### `/sdd implement` — 実装

**前提:** tasks が完了しユーザーに承認されていること

1. `spec/tasks.md` を読み、未完了タスクを特定
2. Phase 順に、依存関係を考慮して実装
3. `[P]` マーカーのタスクは可能なら並列で実装
4. 各タスク完了時に `spec/tasks.md` のチェックボックスを更新
5. `meta.md` の status を `implementing` に更新

**実装ルール:**
- spec/design.md の設計に従う
- spec/contracts/ の API契約に準拠する
- 1タスク完了ごとに tasks.md を更新
- 実装中に設計変更が必要な場合は **ユーザーに相談してから** design.md を更新

### `/sdd validate` — 検証

1. `spec/checklist.md` の各項目を検証
2. `spec/tasks.md` の全タスクが完了しているか確認
3. テストを実行
4. 結果を報告
5. 全て通れば `meta.md` の status を `done` に更新

### `/sdd status` — 現在のタスク状態

1. カレントブランチ名から対応するタスクを検索（meta.md の branch フィールド）
2. 見つからなければ、最後に更新されたin-progressタスクを表示
3. 以下を表示:
   - タスク名・ID・ステータス
   - spec の有無と各フェーズの進捗
   - tasks.md の完了率（spec がある場合）

### `/sdd list` — タスク一覧

1. `${TASKS_DIR}/_index.md` を表示
2. 存在しなければ、全タスクの meta.md をスキャンして生成

## Workflow Phases

```
                    ┌─────────────────────────────────────┐
                    │           /sdd init                  │
                    │  タスク作成 + spec要否判断            │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
             ┌──────│  spec不要: notes.md だけで作業開始   │
             │      └──────────────┬──────────────────────┘
             │                     │ spec必要
             │      ┌──────────────▼──────────────────────┐
             │      │         /sdd clarify                 │
             │      │   曖昧さ解消（最大5つの質問）         │
             │      └──────────────┬──────────────────────┘
             │                     │
             │      ┌──────────────▼──────────────────────┐
             │      │         /sdd research                │
             │      │   コードベース調査                    │
             │      └──────────────┬──────────────────────┘
             │                     │
             │      ┌──────────────▼──────────────────────┐
             │      │         /sdd design                  │
             │      │   設計 + Mermaid図 + API契約          │
             │      │   ★ ユーザーレビュー ★               │
             │      └──────────────┬──────────────────────┘
             │                     │
             │      ┌──────────────▼──────────────────────┐
             │      │         /sdd tasks                   │
             │      │   タスク分解 + Done定義               │
             │      │   ★ ユーザー承認 ★                   │
             │      └──────────────┬──────────────────────┘
             │                     │
             ├─────────────────────┤
             │                     │
             │      ┌──────────────▼──────────────────────┐
             │      │         /sdd implement               │
             │      │   Phase順に実装                      │
             │      └──────────────┬──────────────────────┘
             │                     │
             │      ┌──────────────▼──────────────────────┐
             └─────►│         /sdd validate                │
                    │   checklist検証 + テスト実行          │
                    └──────────────────────────────────────┘
```

## Current Task Resolution

複数のサブコマンドで「カレントタスク」を特定する必要がある。以下の優先順で解決する:

1. **引数で指定:** `/sdd design 001` → タスク001を対象
2. **ブランチ名から逆引き:** 現在のgitブランチ名で全タスクの meta.md を検索
3. **最新のin-progress:** status が implementing/designing 等の最新タスク
4. **見つからない場合:** ユーザーに選択を求める

## Integration with Git Worktree

worktree作成時に `/sdd init` で作ったタスクと紐づける:

```bash
# worktree 作成後、meta.md を更新
branch=$(git branch --show-current)
worktree_path=$(pwd)
# meta.md の branch と worktree フィールドを更新
```

**using-git-worktrees スキルとの連携:**
1. `/sdd init` でタスク作成
2. `using-git-worktrees` でworktree作成
3. meta.md の branch/worktree を自動更新
4. `/sdd clarify` → `/sdd design` → `/sdd tasks` → `/sdd implement`

## ADR (Architecture Decision Records)

設計フェーズで重要な技術的判断があった場合:

```bash
# decisions/ に ADR を作成
DECISIONS_DIR="${WORK_ROOT}/decisions"
# NNN-title.md 形式
```

**ADR フォーマット:**
```markdown
# ADR-{NNN}: {タイトル}

## Status
Accepted | Proposed | Deprecated | Superseded by ADR-XXX

## Context
{判断が必要になった背景}

## Decision
{何を決めたか}

## Consequences
{この判断の結果・トレードオフ}
```

## Red Flags

**Never:**
- spec未完了の状態で implement に進む（ユーザー承認なしで）
- design.md を実装中にユーザーに相談なく変更する
- tasks.md のチェックを更新せずに次のタスクに進む
- 他のタスクの spec を上書きする

**Always:**
- clarify で曖昧さを解消してから design に進む
- design と tasks はユーザーレビュー/承認を挟む
- 実装中は tasks.md の進捗を逐次更新する
- status 変更時に meta.md の updated フィールドも更新する
