---
id: "06"
category: ja-doc
reader: このリポジトリのフックを変更しようとする開発者
task: エージェントのフックの決まりを説明する文書（500〜700 字）を書く。
traps: [ゲート, 配線, 家]
must_keep: [フック, PostToolUse, lint]
---

## 事実

1. フックはイベントごとに 1 本、全部で 5 本: PreToolUse（jig の guard）、SessionStart、UserPromptSubmit、PostToolUse、Stop。
2. 編集したファイルは、編集のたびに黙って整形する（Claude Code では PostToolUse）。
3. 型検査と lint は応答の終わりにまとめて走らせる（Claude Code では Stop）。
4. プロジェクトが lefthook.yml か .pre-commit-config.yaml を持つときは、jig の表ではなくそのプロジェクトのフックを、触ったファイルに対して走らせる。
5. 監査・予算・決まった文の差し込み・出力の圧縮のために別のフックを足さない。
6. staticcheck や cargo clippy はフックに入れず、完了と言う前にモデルが自分で走らせる。
