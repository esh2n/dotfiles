# mainへのpushを許すリポジトリは、持ち主がpolicyの脇に置く追跡外の一覧で決める

Status: accepted — 持ち主の裁定（2026-09-24）。Codexの形（持ち主のpolicyに、mainへのpushを許すリポジトリのパスを書く）をjigに写し、その一覧はcommitしない

rule: Never push to main/master; the guard forbids it (`git-push-main-master`) everywhere except in repositories the owner listed in `~/.config/jig/policy/main-push-allowed` — an owner-written, per-machine, never-committed file of path prefixes read through the rule's `unlessCwdIn`. Nothing in a repository, a prompt, or the environment lifts the rule, and a command that reaches into another repository (`git -C`, `--git-dir`, `--work-tree`, `cd` on the same line) is never waived.

## Problem

`rules/common/10-git.md`は「プロジェクトの`.yoki.json`に`allowMainBranchWork: true`があればmainにpush可」と書いていたが、それを読む処理は退役したyokiと共に消え、jigのguardは`git-push-main-master`を全プロファイルでforbidしている。mainに直接pushするリポジトリもあれば、禁止のままにすべきリポジトリもある。

## Decision

- guardのルールに任意項目`unlessCwdIn`（forbid / askのみ）を足す。値はpolicyの脇に置く一覧ファイルの名前。
- 一覧は`~/.config/jig/policy/<name>`（今は`main-push-allowed`）。一行に一つのパス接頭辞、`~`可、`#`はコメント。持ち主が手で書く。`policy/`はfloorルールでエージェントが書けない。`~/.config/jig/policy`はリポジトリの`policy/`へのsymlinkなので、`.gitignore`にこのファイルを載せて追跡外を保証する。
- セッションのcwdが接頭辞の下にあるとき、そのルールだけ不活性。監査ログには`waived: [<rule id>]`が残る。
- 免除しない: `-C` / `--git-dir` / `--work-tree`で別リポジトリを指すコマンド、同じ行の`cd` / `pushd`、構文解析がresolveできないコマンド（サブシェル等）。推測で免除しない。
- 読み込みは`src/app/hooks/load-policy.ts`一本で、Claude CodeのCLIフック・DSHブリッジ・pi・ompの四つが同じ経路。一覧が読めなければ空一覧＝ルールはそのまま（fail-closed）。
- `10-git.md`は「never push to main/master; the guard forbids it except in repositories the owner listed …」に。`.yoki.json`の条項と、リポジトリ直下の`.yoki.json`（追跡外だった）は消す。
- 同じ調査で分かった副次: レビュー agentとcss-flowの「`.yoki.json`の`web`ブロック」はプロジェクトのAGENTS.mdのプローズを読む形に（業界の実態）。frontend-slidesの`.yoki-design/`は`.slide-previews/`に。

## Alternatives considered

- **コミットされるrepoファイル（`.yoki.json`の形）**: GitHub全体で`allowMainBranchWork`の前例ゼロ。Codexは信頼していないプロジェクトの`.codex/`層を無視、Claude Codeはdenyがどの層でも勝つ方向。CVE-2026-21852はプロジェクト側の値を安全分岐に使う設計が実害になった例。却下。
- **起動時のenv（`JIG_ALLOW_MAIN_PUSH=1`）**: 公開実装3件（aiops-starter-kit / FailSafe / nightgauge）の収束形で、全ハーネスに届く。だがシェル全体の印で、リポジトリに紐づかず、direnv / miseと衝突し、許していないリポジトリへ漏れる。却下。
- **セッションID付きの`/allow-main`**: 前例なし。superpowersの「明示同意」は会話だけで機械的強制がない。却下。
- **pushのたびに`ask`**: Claude CodeとDSHだけ。Codex / pi / ompはaskを持たずjigがdenyに落とす。却下。
- **git remoteのownerで判定**: 実物なし。`git remote set-url`を別途塞ぐ必要がある。却下。
- **`git config --local`の印**: `.git/config`への書き込みガードは6,000★ のdestructive_command_guardでも12経路中5しか塞げない（#457）。file-only agentでも`.git/`書きでコード実行に至る（falconet #29）。却下。

採った形はCodexの`[projects."<絶対パス>"].trust_level`（ユーザー自身の設定に、リポジトリの絶対パスをキーで一度書く）と、Claude Codeの`.claude/settings.local.json`（人間の承認だけが書き、gitが見ない）の写し。

## Consequences

- 持ち主の手作業は二つ、一度だけ: `policy/guard-rules.json`の`git-push-main-master`に`"unlessCwdIn": "main-push-allowed"`を足す。`~/.config/jig/policy/main-push-allowed`に許すリポジトリの親ディレクトリを一行書く。
- 他の機械では一覧が無い＝mainへのpushはforbidのまま。機械ごとに書く。
- cwdはハーネスが報告する値（Claude Code / Codexのフック入力`cwd`、pi / omp / DSHは拡張の文脈）。ハーネスがcwdを送らないセッションは免除されない。
- 監査ログで`waived`を数えれば、免除が効いた回数が測れる。
- 未確認: pi / omp / DSHの実機でcwdが届くことは、テストではfakeで通したのみ。次に各ハーネスで一度mainへpushして確かめる。

## Sources

- CVE-2026-21852（プロジェクト側の値をtrust confirmationより前の安全分岐に使い実害になった例）: https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/
- 起動時のenv/CLIフラグを決定論的preflightが読む公開実装（収束形）: https://github.com/Igor-C-Assuncao/aiops-starter-kit 、https://github.com/MythologIQ-Labs-LLC/FailSafe 、https://github.com/nightgauge/nightgauge
- 「明示同意」は会話だけで機械的強制がない例: https://github.com/obra/superpowers/
- https://learn.chatgpt.com/docs/config-file/config-basic （Codexのprojects / trust）
- https://code.claude.com/docs/en/settings （`.claude/settings.local.json`）
- https://github.com/Dicklesworthstone/destructive_command_guard/issues/457
- https://github.com/zetlen/falconet/issues/29
