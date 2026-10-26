# google/ax、rulesync、jev（TypeSafeの決定モデルAPI）はjigの設計にどう使えるか

確認日: 2026-09-22

## 答え

三つとも「そのまま採用」は支持されない。google/axはKubernetes規模の分散エージェント実行基盤であり、個人用ハーネスのjigとは前提が違いすぎる。ただし`Workspace`リソースの冪等セットアップ設計（マーカーファイルによる「済んでいれば再実行しない」判定、`git init`→`remote add`→`fetch --depth`→`checkout -f`という非破壊的クローン手順）はjigのbox設計にそのまま転用できる語彙である。rulesyncは55以上のターゲットにrules/hooks/permissions/skillsを描き分ける生成ツールで、コードそのものを取り込む（ライブラリ依存する）べきではないが、その構造——正規の共通集合＋型付きのper-target上書きブロック、`{class, meta}`のファクトリマップとそれを消費する共通のdiff-and-warn関数、複数機能が同じファイルに書き込むときの「宣言された鍵の所有権」パターン——はjigが持つべき設計そのものである。rulesync自身、piとDSHのhooks/permissions/MCP実装はごく薄い（piは`defaultTools`のみ、DSHはゼロ）ため、jigがこの二つのハーネスで実効性のあるガードを持つには、rulesyncから変換できるものはなく自前で実装するしかない。jev（TypeSafeのchoice/score/noul型決定モデル）については、ハーネスの標準スキル一覧を隠してjevだけに選ばせることを裏付ける証拠はどこにもない。実運用に近い例（BuilderIO、Switchboard）はどれもjevを既存の選択経路に「足す」だけで、失敗時は必ず元の経路にフォールバックしている。

## 根拠

- google/axの`Workspace`セットアップは冪等なマーカーファイル判定と非破壊的なgitクローン手順を実装している — `internal/workspace/setup.go`（`gh api repos/google/ax/contents/internal/workspace/setup.go`で直接取得）。予算/承認ポリシー用のフィールドは一度設計されて`reserved "policies"`として撤去済み（`pkg/apis/v1alpha1/ax.proto`）——ガード的な機構は「作ろうとしてやめた」という否定的証拠。
- rulesyncのカバレッジ実測: Claude CodeとCodex CLIはhooks/permissions/MCPとも深い実装があるが、piはpermissionsが`defaultTools`のみでカバレッジなし、DSHはhooks・permissions・MCP・ignoreのいずれも実装が存在しない（`find src/features -iname "pi-*"` / `"dsh-*"`の直接確認）。
- rulesyncには実行時のガード機構が一切ない（純粋なジェネレータで、fail-closedの概念を持たない）——jig自身のガード実装はrulesyncから借用できない。
- jevのvendor資料はchoice質問に255選択肢までの上限があると明記するが、選択の精度・キャリブレーション数値はどこにも公表していない（`docs.typesafe.ai/primitives/choice.md`, `docs.typesafe.ai/confidence.md`）。
- BuilderIO/agent-native（★6,291、merged PR #5361）はjevのランキングを「既存のcurated/tool-search経路に追加」する設計で、APIキー不在・タイムアウト・応答不正時は明示的に旧経路へフォールバックする（"Missing keys and Jev failures preserve the existing curated/tool-search path."）。selectionの正解率は一切測定・公表されていない。
- ハーネスの標準スキル一覧を隠してjevだけに選ばせた場合と、モデルが全スキル説明を自分で読む場合を比較した数値は、ベンダー・独立測定のどちらにも存在しない。

## 注意点

- rulesyncのバージョンは`17.0.0`（2026-09-21時点）、google/axは`v0.3.0`（2026-09-20）で、いずれも活発に更新されているため、上記の実装カバレッジは時点情報であり将来変わりうる。
- google/axを個人用単一ユーザーのコーディングエージェントハーネスとして使っている実例は見つからなかった。
- jevについて「外部の分類器がスキルを選ぶ」対「モデル自身が全スキル説明を読む」を実際のエージェントハーネスのスキルカタログで比較した一次資料は、ベンダー・実践者・測定のどのレンズにも存在しない。ToolSpeederという0スター・未マージのbenchmark（jev 95.8% 対 決定的ローカルベースライン95.0%、レイテンシは約1,400倍）が唯一近い数値だが、来歴が検証できず参考程度に留めるべき。
- rulesyncのコードをそのままvendorする場合はライセンス条件を別途確認する必要がある（本調査では確認していない）。
