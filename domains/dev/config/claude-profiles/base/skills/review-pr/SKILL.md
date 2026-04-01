---
name: review-pr
description: Review a PR professionally with prioritized findings. Read-only — never comments on or approves PRs. Loads domain-specific perspectives (React, Go/DDD, etc.) from perspectives/ directory. Use when asked to review a PR.
disable-model-invocation: true
argument-hint: [PR-number-or-url]
---

# PR Review

$ARGUMENTS のPRをレビューする。

## Step 1: 情報収集

gh コマンドで情報取得する。**PRへのコメント・approve・request-changes等のwrite操作は絶対にしない。**

```bash
gh pr view $ARGUMENTS
gh pr diff $ARGUMENTS
gh pr view $ARGUMENTS --json files --jq '.files[].path'
```

PRのdescription・リンクされたissueを読み、**変更の目的を理解してからdiffを読む**。

## Step 2: コードを読む

- diffだけでなく**変更ファイルの全体**を読む
- 関連する既存コードも読む（呼び出し元、テスト、型定義）
- ADR・設計ドキュメントがあれば参照し準拠しているか確認

## Step 3: 分野別の観点を読み込む

変更ファイルの言語・フレームワーク・アーキテクチャを判断し、該当するperspectiveファイルを読む。複数分野にまたがるPRでは該当する全てを読む。

- [perspectives/frontend-react.md](perspectives/frontend-react.md) — React/TypeScript
- [perspectives/backend-go-ddd-clean.md](perspectives/backend-go-ddd-clean.md) — Go/DDD + Clean Architecture

該当するperspectiveファイルが存在しない言語・アーキテクチャの場合は、その分野のベストプラクティスと権威ある参考文献を自分で判断し、同じ構造（観点テーブル + 参考文献リスト）でレビューする。

## Step 4: 共通観点（全PRで必ずチェック）

| 観点 | チェック内容 |
|------|-------------|
| バグ | ロジックエラー、off-by-one、null/nil handling、境界条件 |
| セキュリティ | injection、認証・認可チェック、秘密情報の露出 |
| エラーハンドリング | エッジケース、タイムアウト、リトライ、cleanup |
| テスト品質 | 変更に対応するテストが存在するか。振る舞いを検証しているか（実装詳細でなく）。エッジケース・エラーケースのテストがあるか。テストが壊れやすくないか |
| 既存コードとの整合性 | パターン統一。ただし既存が間違っている可能性も指摘する |

## Step 5: 出力

### フォーマット

```
### P0: [ファイル名:行番号] 指摘タイトル

**問題**: 何が問題か（コードを引用）
**理由**: なぜ問題か
**提案**: どう直すか
**参考**: 文献名 + URL
**confidence**: high / medium
```

### 優先度

- **P0 (Must Fix)**: バグ、データ不整合、セキュリティ脆弱性。mergeすべきでない
- **P1 (Should Fix)**: 設計問題、慣習違反、テスト不足。今直さないと負債になる
- **P2 (Suggestion)**: より良い書き方の提案。スタイルや好みレベルも含む

最後に **総評**（良い点も含める）。

## 制約

- **gh コマンドは情報取得のみ**。write操作は絶対にしない
- 実装はしない。レビューコメントの提示のみ
- 各指摘にconfidenceをつけ、推測の場合はそう明記する
- 参考文献は必ず添える。公式ドキュメント、RFC、著名な書籍等の権威あるソースを優先する
