# Claude Codeの返答の言語は、Stopの関門が一ターンに一度だけ確かめる

Status: accepted — 持ち主の裁定（2026-11-05）。Stopのhookを一本に保つことは2026-10-23-claude-hooks-six-events.mdのとおりで、この決定はその一本に検査を一つ足す。

rule: When Claude Code's `language` setting names a supported language (Japanese today), jig's one Stop hook also checks every text the model wrote in the owner's current turn — the text between tool calls, read from the transcript, and the final reply, read from `last_assistant_message` — and, when any passage is mostly in another language, blocks the stop once with an English reason that quotes up to ten such passages and asks for a final message that restates them in the set language. It never fires after a hook-forced continuation (`stop_hook_active`), never names a passage the turn's earlier Stop feedback already named, and lets the turn end whenever the setting, the transcript or the reply cannot be read.
scope: repo

## Problem

Claude Codeの設定で返答の言語を日本語にしていても、英語のsubagentの報告や英語の文書を読んだ後に、返答が英語に戻ることが続いた。英語になるのは最後の返答だけではない。tool呼び出しの合間に書く短い文も英語になり、持ち主はそれも読む。モデルは自分の返答の言語を正しく判断できず、日本語で書いたつもりの返答が英語だった例が同じ日に記録に残っている。設定と常時読み込まれる規則の文だけでは防げていないので、機械で確かめる必要がある。

## Decision

- 検査はStopの関門（`jig hooks stop-gate`）の中に足す。新しいhookは登録しない。
- 言語はClaude Codeのユーザー設定（`settings.json`）の`language`から読む。いま判定できるのは日本語だけで、`Japanese`、`ja`、`日本語`を大文字小文字と前後の空白を問わず受け付ける。ほかの値や、値が無い場合は検査しない。
- 対象は持ち主の今のターンにモデルが書いた全部の文である。ターンの始まりは、持ち主の最後の発言とする。tool resultとhookのフィードバック、タスクの通知、ほかのセッションからのメッセージはターンを区切らない。最後の返答は`last_assistant_message`から読む。Claude Codeの文書は、transcriptは非同期に書かれて最後のメッセージがまだ無いことがあるので、Stopのhookでは`last_assistant_message`を使うよう書いている。それより前の文はtranscript（`transcript_path`）から読む。
- 判定は文ごとに行う。fenced code block、inline code、URL、ファイルのパスとファイル名を除いてから、かなと漢字の数とラテン文字の数を数え、かなと漢字の割合が0.2未満なら日本語でないと判定する。数えた文字が20未満の短い文は判定しない。
- 0.2という値は、過去のアシスタントのメッセージ2,382件を数えて決めた。日本語の返答で割合が最も低かったのは、タブ名と製品名を並べた一文の約0.26だった。英語の返答で最も高かったのは、日本語のラベルを一つ引用した一文の約0.11だった。0.2はこの間にある。
- 日本語でない文があれば、一度だけStopを止める。理由の文は英語で書き、日本語でない文を最大10件まで120文字に切って引用し、残りは件数だけを示す。そのうえで、最後のメッセージを日本語で書き、引用した文の内容を日本語で言い直すよう求める。
- 止めるのは一ターンに一度である。`stop_hook_active`が真なら、どの検査が続けさせたかに関係なく、この検査は走らない。バックグラウンドのタスクの通知でモデルがもう一度動いた後のStopでは`stop_hook_active`は偽になるので、同じターンのStopのフィードバックがすでに引用した文は数えない。
- 設定、transcript、返答のどれかが読めない場合と、検査そのものが失敗した場合は止めない。型検査とfindingsの検査の結果は、この検査の失敗に左右されない。

## Alternatives considered

- **最後の返答だけを確かめる**: tool呼び出しの合間に書いた英語の文が残る。持ち主はその文も読むので、足りない。
- **transcriptだけから最後の返答も読む**: transcriptは非同期に書かれ、Stopの時点で一つ前のメッセージで終わっていることがある。文書が`last_assistant_message`を勧めている。却下。
- **バックグラウンドのタスクの通知でもターンを区切る**: 持ち主から見て一続きの返答の途中で、確かめる範囲が切れてしまう。持ち主の発言だけで区切る。
- **言語判定のライブラリ（trigramで判定するfrancなど）を使う**: 判定したいのは日本語かそうでないかの二つだけで、コードと製品名が混じる短い文では文字の種類を数える方が素直に決まる。依存を一つ増やす理由がない。
- **新しいhookを足す、またはPostToolUseで毎回注意の文を差し込む**: hookは六本とする決定（2026-10-23-claude-hooks-six-events.md）に反する。注意の文を差し込んでも、守られなかった返答を止められない。
- **規則の文を強めるだけにする**: 設定と規則の文はすでにあり、それでも英語に戻った。

## Consequences

- tool呼び出しの合間の文を知る出来事はhookに無いので、Claude Codeのtranscriptの形（JSONLの`type`、`isMeta`、`isSidechain`、`origin.kind`、`message.content`）に依存する。2026-10-23-claude-hooks-six-events.mdはsubagentの記録のためにtranscriptを読む案を退けたが、ここでは代わりになる出来事が無い。形が変わって読めない行は飛ばすので、そのときは検査の範囲が最後の返答だけに狭まり、誤って止めることは無い。
- 止めたときは、書き直しのためにモデルが一度余分に動く。
- 言語はユーザー設定からだけ読み、プロジェクトの`.claude/settings.json`や`settings.local.json`の`language`は見ない。
- Claude Codeのhookはこのリポジトリの`jig.ts`をそのまま実行するので、変更は保存した時点で動いているセッションにも効く。`jig apply`は要らない。hookのコマンド行は変わらない。
- 作業中のファイルの書き換えも、その時点で動いているセッションのhookに効く。開発中に、変更途中の状態のせいで英語の返答を見逃したことと、ターンの区切りを外す変異の試験のせいでセッションの最初からの文を133件並べたことが一度ずつあった。変異の試験は、使い捨てのworktreeで行う。

## Sources

- Stopの入力（`last_assistant_message`、`stop_hook_active`、`transcript_path`の注意書き）: https://code.claude.com/docs/en/hooks
- ユーザー設定のファイルと設定の優先順位: https://code.claude.com/docs/en/settings
- 2026-10-23-claude-hooks-six-events.md、2026-09-22-format-on-edit-gate-on-stop.md、2026-09-23-model-facing-english.md
