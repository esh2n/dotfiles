# main への push を許すリポジトリは、持ち主が policy の脇に置く追跡外の一覧で決める

Status: accepted — 持ち主の裁定（2026-09-24）。Codex の形（持ち主の policy に、main への push を許すリポジトリのパスを書く）を jig に写し、その一覧は commit しない

rule: Never push to main/master; the guard forbids it (`git-push-main-master`) everywhere except in repositories the owner listed in `~/.config/jig/policy/main-push-allowed` — an owner-written, per-machine, never-committed file of path prefixes read through the rule's `unlessCwdIn`. Nothing in a repository, a prompt, or the environment lifts the rule, and a command that reaches into another repository (`git -C`, `--git-dir`, `--work-tree`, `cd` on the same line) is never waived.

## Problem

`rules/common/10-git.md` は「プロジェクトの `.yoki.json` に `allowMainBranchWork: true` があれば main に push 可」と書いていたが、それを読む処理は退役した yoki と共に消え、jig の guard は `git-push-main-master` を全プロファイルで forbid している。main に直接 push するリポジトリもあれば、禁止のままにすべきリポジトリもある。

## Decision

- guard のルールに任意項目 `unlessCwdIn`（forbid / ask のみ）を足す。値は policy の脇に置く一覧ファイルの名前。
- 一覧は `~/.config/jig/policy/<name>`（今は `main-push-allowed`）。一行に一つのパス接頭辞、`~` 可、`#` はコメント。持ち主が手で書く。`policy/` は floor ルールでエージェントが書けない。`~/.config/jig/policy` はリポジトリの `policy/` への symlink なので、`.gitignore` にこのファイルを載せて追跡外を保証する。
- セッションの cwd が接頭辞の下にあるとき、そのルールだけ不活性。監査ログには `waived: [<rule id>]` が残る。
- 免除しない: `-C` / `--git-dir` / `--work-tree` で別リポジトリを指すコマンド、同じ行の `cd` / `pushd`、構文解析が resolve できないコマンド（サブシェル等）。推測で免除しない。
- 読み込みは `src/app/hooks/load-policy.ts` 一本で、Claude Code の CLI フック・DSH ブリッジ・pi・omp の四つが同じ経路。一覧が読めなければ空一覧＝ルールはそのまま（fail-closed）。
- `10-git.md` は「never push to main/master; the guard forbids it except in repositories the owner listed …」に。`.yoki.json` の条項と、リポジトリ直下の `.yoki.json`（追跡外だった）は消す。
- 同じ調査で分かった副次: レビュー agent と css-flow の「`.yoki.json` の `web` ブロック」はプロジェクトの AGENTS.md のプローズを読む形に（業界の実態）。frontend-slides の `.yoki-design/` は `.slide-previews/` に。

## Alternatives considered

- **コミットされる repo ファイル（`.yoki.json` の形）**: GitHub 全体で `allowMainBranchWork` の前例ゼロ。Codex は信頼していないプロジェクトの `.codex/` 層を無視、Claude Code は deny がどの層でも勝つ方向。CVE-2026-21852 はプロジェクト側の値を安全分岐に使う設計が実害になった例。却下。
- **起動時の env（`JIG_ALLOW_MAIN_PUSH=1`）**: 公開実装 3 件（aiops-starter-kit / FailSafe / nightgauge）の収束形で、全ハーネスに届く。だがシェル全体の印で、リポジトリに紐づかず、direnv / mise と衝突し、許していないリポジトリへ漏れる。却下。
- **セッション ID 付きの `/allow-main`**: 前例なし。superpowers の「明示同意」は会話だけで機械的強制がない。却下。
- **push のたびに `ask`**: Claude Code と DSH だけ。Codex / pi / omp は ask を持たず jig が deny に落とす。却下。
- **git remote の owner で判定**: 実物なし。`git remote set-url` を別途塞ぐ必要がある。却下。
- **`git config --local` の印**: `.git/config` への書き込みガードは 6,000★ の destructive_command_guard でも 12 経路中 5 しか塞げない（#457）。file-only agent でも `.git/` 書きでコード実行に至る（falconet #29）。却下。

採った形は Codex の `[projects."<絶対パス>"].trust_level`（ユーザー自身の設定に、リポジトリの絶対パスをキーで一度書く）と、Claude Code の `.claude/settings.local.json`（人間の承認だけが書き、git が見ない）の写し。

## Consequences

- 持ち主の手作業は二つ、一度だけ: `policy/guard-rules.json` の `git-push-main-master` に `"unlessCwdIn": "main-push-allowed"` を足す。`~/.config/jig/policy/main-push-allowed` に許すリポジトリの親ディレクトリを一行書く。
- 他の機械では一覧が無い＝main への push は forbid のまま。機械ごとに書く。
- cwd はハーネスが報告する値（Claude Code / Codex のフック入力 `cwd`、pi / omp / DSH は拡張の文脈）。ハーネスが cwd を送らないセッションは免除されない。
- 監査ログで `waived` を数えれば、免除が効いた回数が測れる。
- 未確認: pi / omp / DSH の実機で cwd が届くことは、テストでは fake で通したのみ。次に各ハーネスで一度 main へ push して確かめる。

## Sources

- CVE-2026-21852（プロジェクト側の値を trust confirmation より前の安全分岐に使い実害になった例）: https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/
- 起動時の env/CLI フラグを決定論的 preflight が読む公開実装（収束形）: https://github.com/Igor-C-Assuncao/aiops-starter-kit 、https://github.com/MythologIQ-Labs-LLC/FailSafe 、https://github.com/nightgauge/nightgauge
- 「明示同意」は会話だけで機械的強制がない例: https://github.com/obra/superpowers/
- https://learn.chatgpt.com/docs/config-file/config-basic （Codex の projects / trust）
- https://code.claude.com/docs/en/settings （`.claude/settings.local.json`）
- https://github.com/Dicklesworthstone/destructive_command_guard/issues/457
- https://github.com/zetlen/falconet/issues/29
