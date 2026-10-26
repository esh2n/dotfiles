# pstackは丸ごと、専用のClaude Codeプロファイルの中で評価する

Status: superseded by 2026-10-18-pstack-shared-skills.md（別の設定ディレクトリと起動コマンドをやめ、4つのハーネスの普段のコマンドで使う形にした。worktreeの強制削除とPRのmergeを止める規則はそちらが引き継ぐ） — accepted — 持ち主の裁定（2026-10-17）。`2026-09-22-skills-add-two-drop-duplicates-move-assets.md`の「外部skillは確認された欠落のあるものだけ」は`harness/skills/`への取り込みについての決定であり、この決定はそれを変えない（pstackは取り込まず、別の部屋で読み込む）。`2026-09-23-language-rules-fold-into-skills.md`の「`rules/`はcommon・decisions・research（とknowledge）だけ」も変えない（プロファイルは`harness/profiles/`にあり`rules/`の下ではない）

rule: pstack is evaluated whole, only inside its own Claude Code configuration directory (`~/.claude-pstack`, rules profile `pstack`, started with `dotctl pstack run` / `claude-pstack`), loaded per session with `--plugin-dir` from a checkout pinned in `harness/profiles/pstack/upstream.json`. Never install pstack into `~/.claude/skills`, `~/.agents/skills` or the default profile, never vendor it into `harness/skills/`, and never adopt a port that ships hooks.

## Problem

pstack（Lauren Tanのエージェント作業パック、`../research/2026-10-17-pstack-survey.md`）を、業界で評価されているものを自分で試す目的で丸ごと入れたい。個別のskillを拾う案は、パック全体を評価する目的に合わないので取らない。

一方で既存のハーネスと4か所で衝突する（`../research/2026-10-17-pstack-install-and-coexistence.md`）。

1. 指示役が二人になる。AGENTS.mdはTDD・code-reviewer必須・grilling既定・委譲の規則で作業の進め方を既に指示しており、pstackの`/poteto-mode`も同じことを自分の流儀でやる。独立に全部試した2件はどちらもこの理由で`poteto-mode`を外した。
2. 54本中53本が`disable-model-invocation: true`で、jigのルーターには見えず、Claude CodeのSkillツールにも拒否される。公式プラグインはv0.15.25で`name: Poteto Mode`のまま看板コマンドが打てない。
3. モデル名を直書きし（GrokとOpus）、tier名で選ぶ`2026-09-27-model-catalog-and-tier-assignment.md`と合わない。移植版はSessionStart hookを足し、`2026-09-22-hooks-five-events.md`と衝突する。
4. `worktree-cleanup` playbookがuntracked・ignoredのファイルを使い捨て扱いして`git worktree remove --force`と`rm -rf`に落ちる（cursor/plugins#449、open）。`2026-09-27-one-worktree-layout.md`はdirtyなworktreeをforce-removeしない。guardにはこの操作の規則が無かった。

共通の足場`~/.agents/skills`に入れる案は、Codexがそれをセッション単位で切れずDMIも解釈しないため、全Codexセッションに53本が常時現れる。

## Decision

1. **部屋を分ける。** Claude Codeの`CLAUDE_CONFIG_DIR=~/.claude-pstack`をpstack専用の設定ディレクトリにする。guard・5本のhook・permissions・skills・agents・MCPはjigが普段どおり配る。ログインはディレクトリごとに別（Claude Codeの仕様）。
2. **規則集だけ替える。** jigにrules profileを足す（`harness/profiles/<name>/rules.json`、`JIG_PROFILE=<name>`で選ぶ）。`pstack`プロファイルは`10-git.md`・`30-security.md`・`40-languages.md`を残し、`20-execution.md`・`50-quality-and-testing.md`・`60-delegation.md`・`70-context.md`と決定の`rule:`行を落とし、代わりに`profiles/pstack/rules/10-pstack.md`（pstackが進め方の主、ただしworktreeのforce-remove・`curl | sudo sh`・PRのmerge・force pushは禁止、`/setup-pstack`は何も書かない、評価ログを`evaluation.tsv`に残す）を描く。プロファイルはファイル名で選ぶだけで、規則の本文は編集しない。
3. **本家を固定して起動ごとに読む。** `harness/profiles/pstack/upstream.json`にcursor/pluginsのコミット（`101b274`、v0.15.25）と、名前のバグの2行修正（#237、PR #619の内容）を書く。`dotctl pstack setup`がそのコミットだけを`~/.local/share/dotctl/pstack/cursor-plugins`に取り、修正を当て、プロファイルへ`jig apply`する。`dotctl pstack run`（alias `claude-pstack`）が`claude --plugin-dir <checkout>/harness/pstack/claude-code`をprofileの環境で起動する。インストールはせず、リポジトリへ複製もしない。本家は毎日書き換わるので、評価期間中はpinを動かさない。
4. **ルーターの根を直す。** jigのskillルーターが`~/.claude/skills`を直書きしていたのを`CLAUDE_CONFIG_DIR`に従わせる。
5. **guardに2規則を足す（持ち主が方針ファイルに書く）。** `git worktree remove --force`と`gh pr merge`をaskにする。前者は決定4の機械検査、後者は「PRは指示なしに作らない」のmerge側。
6. **Codex・pi・ompは第2段。** Claude Codeでの評価の手触りが出てから、ompは`--profile`、piは`--skill <checkout の skill>`で同じ形を足す。Codexは本家にプラグイン対応（PR #537）が入るまで入れない。
7. **評価の期間と問い。** 14日。`~/.claude-pstack/evaluation.tsv`に1 run 1行（日付、選ばれたplaybook、手順に従ったか、検証が実物に当たったか、無しの場合との差を一文）。終わりに「pstackの何を、どのskillから、普段の部屋へ持ち込むか（または何も持ち込まないか）」を新しい決定として書く。

## Alternatives considered

- **`harness/skills/`へ取り込む（vendor）**: 外部skillは確認された欠落のあるものだけという決定と、「参照は参照、複製しない」の規則に反する。54本すべてがDMIでルーターにも見えない。却下。
- **公式プラグインを普段の`~/.claude`にインストール**: 指示役が二人になる問題がそのまま残る。独立した2件が外した構成。`enabledPlugins`の切り替えは永続で、セッション単位にならない。却下。
- **`npx skills add backnotprop/pstack`で`~/.agents/skills`へ**: 4ハーネスに一度で入るが、Codexでは常時オンかつ暗黙起動の候補になり、`skills` CLIは同名を無確認で上書きする（vercel-labs/skills#1906）。却下。
- **michael-denyer/pstack-claude（移植版）**: 名前のバグとDMIを直し、Claude系4モデルのpanelを持つが、SessionStart hookを足し（hook 5本固定と衝突）、本家に提案しない独自改変を15件以上持ち、同期ごとに手で衝突を解消している。評価対象が本家でなくなる。却下。
- **個別のskillだけ（`blast-radius`、`interrogate`）**: 持ち主がパック全体の評価を目的と定めたため対象外。
- **プロファイルを作らずAGENTS.mdを手で差し替える**: jigのmanifestが次のapplyで衝突として止める。規則集を替える口をjigに持たせる方が小さい。却下。

## Consequences

- `harness/profiles/`が増える（`harness/`は種類別の決定に沿う）。jigは`JIG_PROFILE`と`CLAUDE_CONFIG_DIR`の組で第2の部屋を生成できるようになる。
- pstackの部屋では、普段の進め方の規則（TDD・レビュー必須・grilling・委譲）が効かない。これは意図した評価条件で、普段の部屋には何も変わらない。
- Claude Codeでは`/setup-pstack`が何も書かず、Grokの席はセッションのモデルに縮退する。`interrogate`・`arena`の「系統の違うモデルで対抗する」部分は本家の設計どおりには評価できない。評価の記録にこの制約を明記する。
- guardの2規則は持ち主が`harness/policy/guard-rules.json`と`~/.config/jig/policy/`に書く（方針ファイルはエージェントが書けない）。書かれるまで`git worktree remove --force`は素通りする。
- 本家のPR #619（名前）と #449/#470（worktreeの掃除）が入ったら、upstream.jsonのfixesを外しpinを進める。
- 14日後に評価の決定を書く。書かれなければ、この部屋は評価の無い常設になるので、`dotctl records check`と同じ扱いで`make up`が催促する形を後で足す。

## Sources

- `../research/2026-10-17-pstack-survey.md`
- `../research/2026-10-17-pstack-install-and-coexistence.md`
- Claude Codeの文書: https://code.claude.com/docs/en/env-vars.md 、 https://code.claude.com/docs/en/plugins/cli-reference.md 、 https://code.claude.com/docs/en/skills.md
- cursor/plugins: https://github.com/cursor/plugins/pull/637 、 https://github.com/cursor/plugins/issues/237 、 https://github.com/cursor/plugins/pull/619 、 https://github.com/cursor/plugins/issues/449 、 https://github.com/cursor/plugins/issues/527
- 共存の前例: https://productize.life/blog/pstack-skills/en 、 https://github.com/LeanerCloud/dotclaude/blob/main/skills/UPSTREAM.md
