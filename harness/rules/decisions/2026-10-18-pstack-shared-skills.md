# pstackは4つのハーネスに家のskillと同じ形で配り、最新を追う

Status: accepted — 持ち主の裁定（2026-10-18）。`2026-10-17-pstack-evaluation-profile.md`を置き換える。決定6（住み分け）は2026-10-19-pstack-house-wins-on-conflict.mdに置き換えられた（食い違ったら家が勝つ）

rule: pstack is used from every harness's ordinary command: `harness/plugins/pstack/source.json` names it, `dotctl setup plugins` (run by make up) fetches upstream `main` into `~/.local/share/jig/plugins/pstack`, and jig links its original `pstack/skills` and `pstack/agents` beside the house's, the house winning a shared name. Load the `pstack-adapter` skill before following a pstack skill, keep the pack following `main` unless a `commit` pin is set because the latest broke something, and never copy pstack into this repository, register it as a Claude Code plugin, or start it with a separate command or configuration directory.
scope: repo

## Problem

前回の決定はpstackを評価する目的で、Claude Codeの第2の設定ディレクトリと別の起動コマンド（`claude-pstack`）を作り、Codex・pi・ompは後回しにした。持ち主の目的はpstackを普段の道具として使うことで、評価は今ある計測で足りる。起動コマンドが2つになる形は承認されていない。

求める形は次のとおり。

- 4つのハーネス（Claude Code、Codex、pi、omp）で、普段のコマンドのままpstackを使える
- 版は基本的に最新を使う
- 更新の手間が小さい
- 家のルールとの衝突を抑える

## Decision

1. **元のskillを配る。** 本家cursor/pluginsの`pstack/skills`（54本）と`pstack/agents`（2体）を配る。Claude Code向けの`harness/pstack/claude-code/`は、元のskillの冒頭に「Claude Codeの読み替え表を読め」という1行を足して生成された写しにすぎない。本家の軸はCursorで、Claude Codeも読み替えて使う側にいる。だから4つのハーネスを同じ扱いにする。
2. **家のskillと同じ経路で届ける。** jigが`~/.claude/skills`と`~/.agents/skills`（Codex・pi・ompが読む）に1本ずつリンクし、agentは`~/.claude/agents`とompのagentsディレクトリに置く。家のskillと同じ名前のものがあれば家の方を残し、applyの出力に出す。
3. **最新を追い、固定は逃げ道として残す。** `dotctl setup plugins`が`make up`のたびに`main`を取得し、前回から追加・削除・変更されたskillの名前を出し、取得したコミットを`~/.local/state/jig/plugins.jsonl`に記録する。`source.json`に`commit`を書いたときだけその版で止まる。取得に失敗しても前の版が残り、ハーネスはそのまま動く。jig applyは取得の後に走るようactivationの順を決めた。
4. **読み替えは家のskill 1本で持つ。** `harness/skills/pstack-adapter`が、Cursorの道具名・subagentの項目・モデル名・パス・Cursor専用機能を4つのハーネスの言葉に読み替える。AGENTS.mdには「pstackのskillを使う前に読む」という短い規則だけを置く（`rules/common/80-pstack.md`）。AGENTS.mdは既にCodexの32 KiBを超えているので、表は載せない。
5. **読み替えの漏れを機械で見つける。** 本家のClaude Code用の読み替え表の左列（Cursor側の名前）をjig applyが読み、`source.json`の`translated`に無い名前があれば警告する。
6. **住み分け。** pstackのskillで始めた作業だけ、pstackの手順がTDD・レビュー係・grilling・委譲の家のルールに代わる。Git・セキュリティ・言語の規則、worktreeを強制削除しない、sudoやcurlからの導入をしない、PRをmergeしない、は常に効く。
7. **最新を追うリスクは受け入れ、機械で塞げる経路は塞ぐ。** 本家のmainをレビューなしで取り込むので、乗っ取られた本家や悪意のある変更が、次の`make up`で4つのハーネスのskillに入る。skillの本文はモデルへの指示なので、guardと承認の仕組みだけが最後の壁になる。持ち主はこれを受け入れて最新を選んだ（2026-10-18）。その代わり、次は機械で止める。
   - skills・agentsの中や途中にsymlinkを持つ新版は、取り込みの時点で断り、前の版のままにする（パックの外のファイルを指せるため）。
   - jigは、パックのskillとagentのうち、それ自体がsymlinkのもの、frontmatterに`hooks`か`mcpServers`を持つもの（Claude Codeが登録してしまう）をリンクしない。
   - 取り込みは毎回`checkout -f`と`git clean`で手元を本家のコミットどおりに戻す。
   - pstackに同梱のBunスクリプトは、dotctlもjigも実行しない。走るのはモデルが手順書に従って打ったときだけで、そのときはguardを通る。
8. **評価は計測で済ませる。** skillルーターの記録（`skill-router.jsonl`）に会話のIDと、promptの先頭のスラッシュコマンド（スラッシュの後64文字まで、引数は含めない）を足した。pstackを打った会話と打たない会話を、既存の記録（ツール呼び出し・guardの判定）で比べられる。手書きのログは作らない。tokenと料金が要るならOpenTelemetryを別に決める。

## Alternatives considered

- **Claude Codeはプラグインとして登録し、他はリンク**: 本家がClaude Codeに勧める形で、`/pstack:`の名前空間とClaude Code用の読み替え表が付く。ただ届け方が2通りになり、jigの管理外の`known_marketplaces.json`に登録が残る。Claude Code用の写しと元の差は冒頭の1行だけなので、得るものが小さい。見送り。
- **GitHubのmarketplaceを直接登録して自動更新に任せる**: 他の3つのために手元の取得がどのみち要り、取得元が2つになる。見送り。
- **`harness/skills`に複製する**: 本家の更新が入らなくなる。外部のものを複製しない既存の決定にも反する。却下。
- **版を固定し続ける**: 評価のための固定で、普段使いなら理由が無い。本家は週30コミット前後入るが、壊れたら固定すればよい。見送り。
- **名前のバグの修正を当て続ける**: 本家のmainが2026-10-17に`name: poteto-mode`と`name: make-bot-ui`へ直したので不要になった。

## Consequences

- `claude-pstack`、`dotctl pstack`、jigのrules profile（`JIG_PROFILE`、`harness/profiles/`）、`~/.claude-pstack`は消した。
- Claude Codeでは`/poteto-mode`、piでは`/skill:poteto-mode`、ompでは`/poteto-mode`、Codexではskill名で呼ぶ。`/pstack:`の名前空間は無い。
- Codex・pi・ompでは「人が打たない限り表に出ない」設定（DMI）が効かない前提になる。54本の説明がモデルに見え、モデルが自分から使うことがある。
- pstackのagent 2体はpiとCodexには届かない。playbookはsubagentなしでも進む。
- 本家がCursorの新しい道具を使い始めたら、applyの警告を見て`pstack-adapter`と`translated`を直す。手で持つのはここだけ。
- 本家がCodexなどに公式の形を出したら、この決定を見直す。
- 本家の様子がおかしいときは`source.json`に`commit`を書いて止める。取り込んだコミットは`~/.local/state/jig/plugins.jsonl`に残るので、どの版から変わったかを辿れる。
- guardの2規則（`git worktree remove --force`と`gh pr merge`をaskにする）は前回から引き継ぎ、持ち主が方針ファイルに書く。

## Sources

- `../research/2026-10-17-pstack-survey.md`、`../research/2026-10-17-pstack-install-and-coexistence.md`
- cursor/plugins `harness/pstack/README.md`（「This folder is generated from `pstack/skills` …」）、`pstack/docs/harness/claude-code.md`、コミット`019a6a20592c`（2026-10-17、名前の修正を含む）
- Claude Codeの文書: https://code.claude.com/docs/en/settings-reference.md 、 https://code.claude.com/docs/en/plugins/loading.md 、 https://code.claude.com/docs/en/hooks.md#userpromptsubmit-input
- piのskillの置き場: https://pi.dev/docs/latest/skills.md
