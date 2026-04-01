# Backend (Go / DDD + Clean Architecture)

## 観点

| 観点 | チェック内容 |
|------|-------------|
| 集約設計 | 集約の境界は適切か、トランザクション整合性の範囲、集約間の参照はIDのみか |
| エンティティ | privateフィールド+ファクトリ関数で不変条件を保護しているか、サロゲートキーの管理 |
| 値オブジェクト | 不変か、等価性はフィールドベースか、バリデーションがコンストラクタに集約されているか |
| ユビキタス言語 | 命名がドメインの用語と一致しているか、コード上の名前がADRや仕様と揃っているか |
| レイヤー依存 | ドメイン層(core)がインフラ(DB, HTTP, メッセージング)に依存していないか、依存の方向が内向きか |
| リポジトリ | interfaceの定義場所、実装の配置、クエリの責務が適切か |
| アプリケーションサービス | ユースケースの粒度、ドメインロジックがサービスに漏れ出ていないか、トランザクション境界 |
| ハンドラー/プレゼンテーション | リクエスト/レスポンスの変換のみか、ビジネスロジックが混入していないか |
| Go慣習 | error handling（wrap/sentinel/Is/As）、命名（短く明確）、interface設計（小さく、利用側で定義）、パッケージ可視性(internal) |
| 並行処理 | goroutineリーク、context伝播とキャンセル、channel設計、sync primitives |
| テスト | テーブル駆動テスト、interface経由のテストダブル、エラーケースのカバー、テストフィクスチャの管理 |
| パフォーマンス | N+1クエリ、不要なアロケーション、DBインデックス、バッチ処理 |
| ADR準拠 | プロジェクトのADRが存在する場合、変更がADRの方針に沿っているか |

## 参考文献

### DDD
- [Domain-Driven Design (Eric Evans)](https://www.domainlanguage.com/ddd/) — 集約、値オブジェクト、ユビキタス言語、境界づけられたコンテキスト
- [Implementing Domain-Driven Design (Vaughn Vernon)](https://www.oreilly.com/library/view/implementing-domain-driven-design/9780133039900/) — 実装パターン、リポジトリ、アプリケーションサービス
- [Domain-Driven Design Reference (Evans)](https://www.domainlanguage.com/ddd/reference/) — 用語定義のクイックリファレンス

### Clean Architecture
- [Clean Architecture (Robert C. Martin)](https://www.oreilly.com/library/view/clean-architecture-a/9780134494272/) — 依存の方向、レイヤー境界
- [The Clean Architecture (blog)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — 概要図

### Go
- [Effective Go](https://go.dev/doc/effective_go) — 言語慣習
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) — レビュー観点
- [Go Wiki: TableDrivenTests](https://go.dev/wiki/TableDrivenTests) — テスト手法
- [Go Concurrency Patterns](https://go.dev/blog/pipelines) — 並行処理
- [Go Proverbs](https://go-proverbs.github.io/) — 設計哲学
