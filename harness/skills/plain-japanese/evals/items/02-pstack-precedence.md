---
id: "02"
category: ja-doc
reader: pstack を使い始めるこのリポジトリの利用者
task: pstack とこのリポジトリの規則がぶつかったときの扱いを説明する文書（600〜900 字）を書く。
traps: [家, 床, 本家]
must_keep: [pstack, AGENTS.md, guard]
---

## 事実

1. pstack は外部の skill パックで、Cursor の書き方で書かれている。
2. pstack の skill で始めた作業では、pstack の手順がこのリポジトリの規則に代わる。
3. 例外は rules/common/80-pstack.md の表に載った 8 行だけで、その行ではこのリポジトリの規則が勝つ。
4. Git・セキュリティ・言語の規則と、sudo や curl からのインストールをしないことは、表の外でも常に適用される。
5. 表の各行は pstack の文面を引用し、引用とファイルを harness/plugins/pstack/precedence.json に記録する。
6. pstack の更新で引用が消えたら、jig apply が警告を出す（apply は止めない）。
7. 機械で判定できる行（worktree の強制削除、PR の merge など）は guard にも入れる。
8. どのハーネスも、同じ種類の層どうしが衝突したときにどちらに従うかを保証しない。
9. 裁定は 2026-10-19。
