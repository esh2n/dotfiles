---
id: "12"
category: ja-chat
reader: 並列の作業を始めようとしている利用者
task: 「並列で作業させるとき、作業用のディレクトリはどこに作ればいい？」という質問への返答を書く。
traps: [レーン, 部下]
must_keep: [worktree, git]
---

## 事実

1. 既定は今のチェックアウトで作業する。触るファイルが重なる並列の作業は、同じファイルを共有せず待つ。
2. 分ける必要があるときは、.claude/worktrees/<name> に、<name> という名前のブランチで worktree を作る。
3. この場所はリポジトリの info/exclude で無視する。
4. .worktreeinclude に書いた、git が無視しているファイルだけを worktree にコピーする。
5. 取り込むかは持ち主が決め、git merge --no-ff <name> のあと git worktree remove と git branch -d で片付ける。
6. 自動では取り込まない。取り込んでいない worktree や変更が残った worktree は強制的に消さない。
