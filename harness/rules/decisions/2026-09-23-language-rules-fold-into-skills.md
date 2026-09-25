# 言語別ルールは言語 skill に畳み、`rules/<lang>/` と `paths:` 配布は使わない

Status: accepted — 複数ハーネスに条件付きルールを届ける業界の型は「共通の器に畳む」で、フックによる自作注入は実地の唯一の報告が失敗（openai/codex #21675: 重複抑止が無く 200KB 超の再注入、#22861: ベンダー上限で切り詰め）。ユーザー全体の規則を常時読み込みの AGENTS.md に載せるのは条件付けの意図に反するので、五ハーネス全部に届く skill を器にする（2026-09-23）

rule: Keep language-specific guidance in the language's skill (`skills/<lang>-*`), never in `rules/<lang>/` or any `paths:`-scoped file; `rules/` holds only `common/` (always-on, rendered into AGENTS.md), `decisions/` and `research/`. Do not build hook-based conditional injection for Codex, omp, pi or DSH, and do not use Claude Code's `paths:` for language rules; skills reach every harness through `~/.agents/skills` and `~/.claude/skills`, and fire through the skill router or the model's own choice.

## Problem

`rules/<lang>/*.md`（12 言語、3,700 行、`paths:` 付き）は Claude Code だけが該当ファイルに触れたとき自動で読み込む。他の四ハーネスには一行も届いていない。持ち主の要件は五ハーネスで品質を揃えること。

## Decision

- 言語別の規則は同じ言語の skill に置く。`rules/<lang>/` は削除。`rules/` に残るのは `common/`・`decisions/`・`research/`。
- Claude Code の `paths:` も言語ルールには使わない（片方だけ別経路を残すと二重管理に戻る。ネイティブの `paths:` 自体が auto mode で無効化される等の脆さを持つ: anthropics/claude-code #93706, #93435, #93249）。
- 09-22 の配置の裁定にある「`paths:` の条件付きルール（Codex・pi・DSH はフックで差し込む）」の一文はこれで上書き。
- 対応する skill が無い言語（TypeScript、C#、Java、Kotlin、Perl、PHP、Swift、Web）は rules の内容から skill を起こす。Go・Python・Rust は既存 skill（`golang-patterns`/`golang-testing`、`python-testing`、`rust-patterns`/`rust-testing`）に足りない規則だけを足す。`hooks.md` 12 本は jig の対応表が代替なので捨てる。

## Alternatives considered

- **各ハーネスに jig が差し込む（自作注入）**: 拡張点は四つとも確認できた（`2026-09-23-path-rule-injection-seams.md`）が、実地でやった唯一の報告が失敗（#21675）。却下。
- **ユーザーの AGENTS.md に削って畳む**: 業界の畳み先に最も近いが、常時読み込みは「触れたときだけ」という条件付けの意図に反する（持ち主「論外」）。却下。
- **Claude Code だけ `paths:` を残す**: 他ハーネスに届かない。却下（持ち主）。
- **プロジェクト内のネスト AGENTS.md**: 業界の型そのものだが、ユーザー全体の規則には合わず、jig はプロジェクトにファイルを書かない。却下。

## Consequences

- 「`.go` に触れた瞬間に効く」保証は無くなり、skill の発火（router の追従率は実測 6%、`2026-09-22-skill-router-6pct.md`）に置き換わる。条件 C の計測（〜10/08）でこの数字を見る。
- 前例なし: 「ルールを skill に畳んだ」実践者の例、三方式のアウトカム比較。
- 生成器: `~/.claude/rules` の言語ディレクトリ配布は不要になる（`rules-dir.ts` は `common/decisions/research` 以外が無ければ何も張らない）。

## Sources

- `rules/research/2026-09-23-cross-harness-conditional-rules-practice.md`（`2026-09-23-path-rule-injection-seams.md`、`2026-09-23-per-language-hooks-and-rule-delivery.md` を前提）
- https://github.com/openai/codex/issues/21675 、https://github.com/openai/codex/issues/22861
- https://learn.chatgpt.com/codex/agent-configuration/agents-md 、https://code.claude.com/docs/en/skills 、https://learn.chatgpt.com/docs/build-skills
