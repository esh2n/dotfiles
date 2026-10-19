# pstack は 4 つのハーネスに家の skill と同じ形で配り、最新を追う

Status: accepted — 持ち主の裁定（2026-10-18）。`2026-10-17-pstack-evaluation-profile.md` を置き換える。決定 6（住み分け）は 2026-10-19-pstack-house-wins-on-conflict.md に置き換えられた（食い違ったら家が勝つ）

rule: pstack is used from every harness's ordinary command: `harness/plugins/pstack/source.json` names it, `dotctl setup plugins` (run by make up) fetches upstream `main` into `~/.local/share/jig/plugins/pstack`, and jig links its original `pstack/skills` and `pstack/agents` beside the house's, the house winning a shared name. Load the `pstack-adapter` skill before following a pstack skill, keep the pack following `main` unless a `commit` pin is set because the latest broke something, and never copy pstack into this repository, register it as a Claude Code plugin, or start it with a separate command or configuration directory.
scope: repo

## Problem

前回の決定は pstack を評価する目的で、Claude Code の第 2 の設定ディレクトリと別の起動コマンド（`claude-pstack`）を作り、Codex・pi・omp は後回しにした。持ち主の目的は pstack を普段の道具として使うことで、評価は今ある計測で足りる。起動コマンドが 2 つになる形は承認されていない。

求める形は次のとおり。

- 4 つのハーネス（Claude Code、Codex、pi、omp）で、普段のコマンドのまま pstack を使える
- 版は基本的に最新を使う
- 更新の手間が小さい
- 家のルールとの衝突を抑える

## Decision

1. **元の skill を配る。** 本家 cursor/plugins の `pstack/skills`（54 本）と `pstack/agents`（2 体）を配る。Claude Code 向けの `harness/pstack/claude-code/` は、元の skill の冒頭に「Claude Code の読み替え表を読め」という 1 行を足して生成された写しにすぎない。本家の軸は Cursor で、Claude Code も読み替えて使う側にいる。だから 4 つのハーネスを同じ扱いにする。
2. **家の skill と同じ経路で届ける。** jig が `~/.claude/skills` と `~/.agents/skills`（Codex・pi・omp が読む）に 1 本ずつリンクし、agent は `~/.claude/agents` と omp の agents ディレクトリに置く。家の skill と同じ名前のものがあれば家の方を残し、apply の出力に出す。
3. **最新を追い、固定は逃げ道として残す。** `dotctl setup plugins` が `make up` のたびに `main` を取得し、前回から追加・削除・変更された skill の名前を出し、取得したコミットを `~/.local/state/jig/plugins.jsonl` に記録する。`source.json` に `commit` を書いたときだけその版で止まる。取得に失敗しても前の版が残り、ハーネスはそのまま動く。jig apply は取得の後に走るよう activation の順を決めた。
4. **読み替えは家の skill 1 本で持つ。** `harness/skills/pstack-adapter` が、Cursor の道具名・subagent の項目・モデル名・パス・Cursor 専用機能を 4 つのハーネスの言葉に読み替える。AGENTS.md には「pstack の skill を使う前に読む」という短い規則だけを置く（`rules/common/80-pstack.md`）。AGENTS.md は既に Codex の 32 KiB を超えているので、表は載せない。
5. **読み替えの漏れを機械で見つける。** 本家の Claude Code 用の読み替え表の左列（Cursor 側の名前）を jig apply が読み、`source.json` の `translated` に無い名前があれば警告する。
6. **住み分け。** pstack の skill で始めた作業だけ、pstack の手順が TDD・レビュー係・grilling・委譲の家のルールに代わる。Git・セキュリティ・言語の規則、worktree を強制削除しない、sudo や curl からの導入をしない、PR を merge しない、は常に効く。
7. **最新を追うリスクは受け入れ、機械で塞げる経路は塞ぐ。** 本家の main をレビューなしで取り込むので、乗っ取られた本家や悪意のある変更が、次の `make up` で 4 つのハーネスの skill に入る。skill の本文はモデルへの指示なので、guard と承認の仕組みだけが最後の壁になる。持ち主はこれを受け入れて最新を選んだ（2026-10-18）。その代わり、次は機械で止める。
   - skills・agents の中や途中に symlink を持つ新版は、取り込みの時点で断り、前の版のままにする（パックの外のファイルを指せるため）。
   - jig は、パックの skill と agent のうち、それ自体が symlink のもの、frontmatter に `hooks` か `mcpServers` を持つもの（Claude Code が登録してしまう）をリンクしない。
   - 取り込みは毎回 `checkout -f` と `git clean` で手元を本家のコミットどおりに戻す。
   - pstack に同梱の Bun スクリプトは、dotctl も jig も実行しない。走るのはモデルが手順書に従って打ったときだけで、そのときは guard を通る。
8. **評価は計測で済ませる。** skill ルーターの記録（`skill-router.jsonl`）に会話の ID と、prompt の先頭のスラッシュコマンド（スラッシュの後 64 文字まで、引数は含めない）を足した。pstack を打った会話と打たない会話を、既存の記録（ツール呼び出し・guard の判定）で比べられる。手書きのログは作らない。token と料金が要るなら OpenTelemetry を別に決める。

## Alternatives considered

- **Claude Code はプラグインとして登録し、他はリンク**: 本家が Claude Code に勧める形で、`/pstack:` の名前空間と Claude Code 用の読み替え表が付く。ただ届け方が 2 通りになり、jig の管理外の `known_marketplaces.json` に登録が残る。Claude Code 用の写しと元の差は冒頭の 1 行だけなので、得るものが小さい。見送り。
- **GitHub の marketplace を直接登録して自動更新に任せる**: 他の 3 つのために手元の取得がどのみち要り、取得元が 2 つになる。見送り。
- **`harness/skills` に複製する**: 本家の更新が入らなくなる。外部のものを複製しない既存の決定にも反する。却下。
- **版を固定し続ける**: 評価のための固定で、普段使いなら理由が無い。本家は週 30 コミット前後入るが、壊れたら固定すればよい。見送り。
- **名前のバグの修正を当て続ける**: 本家の main が 2026-10-17 に `name: poteto-mode` と `name: make-bot-ui` へ直したので不要になった。

## Consequences

- `claude-pstack`、`dotctl pstack`、jig の rules profile（`JIG_PROFILE`、`harness/profiles/`）、`~/.claude-pstack` は消した。
- Claude Code では `/poteto-mode`、pi では `/skill:poteto-mode`、omp では `/poteto-mode`、Codex では skill 名で呼ぶ。`/pstack:` の名前空間は無い。
- Codex・pi・omp では「人が打たない限り表に出ない」設定（DMI）が効かない前提になる。54 本の説明がモデルに見え、モデルが自分から使うことがある。
- pstack の agent 2 体は pi と Codex には届かない。playbook は subagent なしでも進む。
- 本家が Cursor の新しい道具を使い始めたら、apply の警告を見て `pstack-adapter` と `translated` を直す。手で持つのはここだけ。
- 本家が Codex などに公式の形を出したら、この決定を見直す。
- 本家の様子がおかしいときは `source.json` に `commit` を書いて止める。取り込んだコミットは `~/.local/state/jig/plugins.jsonl` に残るので、どの版から変わったかを辿れる。
- guard の 2 規則（`git worktree remove --force` と `gh pr merge` を ask にする）は前回から引き継ぎ、持ち主が方針ファイルに書く。

## Sources

- `../research/2026-10-17-pstack-survey.md`、`../research/2026-10-17-pstack-install-and-coexistence.md`
- cursor/plugins `harness/pstack/README.md`（「This folder is generated from `pstack/skills` …」）、`pstack/docs/harness/claude-code.md`、コミット `019a6a20592c`（2026-10-17、名前の修正を含む）
- Claude Code の文書: https://code.claude.com/docs/en/settings-reference.md 、 https://code.claude.com/docs/en/plugins/loading.md 、 https://code.claude.com/docs/en/hooks.md#userpromptsubmit-input
- pi の skill の置き場: https://pi.dev/docs/latest/skills.md
