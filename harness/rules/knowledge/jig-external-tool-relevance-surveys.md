# google/ax、rulesync、jev（TypeSafe の決定モデル API）は jig の設計にどう使えるか

確認日: 2026-09-22

## 答え

三つとも「そのまま採用」は支持されない。google/ax は Kubernetes 規模の分散エージェント実行基盤であり、個人用ハーネスの jig とは前提が違いすぎる。ただし `Workspace` リソースの冪等セットアップ設計（マーカーファイルによる「済んでいれば再実行しない」判定、`git init`→`remote add`→`fetch --depth`→`checkout -f` という非破壊的クローン手順）は jig の box 設計にそのまま転用できる語彙である。rulesync は 55 以上のターゲットに rules/hooks/permissions/skills を描き分ける生成ツールで、コードそのものを取り込む（ライブラリ依存する）べきではないが、その構造——正規の共通集合＋型付きの per-target 上書きブロック、`{class, meta}` のファクトリマップとそれを消費する共通の diff-and-warn 関数、複数機能が同じファイルに書き込むときの「宣言された鍵の所有権」パターン——は jig が持つべき設計そのものである。rulesync 自身、pi と DSH の hooks/permissions/MCP 実装はごく薄い（pi は `defaultTools` のみ、DSH はゼロ）ため、jig がこの二つのハーネスで実効性のあるガードを持つには、rulesync から変換できるものはなく自前で実装するしかない。jev（TypeSafe の choice/score/noul 型決定モデル）については、ハーネスの標準スキル一覧を隠して jev だけに選ばせることを裏付ける証拠はどこにもない。実運用に近い例（BuilderIO、Switchboard）はどれも jev を既存の選択経路に「足す」だけで、失敗時は必ず元の経路にフォールバックしている。

## 根拠

- google/ax の `Workspace` セットアップは冪等なマーカーファイル判定と非破壊的な git クローン手順を実装している — `internal/workspace/setup.go`（`gh api repos/google/ax/contents/internal/workspace/setup.go` で直接取得）。予算/承認ポリシー用のフィールドは一度設計されて `reserved "policies"` として撤去済み（`pkg/apis/v1alpha1/ax.proto`）——ガード的な機構は「作ろうとしてやめた」という否定的証拠。
- rulesync のカバレッジ実測: Claude Code と Codex CLI は hooks/permissions/MCP とも深い実装があるが、pi は permissions が `defaultTools` のみでカバレッジなし、DSH は hooks・permissions・MCP・ignore のいずれも実装が存在しない（`find src/features -iname "pi-*"` / `"dsh-*"` の直接確認）。
- rulesync には実行時のガード機構が一切ない（純粋なジェネレータで、fail-closed の概念を持たない）——jig 自身のガード実装は rulesync から借用できない。
- jev の vendor 資料は choice 質問に 255 選択肢までの上限があると明記するが、選択の精度・キャリブレーション数値はどこにも公表していない（`docs.typesafe.ai/primitives/choice.md`, `docs.typesafe.ai/confidence.md`）。
- BuilderIO/agent-native（★6,291、merged PR #5361）は jev のランキングを「既存の curated/tool-search 経路に追加」する設計で、API キー不在・タイムアウト・応答不正時は明示的に旧経路へフォールバックする（"Missing keys and Jev failures preserve the existing curated/tool-search path."）。selection の正解率は一切測定・公表されていない。
- ハーネスの標準スキル一覧を隠して jev だけに選ばせた場合と、モデルが全スキル説明を自分で読む場合を比較した数値は、ベンダー・独立測定のどちらにも存在しない。

## 注意点

- rulesync のバージョンは `17.0.0`（2026-09-21 時点）、google/ax は `v0.3.0`（2026-09-20）で、いずれも活発に更新されているため、上記の実装カバレッジは時点情報であり将来変わりうる。
- google/ax を個人用単一ユーザーのコーディングエージェントハーネスとして使っている実例は見つからなかった。
- jev について「外部の分類器がスキルを選ぶ」対「モデル自身が全スキル説明を読む」を実際のエージェントハーネスのスキルカタログで比較した一次資料は、ベンダー・実践者・測定のどのレンズにも存在しない。ToolSpeeder という 0 スター・未マージの benchmark（jev 95.8% 対 決定的ローカルベースライン 95.0%、レイテンシは約1,400倍）が唯一近い数値だが、来歴が検証できず参考程度に留めるべき。
- rulesync のコードをそのまま vendor する場合はライセンス条件を別途確認する必要がある（本調査では確認していない）。
