---
question: "pstack を丸ごと Claude Code・Codex・pi・omp に入れるとき、公式の入れ方はどれで、既存ハーネスとどう共存または切り替えられるか"
date: 2026-10-17
verdict: "4 つをまとめて面倒を見る公式経路は無い。公式の入れ方は Claude Code だけ（10-16 の PR #637）で、しかも v0.15.25 は名前のバグで看板コマンドが打てない。共通の足場は ~/.agents/skills だけで、Codex はそれをセッション単位で切れず DMI も解釈しない。設定を丸ごと分ける文書化済みの機構は Claude Code の CLAUDE_CONFIG_DIR と omp の --profile。全部載せて共存させた前例は無く、独立した 2 件はどちらもルーターを外した"
unverified:
  - "公式プラグインで /pstack:poteto-mode（ディレクトリ名）が呼べるか、実機未確認"
  - "omp が cursor/plugins のマーケットプレイスを直接読めるか"
  - "omp の --profile が ~/.agents/skills（agents プロバイダ）を隠すか"
  - "npx skills add が automations/ を拾わないこと（README の探索一覧からの推論）"
  - "Claude Code の isolation: worktree が作る worktree の置き場所"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# pstack を丸ごと Claude Code・Codex・pi・omp に入れるとき、公式の入れ方はどれで、既存ハーネスとどう共存または切り替えられるか

調査日: 2026-10-17
固定版: cursor/plugins `101b274dd991f694e1f7024be2157e5f3adf07de`（pstack v0.15.25）、backnotprop/pstack `6f131f1`、michael-denyer/pstack-claude `5bd4529`（v0.9.90）、vercel-labs/skills `13e4063`、oh-my-pi `eb74cf8`、pi `8efd314`

前提: 採用の是非は `2026-10-17-pstack-survey.md` の後に持ち主が裁定済み（全部入れて評価する）。この記録は入れ方と共存だけを扱う。

## 答え

4 つのハーネスをまとめて面倒を見る公式の導入経路は存在しない。Claude Code だけが公式経路を持ち（`claude plugin install pstack@cursor-plugins`、2026-10-16 の PR #637）、Codex 向けは PR #537 が open、pi と omp は本家の README に無い。鏡写しの backnotprop 版は `npx skills add backnotprop/pstack` で `~/.agents/skills` へ入れる形を勧める。

公式経路は v0.15.25 では看板の skill が打てない。生成ツリーの `poteto-mode/SKILL.md` は `name: Poteto Mode` のままで、cursor/plugins #237 のコメントが "the slash menu offers `/pstack:Poteto Mode`, but sending it fails with \"isn't a command here\"" と報告している。修正 PR #619 は open。鏡写し版は `name: poteto-mode` に直してある。

4 つに共通する足場は `~/.agents/skills` だけだが、DMI（`disable-model-invocation`）の扱いが違う。Claude Code・pi・omp は解釈するが Codex は解釈せず（`agents/openai.yaml` が必要で、本家も鏡写し版も 0 個）、Codex に入れると 53 本が暗黙起動の候補になる。Codex は `CODEX_HOME` を替えても `~/.agents/skills` を動かさない。

設定を丸ごと分けるためにベンダーが文書化している機構は、Claude Code の `CLAUDE_CONFIG_DIR`（用途は複数アカウント、ログインも別になる）と omp の `--profile`。pi は `PI_CODING_AGENT_DIR` と `--no-skills`/`--skill` で同じことができる。

共存の前例は「全部は入れない」しか無い。独立した 2 件（productize.life、LeanerCloud/dotclaude）はどちらも `poteto-mode` と `principle-*` を外し、自分の CLAUDE.md をルーターに残した。プロファイルを分けて pstack を使い分けた記録は無い。

jig との干渉は無い。jig は `~/.claude/plugins/` に触れず、`enabledPlugins` を素通しし、自分が張ったリンク以外を消さない。ルーターは `~/.claude/skills` だけを読む（`CLAUDE_CONFIG_DIR` は無視していた。本調査を受けて修正）。guard は pstack の `rm -rf` に ask を出し、`git worktree remove --force`・`bun install`・`gh`・`git fetch` は規則が無く通す。

## 根拠

### Claude Code のプラグイン機構

- 置き場所と名前空間: https://code.claude.com/docs/en/plugins/loading.md "Claude Code copies the plugin into `cache/<marketplace>/<plugin>/<version>/` at install and loads that copy."、 https://code.claude.com/docs/en/skills.md "`my-plugin/skills/review/SKILL.md` → `/my-plugin:review`"。
- DMI の skill は一覧に出ない: 同 skills.md の表 "`disable-model-invocation: true` | Yes | Not on its own | Description not in context, full skill loads when invoked" と "Also prevents the skill from being preloaded into subagents"。
- 有効・無効は永続（`enabledPlugins`）、local > project > user: https://code.claude.com/docs/en/discover-plugins.md 。起動ごとの読み込みは `--plugin-dir`: https://code.claude.com/docs/en/plugins/cli-reference.md "Two `claude` flags load a plugin for one session only, without installing it." / "`--plugin-dir` and skills-directory plugins: the directory loads in place and is never copied."
- プラグインの subagent は `hooks`・`mcpServers`・`permissionMode` を無視: https://code.claude.com/docs/en/sub-agents.md 。pstack の 2 体は `name`・`description`・`is_background` のみで `model:` 無し。
- 生成ツリー（PR #637 本文）: "It adds one line under the title of the 21 skills that use Cursor names" / "The tree is 138 files and 643,022 bytes" / "It leaves out the guide, the README, `pstack/assets`, and `pstack/automations`."。Bun の scripts（`poteto-mode/scripts/`、`show-me-your-work/scripts/log.sh`）は skill の内側なので含まれる。
- `CLAUDE_CONFIG_DIR`: https://code.claude.com/docs/en/env-vars.md "All settings, session history, and plugins are stored under this path."、 https://code.claude.com/docs/en/authentication.md "Each directory has its own settings, session history, and claude.ai login or API key."

### Codex・pi・omp の隔離機構

| ハーネス | 設定を丸ごと分ける文書化済みの方法 | ユーザー AGENTS.md は隠れるか | skill の置き場も動くか |
|---|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | 隠れる（プロジェクトの CLAUDE.md は残る） | 動く。plugin も別 |
| Codex | `--profile`（設定の重ね書きのみ）、`CODEX_HOME` | `CODEX_HOME` なら global AGENTS.md は隠れる | 動かない（`$HOME/.agents/skills`） |
| pi | `PI_CODING_AGENT_DIR`、`--no-skills`/`--skill`/`-nc` | 隠れる（cwd と親のものは残る） | agent dir 内は動く。`~/.agents/skills` は残る |
| omp | `--profile`（"A profile sees only its own OMP config"） | 隠れる | native は動く。`~/.agents/skills` は別トグル（`enableAgentsUser`） |

出典: https://developers.openai.com/codex/skills.md （"`USER` | `$HOME/.agents/skills`"、"Codex supports symlinked skill folders"）、 https://developers.openai.com/codex/config-advanced.md 、pi の `docs/skills.md`・`docs/cli.md`（ https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs ）、omp の `docs/config-usage.md`・`docs/skills.md`（ https://github.com/can1357/oh-my-pi/tree/main/docs ）。

### 鏡写し版と移植の入れ方

- backnotprop/pstack README: "pstack is a folder of plain Agent Skills ... `npx skills add backnotprop/pstack`"。`MIRROR.md`: `upstream` ブランチを手で merge、同期は 2026-10-15 の 1 コミット、本家との差は 30 ファイル。
- vercel-labs/skills（★35,290）の `installer.ts`: 既定は symlink、`-g` の正本は `~/.agents/skills`、**同名は無確認で上書き**（`cleanAndCreateDirectory` が `rm -rf` して作り直す）。報告 https://github.com/vercel-labs/skills/issues/1906 "`skills add` replaces an existing same-name skill without any conflict prompt"。既定でテレメトリ送信（`DISABLE_TELEMETRY=1`）。手元の 109 skill 名と pstack の 54 名の完全一致は 0。
- michael-denyer/pstack-claude README: Claude Code は `/plugin install pstack@pstack-claude`、Codex は `codex plugin add`（"Codex requires the user to trust plugin hooks through `/hooks`"）、pi は `pi install git:github.com/michael-denyer/pstack-claude`。omp は README に無い。SessionStart hook で `<EXTREMELY_IMPORTANT>You have pstack. Invoke the pstack:poteto-mode skill...` を注入。`tools/forks.json` に本家へ提案しない独自改変（worktree-cleanup の `rm -rf` 禁止、autopilot の merge を人へ、4 モデル panel）。同期 1 回で 15 件の衝突を手で解消（CHANGES.md 0.9.86）。
- omp 向け: shrimpwtf/oh-my-pstack（★34、最終 push 2026-09-01）、dsebban/skills（★66、3 skill のみ）。omp は `.claude-plugin/marketplace.json` を読める（ https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md ）が pstack での実証無し。

### 共存の前例

- productize.life https://productize.life/blog/pstack-skills/en : "how and why were renamed to code-how and code-why so they don't steal other skills' triggers" / "in Claude Code it adds a second orchestrator over the workflow you already have, and its second-model steps could not run." / "If you already have a way of working ... take the tools, not the manager."
- LeanerCloud/dotclaude https://github.com/LeanerCloud/dotclaude/blob/main/skills/UPSTREAM.md : "`poteto-mode` (pstack), `using-superpowers`, and gstack's `SKILL.md` all exist to route a request to the right sub-skill. `CLAUDE.md` is this repo's router; a second one competing with it is worse than none." / "`no-comments` strips every comment from a diff. Core Principles keeps the comments that carry a *why*. Direct contradiction, so it stays out" / "Where an upstream instruction collides with `CLAUDE.md`, CLAUDE.md wins."
- プロファイル分離で pstack を使い分けた実践者、`-mode` ラッパー、superpowers や ECC との衝突の一次記録: いずれも見つからなかった。

### Claude Code でのモデル役割

- 適応文書の Models 表: `claude-<family>-<version>-<effort>` → `model: "opus"`＋`effort: "xhigh"`、"A `grok-*`, `gpt-*`, or other non-Claude slug | Omit `model` so the agent runs on the session model, and say so."
- 帰結: `interrogate` の席 B、`arena` の第 2 ランナー、`swarm` の worker はセッションのモデルになり、モデル系統の多様性は出ない。Grok は必須ではなく 1 モデルに縮退する。
- michael-denyer 版は Claude 系 4 モデルの panel で代替（CHANGES.md 0.9.88 "a Claude-only panel gets its diversity from more Claude models"）。公式版にこの仕組みは無い。

### 実行部分のセキュリティ読み

| 場所 | 内容 |
|---|---|
| `poteto-mode/scripts/bootstrap.ts:30-33` | `bun install --frozen-lockfile`（依存は commander 14.0.0、lock で固定）。初回に npm へ接続。自身を再実行 |
| `watch-pr/github.ts` | `gh pr view`・`gh pr checks`・`gh api graphql` の読み取りのみ。書き込み・削除無し。タイムアウト無し |
| `orch/store.ts` | 自分の状態ディレクトリへの書き込みと `gh pr list`・`git rev-parse`。`--force` は自分のロックを奪うだけ |
| `worktree-audit.sh:45,55,58` | ヘッダは read-only だが `git fetch origin` と `gh pr list` を実行。`:114-120` で閉じただけの PR を safe に分類（#470） |
| `playbooks/worktree-cleanup.md:7` | "`git worktree remove --force <path>`. If the dir survives on ignored build artifacts, `rm -rf` it"（#449）。`:10` "This is the one playbook that deletes user state with no code review to catch a slip" |
| `playbooks/opening-a-pr.md:5` | `git fetch && git reset --hard origin/<branch>` |
| `playbooks/autopilot-full.md:12`、`shipping.md:8` | `--force-with-lease`、`gh pr merge <pr> --squash`、auto-merge |
| `skills/make-bot-ui/SKILL.md:89,95` | `curl -fsSL https://tailscale.com/install.sh \| sudo sh`、`sudo tailscale up` |
| `automations/benny` | 実行ファイル無し（Cursor automation の設定）。公式 Claude Code プラグインには含まれない |

### jig 側の挙動（コード調査）

- 管理ディレクトリ（`~/.claude/skills`、`~/.claude/agents`、`~/.agents/skills`）: jig が張ったリンク（`harness/skills/` 配下を指す）以外は `foreign` として報告し触らない（`jig/src/domain/claude/managed-dir.ts`）。jig の計画名と同名の実ディレクトリは `<path>.pre-jig.<stamp>` に退避、削除はしない（`links.ts`）。
- `settings.json`: `hooks`・`permissions.*`・`sandbox`・`statusLine` だけを所有し、`enabledPlugins` ほかは素通し（`settings.ts` の `OWNED_KEYS`）。ユーザーが足した `permissions.allow` は次の apply で消える。plugin 側の hook は plugin ディレクトリにあり settings.json を経由しないので jig は見ない。
- ルーター: `JIG_SKILL_ROOT ?? ~/.claude/skills` を読み、DMI の skill は飛ばす（`infra/skills/catalog.ts`）。`CLAUDE_CONFIG_DIR` を見ていなかった。空白入りの `name` でも落ちない。
- guard（`harness/policy/guard-rules.json`、profile `standard`）: `rm -rf <path>` は `rm-recursive-force` で ask。`git worktree remove --force` は規則無し（`git-force-push` の正規表現は `push` に縛られる）。`bun install`・`git fetch`・`gh pr ...` は規則無し。`git push` は引数に `main`/`master` が語として現れると forbid。Task/Agent ツールは PreToolUse の matcher に無く判定されない。
- `CLAUDE_CONFIG_DIR` は apply の全 Claude 宛先で尊重される（`cli/jig.ts`）が、規則集を部屋ごとに替える口は無かった（`JIG_APPLY_ROOT` で別 checkout を指すのみ）。

## 注意点

- 公式プラグインの `/pstack:poteto-mode`（ディレクトリ名）での呼び出し可否は実機で試していない。docs は frontmatter の `name` が最後の区間を決めると書く。
- omp が cursor/plugins のマーケットプレイスを直接読めるかは理屈のみ。
- omp の `--profile` が `~/.agents/skills` を隠すかは未確認（`enableAgentsUser` を切る必要があると読める）。
- `npx skills add` が `automations/` を拾わないことは README の探索一覧からの推論。
- Codex で `HOME` を替えて skill を分離する公式記述は見つからなかった。
- Reddit・X・HN の個人スレッドには到達していない。
