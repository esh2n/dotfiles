# Claude Codeの返答の言語は、tool呼び出しの前にもguardが確かめる

Status: accepted — 持ち主の裁定（2026-11-05）。2026-11-05-reply-language-check-on-stop.mdに検査を一つ足す。Stopの検査はそのまま残す。PreToolUseのhookを一本に保つことは2026-10-23-claude-hooks-six-events.mdのとおりで、この決定はそのguardの中に検査を一つ足す。

rule: When Claude Code's `language` setting names a supported language (Japanese today), jig's one PreToolUse hook (the guard), after the guard's own rules let a call through, reads the tail of the transcript and judges the text the model wrote since its last tool result (or the owner's message) with the Stop check's detector, threshold and minimum length; when that passage is mostly in another language it denies the call with an English reason that quotes the passage and asks for it to be written again in the set language before the same call is made again. Each passage is denied at most once, tracked by a hash in `$JIG_STATE_DIR/reply-language-denials`. The guard's own deny and ask always stand, a subagent's call is never judged, and the call goes through whenever the setting, the transcript or the record cannot be read.
scope: repo

## Problem

Stopの検査（2026-11-05-reply-language-check-on-stop.md）は、ターンの終わりにしか走らない。tool呼び出しの合間に英語の文が書かれると、その文はターンが終わるまで持ち主の画面に残り、モデルはその後も英語のまま何手も続ける。Stopで止めても、書き直されるのは最後の返答だけである。英語の文が書かれた直後に、次のtool呼び出しの時点で止める仕組みが要る。

## Decision

- 検査はPreToolUseのguard（`jig hooks pre-tool-use`）の中に足す。新しいhookは登録しない。
- guardの規則の判定を先に行う。guardがdenyまたはaskを返した呼び出しには、この検査は走らない。guardが通した呼び出しだけを確かめる。
- 確かめる文は、今のターンでモデルが最後のtool resultの後に書いた文である。最後のtool resultが無ければ、持ち主の最後の発言の後に書いた文とする。hookのフィードバック、タスクの通知、subagentの行（`isSidechain`）は区切りにしない。読み取りには、Stopの検査と同じtranscriptの読み手（`turn-texts.ts`）を使う。
- 判定はStopの検査と同じで、コード、URL、パスを除いてから、かなと漢字の割合が0.2未満なら日本語でないとする。数えた文字が20未満の文は判定しない。
- 日本語でない文があれば、そのtool呼び出しをdenyする。理由の文は英語で書き、文を120文字まで引用し、その文を日本語で書き直してから同じtool呼び出しをやり直すよう求める。理由の先頭には`jig guard (reply language):`を付ける。
- 一つの文は一度だけdenyする。文の鍵は、セッションIDと文のsha256の先頭32桁で、`$JIG_STATE_DIR/reply-language-denials`に最後の500件だけを残す。鍵を書けなかった場合はdenyしない。denyの後、Claude Codeはdenyの理由をtool resultとしてモデルに返すので、次の呼び出しで確かめるのはその後に書かれた文になる。日本語で書き直せば通り、何も書かずにやり直しても通る。transcriptの書き込みが遅れて同じ文がもう一度見えたときは、鍵があるので通る。
- transcriptは末尾の1 MiBだけを読む。末尾が最後のtool resultにも持ち主の発言にも届かない場合は、文の始まりが分からないので判定しない。
- subagentの呼び出し（入力に`agent_id`がある）は判定しない。subagentの文は持ち主の画面に出ず、`transcript_path`は親のセッションのtranscriptを指す。
- 設定、transcript、鍵の記録のどれかが読めない場合と、検査が失敗した場合は、呼び出しを通す。
- Stopの検査は、tool resultの中に`jig guard (reply language):`で始まる理由が引用した文を、すでに名指した文として数えない。guardが止めて書き直された文で、ターンの終わりにもう一度止めないためである。
- Claude Code以外のharness（Codex、DSHなど）では、この検査を渡さない。`language`はClaude Codeの設定だからである。

## Alternatives considered

- **Stopの検査だけで足りるとする**: ターンの終わりまで英語の文が画面に残り、モデルも英語のまま続ける。今回の問題そのものである。
- **新しいPreToolUseのhookを足す**: hookは六本とする決定（2026-10-23-claude-hooks-six-events.md）に反する。guardはすでにすべての対象の呼び出しで走っている。
- **PostToolUseで注意の文を差し込む**: 呼び出しは終わった後で、英語の文は画面に残ったままになる。止められない。
- **denyでなくaskにする**: 持ち主に許可を求める画面が出るだけで、モデルは書き直さない。書き直させたいのはモデルである。
- **英語の文が続く限り毎回denyする**: 書き直せないモデルが同じ呼び出しを繰り返すと、作業が進まなくなる。文ごとに一度に限る。
- **鍵を持たず、transcriptの中の前のdenyの理由と比べる**: transcriptは非同期に書かれ、denyのtool resultがまだ無いことがある。そのときに同じ文を二度止めてしまう。小さな状態ファイルの方が確実である。
- **transcriptを全部読む**: 長いセッションのtranscriptは数百MBになる。guardはすべての呼び出しで走るので、読むのは末尾だけにする。

## Consequences

- guardのmatcher（`Bash|Read|Write|Edit|MultiEdit|WebFetch`と一部のMCPのtool）に入らないtool（Agent、Grep、Glob、Skillなど）の呼び出しの前では、この検査は走らない。matcherを広げると、guardがすべての呼び出しで走ることになるので、ここでは変えない。
- Claude Codeの文書は、transcriptはhookが走った時点でまだ最新のメッセージを含まないことがあると書いている。tool呼び出しの直前の文がまだ書かれていなければ、その呼び出しでは判定されず、Stopの検査が後で拾う。2026-11-05の手元の確認では、tool呼び出しの時点で直前の文とtool_useの行はすでに書かれていた。
- 728 MBのtranscriptで、設定の有無によるhookの実行時間の差は測れる大きさではなかった（10回の中央値で65 msと63 ms）。
- denyされると、モデルは書き直しのために一手余分に動く。
- Claude Codeのhookはこのリポジトリの`jig.ts`をそのまま実行するので、変更は保存した時点で動いているセッションにも効く。`jig apply`は要らない。hookのコマンド行とmatcherは変わらない。変異の試験は、使い捨てのworktreeで行う。

## Sources

- hookの共通の入力（`transcript_path`の注意書き、`agent_id`）、PreToolUseの`permissionDecision`と`permissionDecisionReason`: https://code.claude.com/docs/en/hooks
- 2026-11-05-reply-language-check-on-stop.md、2026-10-23-claude-hooks-six-events.md、2026-09-23-model-facing-english.md
