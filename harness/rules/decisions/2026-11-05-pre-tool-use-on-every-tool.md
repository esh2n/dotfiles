# Claude CodeのPreToolUseのhookは、すべてのtoolの呼び出しで走らせる

Status: accepted — 持ち主の裁定（2026-11-05）。2026-11-05-reply-language-check-on-pre-tool-use.mdのConsequencesにある「matcherはここでは変えない」を置き換える。返答の言語の検査の中身と、hookを六本に保つこと（2026-10-23-claude-hooks-six-events.md）は変えない。

rule: Register Claude Code's one PreToolUse hook (the jig guard) with the matcher `*`, so the reply-language check runs before every tool call, Agent, Grep, Glob, Skill, SendMessage and MCP tools included. The guard's rules still judge only the calls `domain/policy/request.ts` maps to a request; for any other tool the hook prints nothing unless the reply-language check denies, exactly as when the hook did not fire. Codex's registration keeps its own narrow matcher.
scope: repo

## Problem

返答の言語の検査（2026-11-05-reply-language-check-on-pre-tool-use.md）は、guardのPreToolUseのhookの中で走る。そのhookのmatcherは`Bash|Read|Write|Edit|MultiEdit|WebFetch`と一部のMCPのtoolだけだった。モデルが英語の文を書いた直後に呼ぶtoolはAgentであることが多く、Agent、Grep、Glob、Skill、SendMessage、ToolSearch、artifactのMCPなどの前では検査が一度も走らなかった。英語の文が持ち主の画面に残り続けるので、検査をすべての呼び出しの前で走らせる必要がある。

## Decision

- `jig/src/domain/claude/hooks.ts`のPreToolUseのmatcherを`*`にする。Claude Codeの文書は、`*`をすべてのtoolに合うmatcherとしている。hookの本数、コマンド行、timeoutは変えない。
- guardの判定は変えない。どのtoolを判定するかは、これまでどおり`domain/policy/request.ts`の`requestFor`が決める。Agent、Grepなど対応する要求の無いtoolは`out-of-scope`として通し、hookは何も出力しない。明示の`allow`を返さないので、Claude Codeの許可の画面と規則はhookが無いときと同じに働く。
- 返答の言語の検査は、guardが通したすべての呼び出しで走る。条件（文の範囲、判定の閾値、一つの文は一度だけdenyすること、subagentを判定しないこと、読めないときは通すこと）は前の決定のとおりである。
- Codexの登録（`cli/jig.ts`の`codexRegistration`）のmatcherは変えない。返答の言語の検査はClaude Codeだけのものだからである。sbxの箱の中のClaude Code（`app/box/kit.ts`）のmatcherも変えない。箱の設定には`language`が無く、検査は走らないからである。

## Alternatives considered

- **新しいPreToolUseのhookを`*`で足し、言語の検査だけをそこで走らせる**: hookは一つの出来事に一本とする決定（2026-10-23-claude-hooks-six-events.md）に反する。guardの判定とaudit logを二本のhookで分けると、同じ呼び出しの記録が二つの場所に分かれる。
- **matcherに検査したいtoolの名前を足していく**: Claude Codeがtoolを足すたびに漏れが生じる。今回の問題はその漏れそのものである。
- **guardの判定を、以前のmatcherに入っていたtoolだけに絞るコードを足す**: `requestFor`がすでに対象外のtoolを判定から外している。同じ一覧を二か所に持つことになる。

## Consequences

- hookがすべてのtoolの呼び出しで一度ずつ起動する。2026-11-05に、guardが判定しないAgentの呼び出しで、hookのプロセス全体の実行時間を20回測った（hyperfine、警告の3回は除く、728 MBのtranscriptの末尾1 MiBを読む）。`language`を設定した場合の中央値は71 ms、設定しない場合は68 msだった。同じ機械で`bun -e 0`だけの起動は平均57 msで、時間の大半はbunの起動である。
- guardのaudit log（`guard-audit.jsonl`）に、Agent、Grepなど判定しないtoolの呼び出しも`source: "out-of-scope"`の行として一行ずつ残る。ログの増え方はtoolの呼び出しの回数に比例する。`jig report guard-coverage`の照合は、記録された呼び出しにaudit logの行が対応するかを見るので、対象外の呼び出しにも行があることで穴とは数えられない。
- MCPのtoolは、名前で`mcp.call`の要求に変わるので、すべてguardの`mcp.call`の規則に当てられる。今の規則でClaude Codeに新しく効くのは`ask-mcp-terraform-mutation`と`ask-mcp-container-use-exec`である。2026-11-05の時点でClaude Codeにはterraformとcontainer-useのサーバーが無いので、許可を求める画面は増えない。それ以外のMCPのtoolは、`mcp`がdenylistのため何も出力せずに通る。
- matcherは`~/.claude/settings.json`に書かれるので、`jig apply --target claude --write`で書き換える必要がある。Claude Codeの文書は、設定ファイルのhookを直接書き換えた場合はファイルの監視が通常は自動で読み込むと書いている。動いているセッションに効かなかった場合は、新しいセッションを始めれば読み込まれる。

## Sources

- hookのmatcherの`*`（"fires on every occurrence of the event"）、PreToolUseの`permissionDecision`、設定ファイルの書き換え（"Direct edits to hooks in settings files are normally picked up automatically by the file watcher."）: https://code.claude.com/docs/en/hooks
- 2026-11-05-reply-language-check-on-pre-tool-use.md、2026-10-23-claude-hooks-six-events.md、2026-09-22-decision-records.md
