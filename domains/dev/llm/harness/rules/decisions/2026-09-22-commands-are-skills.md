# スラッシュコマンドの元ディレクトリは作らず、ユーザーが呼ぶものは skill の frontmatter で表す

Status: accepted — 主要ハーネスが commands を skills に統合し、実践者の移行が一年を通して続き、戻した例が無い（2026-09-22）

rule: Do not create a commands/ directory; keep slash commands as skills under skills/ only, using disable-model-invocation: true for user-only commands and user-invocable: false for model-only background skills. Deliver SKILL.md as-is to Claude Code, Codex and omp; reach pi via its skill invocation mode (/skill:name).

## Problem

設定の元に `commands/`（スラッシュコマンド、16 本）を `skills/` と別の種類として持つか。五つのハーネス（Claude Code、Codex、pi、DSH、omp）に配る生成器の元の形を決める。

## Decision

- `commands/` は作らない。元は `skills/` 一本。
- ユーザーが `/name` で呼ぶだけでモデルに勝手に起動させないものは `disable-model-invocation: true`、逆にモデルだけが使う背景知識は `user-invocable: false`。引数は `$ARGUMENTS` と `$0`/`$1`。
- 生成器は Claude Code、Codex、omp に SKILL.md をそのまま配り、pi には skill のユーザー起動（`/skill:name`、引数は `User: <args>` として付く）で届ける。pi の prompt template を別に生成するのは、`${@:N:L}` のような引数スライスが要るものが出たときだけ。
- 既存の 16 本の要否は、この決定とは別に、移行のときに一本ずつ見る。

## Alternatives considered

- **`commands/` を別の種類として残す**: Claude Code の文書は「Custom commands have been merged into skills」「`.claude/commands/deploy.md` と `.claude/skills/deploy/SKILL.md` は同じ `/deploy` を作り同じ動作」「新規は skill を」と明言し、旧形式にしかできることは無い（skills 側には `context: fork`、`` !`cmd` ``、補助ファイルがある）。移行のコミットは 2026-01 から 09-20 まで途切れず、haacked/dotfiles（PR #22、`disable-model-invocation` で「手動だけ」を再現し 5 か月後もさらに移行）、opendatahub-io/ai-helpers（#230、「ベンダーが統合したので分類を 4→3 に」）、vip-pan/speccode（#49、移行だけで一版）、ctoforaday/special-circumstances（visible 12 / hidden 25 を frontmatter の階層で保つ）。「別に保つべき」と主張する実践者は見つからなかった。却下。
- **pi の prompt template を全部に生成する**: pi は `prompts/*.md` と `skills/` を別ディレクトリ・別文書で維持していて（`pi --help` に `--prompt-template` と `--skill` が別 flag）、これは実在する差だが、skill のユーザー起動モードで `/skill:name` が使える。omp（pi の fork）は `--prompt-template` を持たず skills だけ。差が要るのは引数スライスだけなので、必要になったときに限る。
- **Codex の `~/.codex/prompts` に合わせる**: `/prompts:<name>` は残っているが公開コードでの出現は Claude 系の二桁下で、0.114〜0.119 の投資は skills 側。「0.117 でスラッシュコマンド廃止」という以前の記憶は release note に記載が無く未検証。合わせる理由が無い。却下。

## Consequences

- 元の木は `rules/ skills/ agents/ hooks/ mcp/ policy/` で、`commands/` は無い。
- 生成器は skill の frontmatter（`disable-model-invocation`、`user-invocable`）を各ハーネスの形に翻訳する。Codex と omp の対応は生成器の実装時に確認する（Codex は `agents/openai.yaml` の `allow_implicit_invocation`）。DSH は文書に届かず未確認。
- commands と skills の文脈コストを比べた測定はどこにも無い。

## Sources

- `rules/research/2026-09-22-commands-vs-skills.md`
- Claude Code: https://code.claude.com/docs/en/skills.md 、https://code.claude.com/docs/en/slash-commands.md
- Codex: https://learn.chatgpt.com/codex/reference/slash-commands 、https://github.com/openai/codex/releases/tag/rust-v0.117.0
- pi: https://pi.dev/docs/latest/prompt-templates.md 、https://pi.dev/docs/latest/skills.md
- 実践者: https://github.com/haacked/dotfiles/pull/22 、https://github.com/opendatahub-io/ai-helpers/pull/230 、https://github.com/vip-pan/speccode/pull/49 、https://github.com/ctoforaday/special-circumstances
