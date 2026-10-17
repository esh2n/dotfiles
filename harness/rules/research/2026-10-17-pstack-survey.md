---
question: "pstack（Lauren Tan / poteto のエージェント作業パック）は何で、どう作られていて、何が測られているか"
date: 2026-10-17
verdict: "Cursor 前提の 54 skill・23 playbook・2 subagent のパック。効果を測った数字は本家・移植・第三者のどこにも無く、唯一の定量は一利用者の 45 日分でルーターが開かれた率 19%。既存ハーネスの TDD・検証・レビュー・デバッグ・文章の skill と重なり、grilling 相当は無い"
unverified:
  - "公式 Claude Code プラグイン（PR #637）を実機で動かしていない"
  - "skill を読み込んだときの実トークン費用（48K は byte 数からの推定）"
  - "作者の「週 10,000 回利用」「月 2,000〜2,500 PR」は二次資料のみ"
  - "X の記事・講演動画・daily.dev のコメント・r/cursor は未到達"
  - "日本語の実践記録は redreamality の 1 件のみ、Zenn・Qiita・note は見つからず"
  - "worktree-audit の修正 PR #492 のマージ状態"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# pstack（Lauren Tan / poteto のエージェント作業パック）は何で、どう作られていて、何が測られているか

調査日: 2026-10-17
固定版: cursor/plugins `101b274dd991f694e1f7024be2157e5f3adf07de`（pstack v0.15.25）

## 答え

2026 年に話題の pstack は Lauren Tan（GitHub: poteto）のエージェント作業パックで、Cursor 公式プラグイン集 https://github.com/cursor/plugins/tree/main/pstack に MIT で置かれている。同名の C/C++ の `pstack`（プロセスのスタック表示、peadar/pstack）、PyPI の `pstack`（現 bloomberg/pystack）、no-session/pstack（gstack の派生）とは無関係。

v0.15.25 の中身は skill 54 本（作業用 30 本と `principle-*` 24 本）、`poteto-mode` 内の playbook 23 本、subagent 2 体（`poteto-agent`、`comment-sicko`）、Bun/TypeScript の補助プログラム（`orch`、`watch-pr`、`check-plan.mjs`、`worktree-audit.sh`、`log.sh`）、Cursor 専用の automation パック（benny）。hook と MCP サーバーは無い。54 本中 52〜53 本に `disable-model-invocation: true` が付く。モデルは役割ごとに直書き（既定はコードに `grok-4.7-xhigh-fast`、文章と判断に `claude-opus-5-5-xhigh`）。

設計の芯は「`/poteto-mode` が playbook を 1 つ選び、手順を todo に原文のまま写し、役割ごとのモデルへ委譲し、証拠付きで完了を宣言する」ルーター。作者は README で "personally, i don't believe in planning. the best spec is code." と "`poteto-mode` is my style. you may not want exactly that." を明記している。

効果を測った数字は無い。本家・移植・第三者のどこにも、欠陥率・レビュー品質・token 費用の測定は見つからなかった。唯一の定量は一利用者 45 日分のローカル記録で、Claude Code の主セッション 1,725 件のうちルーター skill が開かれたのは 332 件（19%）、通常の subagent では 4%、`poteto-agent` 型の subagent では 76%。

## 根拠

### ベンダー（作者・リポジトリ）

- 置き場所と規模: `cursor/plugins/pstack`、plugin.json は version 0.15.25・MIT。直近 1 週間（10-10〜10-16）で 30 コミット、skill 本文の書き直し 3 回（#633 "restate four overspecified principles as reasoning, not rules"、#634 "cut marginal sections from four skills"、#637 "install pstack in Claude Code from a generated tree"）。
- 全 SKILL.md の合計 193,258 byte・30,635 語。`poteto-mode` 単体 3,153 語。playbook 23 本 90,193 byte。
- Claude Code への公式経路は 2026-10-16 の PR #637 https://github.com/cursor/plugins/pull/637 で、`harness/pstack/claude-code` に生成した複製（138 ファイル）を配る。適応文書 `pstack/docs/harness/claude-code.md` の原文: "The `Skill` tool refuses most pstack skills." / "`setup-pstack` has nothing to write, so say so and stop. Never put its role lines in `CLAUDE.md` or `AGENTS.md`." / "Automations, Bugbot, Cursor cloud agents, and Cursor's pull request tool have no Claude Code equivalent."
- `poteto-mode/SKILL.md` の frontmatter は `name: Poteto Mode`（空白入り）。`tdd` の本文は "Prefer no new test over a bad test."。`interrogate` は "The adversarial signal comes from model diversity, not assigned personas. ... Do NOT auto-apply changes."。`principle-prove-it-works` は "Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'"。
- `poteto-mode/scripts/bootstrap.ts` は初回に `bun install --frozen-lockfile` を skill ディレクトリ内で走らせる（本家で唯一の暗黙のパッケージ導入）。

### 実践者

- 作者（講演の二次記録 https://redreamality.com/blog/lauren-tan-poteto-trust-before-parallel/ ）: "Throughput comes from trust, not from opening more agents."。月 2,000〜2,500 PR、週約 10,000 回の利用は自己申告。
- Flavio Copes https://flaviocopes.com/pstack/ : "With frontier models on every role, the bill grows fast." / "A one-line fix doesn't need it."。token の数字は無し。
- productize.life https://productize.life/blog/pstack-skills/en （v0.15.15、唯一の独立した導入レビュー）: 51 本中 5 本（how/why を改名、blast-radius、watch-pr、show-me-your-work）を採り 46 本を見送り。原文: "poteto-mode has no step that blocks a merge: its merge rule exists only as text in its playbook." / "Inside poteto-mode, every step, review included, used one model."
- redreamality の日本語ノート https://redreamality.com/ja/garden/notes/pstack-skills-guide/ : 「skill は誘導であって、強制ではない。」「token がかかる。」「これは彼女のスタイルだ。」
- 移植: michael-denyer/pstack-claude（★2,706、Claude Code・Codex・pi・Copilot、SessionStart hook と models.json を独自に追加）、backnotprop/pstack（★2,057、鏡写し、`npx skills add`）、ericlitman/open-pstack（★421）、T3 Code・Codex・omp 向けの小さな移植が 8 件以上。

### 測定

- 一利用者 45 日分のルーター追従率 https://github.com/michael-denyer/pstack-claude/issues/264 : 主セッション 1,725 件中 332 件（19%）でルーターを開く、playbook 60 件（3%）、principle 59 件（3%）。通常 subagent は 4%、`poteto-agent` は 76%。移植の保守者は「今の hook 文面ではない」と反論しており、数値は旧文面のもの。
- 補助プログラムのテスト: productize.life が `bun test orch watch-pr` で 52 pass。cursor/plugins #531 は CI がマニフェストしか検査しないと報告。
- 「pstack あり対なし」の比較は存在しない。

### 否定側

- 名前の規約違反 https://github.com/cursor/plugins/issues/237 （2026-08-21 から open）: `name: Poteto Mode` のため Kiro・pi・T3 Code・Claude Code desktop で読めない／打てない。修正 PR #619 は open。
- DMI の帰結 https://github.com/cursor/plugins/issues/527 : hub から leaf へ辿れず、Claude Code の Skill ツールが拒否する（"Skill <name> cannot be used with Skill tool due to disable-model-invocation"）。
- モデル名の陳腐化 https://github.com/cursor/plugins/issues/335 : 既定スラッグが "Invalid model selection"。5 週間で既定が変わった。
- データ消失の経路 https://github.com/cursor/plugins/issues/449 、 https://github.com/cursor/plugins/issues/470 （どちらも open）: `worktree-cleanup` が untracked・ignored を使い捨て扱いし `git worktree remove --force` と `rm -rf` に落ちる。`worktree-audit.sh` は閉じただけの PR と未 push のコミットを safe に分類し、read-only と書きながら `git fetch` する。
- 本家の破壊的変更（0.15.20 で plugin.json が Agent Plugins v1 形式へ）で APM 経由の導入が壊れた報告（backnotprop #9、人間の確認は無し）。

### 既存ハーネスとの重なり（skill の説明文に基づく）

| 既存の領域 | 重なる pstack の要素 |
|---|---|
| TDD | `tdd`、`principle-test-behavior-not-implementation`、`principle-sequence-verifiable-units` |
| レビューの規律 | `interrogate`、`no-comments`＋`comment-sicko`、`blast-radius`、`principle-minimize-reader-load` |
| 系統的デバッグ | `principle-fix-root-causes`、`principle-attack-the-premise`、bug-fix・forensics・perf-issue の playbook |
| 完了前の検証 | `principle-prove-it-works`（ほぼ一対一）、`principle-explain-the-number`、`create-verification-skill` |
| grilling（設計の詰め） | 相当品無し。`principle-never-block-on-the-human` と「計画を信じない」は逆向き |
| writeup | `technical-writing`、`unslop`、`teach` |
| 言語別レビュアー | `typescript-best-practices` のみ |

## 注意点

- 公式 Claude Code プラグインは実機で動かしていない。適応文書と PR 本文からの読み。
- skill 読み込みの token 費用は byte 数からの推定（全 SKILL.md で約 48K、`poteto-mode` 単体で約 5K）。
- 作者の利用数と PR 数は二次資料のみで、資料間に 2,000 と 2,500 の食い違いがある。
- 日本語の実践記録は 1 件のみ。無いことの証明ではない。
- 「全部入れて使い続けた」記録と「入れて撤退した」記録はどちらも見つからなかった（部分採用の productize.life が最も近い）。
