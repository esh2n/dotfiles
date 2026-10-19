# pstack と家の規則がぶつかる点は、80-pstack.md の短い表で家を勝たせる

Status: superseded — 2026-10-19-pstack-house-wins-on-conflict.md が置き換える。表に無い点を pstack に譲る一文は持ち主が承認した案に無く、承認された「計画を信じない」の行も外していた。表、引用の見張り、guard への写し、重なる原則の扱いは新しい決定に引き継ぐ。もとの裁定は 2026-10-19

rule: In a pstack task, the house wins only where the table in `rules/common/80-pstack.md` says so; outside the table the pstack playbook replaces the house rule it meets, and the git, security and language rules always bind. Each row quotes pstack's text, recorded with its file in `harness/plugins/pstack/precedence.json` so an upgrade that drops the quote is detected; a machine-checkable row also becomes a guard rule, and a principle both sides share is referenced by name, never rewritten in the house.

## Problem

`2026-10-18-pstack-shared-skills.md` の決定 6 は「pstack の skill で始めた作業は、TDD・レビュー係・grilling・委譲について pstack の手順が家の規則に代わる。Git・セキュリティ・言語の規則などは常に効く」とだけ書いた。調べると、pstack の文面が家の規則と逆を言う点がこの区切りに収まらない。

- PR: pstack の `opening-a-pr` は「Open every PR ready, never as a draft」で、全 playbook の最後に PR を開く。家の `10-git.md` は「PR は指示なしに作らない」だった。どちらが勝つかは「git rules」の一括指定からは読めない。
- MCP: `poteto-mode` は「Use any MCP tool. Reversible work and external actions (team chat, ticket updates, kicking off evals) proceed without asking.」で、他人に見える書き込みも聞かずに進める。
- モデル名、止まる条件、worktree の置き方と掃除、merge、名指しされているのに入っていない skill（`deslop`・`control-cli`・`control-ui`・`create-skill`）、pack 自体を直す前提の `reflect`・`correct`・`automate-me`。

どのハーネスも、同じ種類の層どうしが衝突したときにどちらへ従うかを保証しない。Claude Code の文書は「if a user rule and a project rule conflict, Claude may follow either one」と書く。勝つ側は文面で名指しするしかない。

あわせて、家の規則の側にも持ち主の今の方針とずれた行があった。持ち主の裁定（2026-10-19）は次のとおり。

- PR は作ってよい。仕事のリポジトリでは draft が既定で、draft は「まだレビューしないで」の意味。エージェント自身のレビューが済んだら ready にしてよい。持ち主の個人リポジトリでは制限なし（ready の PR も main での作業もよい）。個人リポジトリは、main への push に使っている持ち主の機械ごとの一覧 `~/.config/jig/policy/main-push-allowed` の接頭辞で決める。
- テスト: pstack の「悪いテストを足すくらいなら足さない」に同意する。80% の下限とは衝突しない。
- MCP: 聞かずに使ってよい。他人が見る共有の場への書き込み（Notion への書き込み、チームのチャットへの投稿、チケットの更新など）だけ先に持ち主の確認を取る。

## Decision

1. **表を 1 つだけ置く。** `rules/common/80-pstack.md` に「pstack の文面（短い引用と skill のパス）→ 代わりにすること」の表を置き、表の行だけ家が勝つと 1 文で宣言する。表に無い点は、pstack の作業なら pstack の手順が家の規則に代わる。Git・セキュリティ・言語の規則と、`sudo`・`curl` からの導入をしないことは表の外でも常に効く。
2. **行は裁定後に残った実際の衝突だけ。** 8 行。
   - `pr-readiness`: 個人リポジトリの外では draft で開き、自分のレビュー後に `gh pr ready`。個人リポジトリでは pstack のとおり ready。
   - `outward-writes`: MCP は自由に使う。他人に見える書き込みの前に持ち主に聞く。
   - `model-slugs`: pstack のモデル名は使わず、adapter の Models 節で読み替える。
   - `stop-conditions`: pstack の「Proceed, then present」に加え、採択済みの決定メモや家の常時規則に反する・置き換える変更の前では止まる。それを決めるのは持ち主だけ。
   - `worktrees`: 置き場は `.claude/worktrees/<name>`。掃除は clean で merge 済みのものだけ、`--force` なし、`rm -rf` しない。
   - `merge`: merge と force push はしない。merge-ready で止めて渡す。
   - `missing-skills`: 入っていない 4 つの skill は adapter の代わりの表に従う。
   - `pack-edits`: pack を直接編集しない（更新のたびに戻る）。家の skill・規則に入れる。
3. **詳しい理由と手順は `pstack-adapter` の Overrides 節に置く。** AGENTS.md は全ハーネスが毎回読む常時の層で、Codex は 32 KiB で切る。表は 1 行 1 文に抑え、例や出力先の細目は pstack を使うときだけ読む adapter に置く。`reflect`・`correct`・`automate-me` の出力先（家の skill、`rules/common`、決定メモ、lint、guard の提案）もそこに書く。
4. **各行は pstack の文面を引用し、引用を機械で見張る。** `harness/plugins/pstack/precedence.json` に行の id、pstack のファイル、引用句をそのまま記録する。本家の更新で引用句が消えたら、その行を見直す合図になる。検査は jig apply に後で足す（`translated` の検査と同じ型）。記録したのは 2026-10-19 に `019a6a20592c` で全句の実在を確かめた版。
5. **機械で判定できる行は guard にも入れる。** worktree の強制削除、PR の merge、個人リポジトリの外で `--draft` なしの `gh pr create`、共有サービスへの MCP 書き込みは guard で `ask` にできる。guard の方針ファイルはエージェントが書けないので、規則は持ち主が書く（Consequences）。
6. **重なる原則は書き直さない。** 家と pstack で同じことを言う組（verification-before-completion と principle-prove-it-works、systematic-debugging と principle-fix-root-causes など）は、どちらかを名前で参照し、家の側に言い換えを作らない。家の skill は pstack と同じ名前や `how`・`why`・`tdd`・`swarm` のような短い名前を取らない。
7. **家の規則も裁定に合わせる。** `10-git.md` の「PR は指示なしに作らない」を、個人リポジトリの定義と draft の規則に置き換える。workflow の「delivery mode を選んだときだけ commit か draft PR」は「同じ PR の規則に従い、起動時に指定された形より多くは渡さない」にする。`50-quality-and-testing.md` の「feature branch で開発」は個人リポジトリを除き、80% の下限は「振る舞いのテストで満たし、振る舞いが壊れても通るテストで水増ししない」と書く。

## Alternatives considered

- **今のまま（「pstack の手順が家に代わる」と常に効く 4 項目だけ）**: PR と MCP は家の規則と逆向きのまま、どちらに従うかが読めない。却下。
- **pstack の文面を家で書き換えた写しを持つ（declared fork、t3-pstack・pstack-claude 型）**: 本家の更新を追えるのは保守者がいるときだけで、t3-pstack 自身が「Every upstream change to a forked file needs a person to merge it, so a fork is the last resort」と書く。pstack を複製しない決定（2026-10-18）とも合わない。却下。
- **家の `<name>-mode` skill を作り、pstack の上に家の手順をまとめる（automate-me の公式の口）**: mode skill は人が打ったときだけ効き、常時の層ではない。家の規則は既に `rules/common` と各 skill にあり、同じ指示が 2 層に入る（automate-me 自身が「Reference, don't inline」と警告する）。見送り。
- **表を adapter skill だけに置く**: skill の追従は低い。pstack-claude の 45 日の記録では、主セッションが router を開いたのは 19%。常時読まれる層に置いた規則の方が効くという測定もある（Vercel、ただし課題はフレームワーク知識）。表は AGENTS.md、詳細は adapter に分けた。
- **TDD を衝突として表に載せる**: 裁定でどちらも成り立つと決まった（振る舞いのテストで 80% を満たす）。行は作らず、`50-quality-and-testing.md` の 1 文と adapter の注記にした。
- **grilling と「計画を信じない」を表に載せる**: pstack の作業では pstack の手順が grilling に代わる、は 2026-10-18 から変わらず、表の外の既定どおりで足りる。行は作らない。
- **個人リポジトリを別の印で決める（リポジトリ内のファイル、環境変数、remote の owner）**: `2026-09-24-main-push-allowed-repos-in-owner-policy.md` が同じ理由で退けた。既存の一覧を使う。

## Consequences

- jig apply が `precedence.json` を検査し、本家の更新で消えた引用句と、`verifiedAt` 以降にファイルが変わった行を警告として出す（apply は止めない）。変わった行の一覧には `verifiedAt` のコミットが手元のチェックアウトに要る。`dotctl setup plugins` は depth 1 で取得するので、そのコミットが無いときは「どの行が変わったか不明」と出し、そのコミットを取得するか全行を見直すよう案内する。
- 持ち主が guard の方針ファイルに書く規則（提案。名前は仮）:
  - `ask-git-worktree-remove-force`（`git worktree remove --force` / `-f`）と `ask-gh-pr-merge`（`gh pr merge`）。2026-10-18 から持ち越しの 2 本。
  - `ask-gh-pr-create-ready`: `gh pr create` で `--draft` を含まないもの、`"unlessCwdIn": "main-push-allowed"`。
  - `ask-mcp-shared-write`: Notion・チャット・チケットなど共有サービスへの書き込み系 MCP の呼び出し。どの server と tool 名を対象にするかは、配っている MCP の一覧から持ち主が決める。
- 表は 8 行で、AGENTS.md は少し伸びる。行を足すのは本当の衝突が出たときだけにする。
- 個人リポジトリの判定は持ち主の機械ごとの一覧に依る。一覧の無い機械では、どのリポジトリも仕事のリポジトリとして扱う（draft が既定）。
- 個人リポジトリの中での PR の merge は、この裁定では扱っていない。`merge` の行（merge しない）はどこでも効く。
- `reflect` が受け入れた変更は家の skill か規則に入るので、本家への改善は持ち主が上流の issue にする。

## Sources

- pstack（cursor/plugins、`019a6a20592c`、2026-10-17）: `pstack/skills/poteto-mode/SKILL.md`（Autonomy、Subagents、Shipping）、`pstack/skills/poteto-mode/playbooks/opening-a-pr.md`、`worktree-cleanup.md`、`pstack/skills/principle-never-block-on-the-human/SKILL.md`、`pstack/skills/reflect/SKILL.md`、`pstack/skills/correct/SKILL.md`、`pstack/skills/automate-me/SKILL.md`、`pstack/docs/harness/claude-code.md`、`pstack/README.md`（「not shipped here」の節） — https://github.com/cursor/plugins/tree/main/pstack
- Claude Code の層と衝突: https://code.claude.com/docs/en/memory
- Codex の AGENTS.md の上限: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- 引用句の検査の前例: michael-denyer/pstack-claude の `check-playbooks.mjs` と README — https://github.com/michael-denyer/pstack-claude
- fork を最後の手段とする前例: chhoumann/t3-pstack の CONTRIBUTING.md — https://github.com/chhoumann/t3-pstack
- 指示ファイルを skill に優先させる前例: obra/superpowers の using-superpowers — https://github.com/obra/superpowers
- skill の追従率（観察、一人一台）: https://github.com/michael-denyer/pstack-claude/issues/264
- 常時の層と skill の比較（課題はフレームワーク知識）: https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals
