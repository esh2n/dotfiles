---
title: yoki ハーネス
description: Claude Code の設定を Codex / omp にも変換配布する自作ハーネス「yoki」の3層構造とターゲット別パリティ。
---

yoki(良き)は `domains/dev/config/claude-profiles/` にある自分専用の Claude Code
設定パックで、hooks/permissions（ハーネス）・定期実行（ループ）・多エージェント
制御フロー（グラフ）の3つをまとめた呼び名。もとは ECC (Everything Claude Code)
のベンダリングから出発したが、上流追従はやめて独立メンテに切り替えている。

設定は `core → packs → personal` の3層で合成されて `~/.claude` に展開される
（同名衝突・設定キーは常に personal が勝つ）。パックの有効/無効は
`yoki-switch pack enable|disable <name>` で切り替える。

## 3層アーキテクチャ

| 層 | 実体 | 役割 |
|---|---|---|
| Harness | hooks + permissions（settings.\*.json） | 決定論的なガードと観測。git-guard（deny / warn-once / allow の3段階）、quality-gate、audit |
| Loop | `/loop`、cron routine、correction-detect | 時間軸の自動化。是正シグナル駆動の学習 |
| Graph | `core/workflows/` → `~/.claude/workflows/` | 多エージェント制御フローの決定論的スクリプト |

## 3つのターゲット

`~/.claude` は core/packs/personal をそのままマージした結果だが、Codex CLI
（`~/.codex`）と omp（`~/.omp/agent`）は設定フォーマットが別物なので、同じ
3層ソースから**変換して生成**する。生成器は
`runtime/yoki/scripts/lib/targets/{codex,omp}.js`、CLI は `yoki-switch apply`:

```bash
yoki-switch apply                     # claude + codex + omp をすべて再生成
yoki-switch apply --target omp        # omp だけ再生成
yoki-switch apply --target codex --dry-run   # 書き込まず、計画だけ表示
```

各ターゲットの `--out` はそのCLIのホームディレクトリ。ホームディレクトリが
存在しないマシン（そのCLIを一度も使っていない）ではスキップし、ゼロから
作ったりはしない。

生成物のうちホームディレクトリ側にユーザー自身の追記が同居するもの
（`~/.codex/config.toml` の `[projects.*]` など）は、マーカーで区切った
自分のブロックだけを置き換える:

- `config.toml`: `# yoki:begin` 〜 `# yoki:end`
- `AGENTS.md` / `RULES.md`: `<!-- yoki:begin -->` 〜 `<!-- yoki:end -->`
- `hooks.json`: マーカーではなくグループ単位でマージ。yoki以外が追加した
  フックグループはそのまま残す
- スキル/コマンドの symlink は `.yoki/<target>-manifest.json` で自分が
  置いたものだけを記録し、`--prune` 実行時に元ソースが消えたものだけ削除する

マーカーブロックの外は2回目以降の `apply` でもバイト単位で不変。

## 機能パリティ

Claude Code はほぼ全機能をネイティブに持つ基準点。Codex と omp は自前の
拡張ポイント（hooks.json / yoki-bridge.ts）に変換して寄せているが、
一部は harness 側の制約でそもそも移植できない。

| 機能 | Claude Code | Codex | omp |
|---|---|---|---|
| Hooks | ネイティブ（`settings.json`） | `hooks.json`（9イベント、`codex exec` から到達可能な範囲）+ `[hooks.state]` 信頼ハッシュの upsert | `yoki-hooks.json`（7イベント + `tool_approval_requested`）を `yoki-bridge.ts` 拡張が dispatch |
| Permissions | `settings.json` に直接 | `rules/yoki.rules`（execpolicy）+ `config.toml` の `[permissions.yoki*]` | `config.yml` の `tools.approval` / `bash.patterns` |
| Skills | `~/.claude/skills` を直接使用 | `~/.agents/skills/<name>` symlink（`codex/` port を持つものは `~/.codex/skills/<name>`） | `~/.claude/skills` を omp 自身が直接読む（生成物なし） |
| Commands | `~/.claude/commands` を直接使用 | `cmd-<name>` スキルに変換（Codexにスラッシュコマンド形式が無いため） | `~/.claude/commands` を omp 自身が直接読む |
| Agents | `~/.claude/agents` を直接使用 | `agents/*.toml` | `agents/*.md` |
| 指示ファイル | `CLAUDE.md` を直接使用 | `AGENTS.md` マネージドブロック | `~/.claude/CLAUDE.md` を omp 自身が直接読む |
| Rules | `~/.claude/rules` を直接使用 | `AGENTS.md` ブロックに `paths:` frontmatter の無い rule だけ埋め込み | `RULES.md` マネージドブロック（omp は `~/.claude/rules` を読まないため） |
| 通知 | `Notification` hook | `config.toml` の `notify` | `tool_approval_requested`（`permission_prompt` matcher のみ） |
| ステータス行 | `personal/scripts/statusline.sh` | **非対応** — 書き込み先となるstatus line自体が無い | `config.yml` の `statusLine.leftSegments`/`rightSegments` で近似 |
| Workflow（yoki-graph） | ネイティブ Workflow tool（yoki-graph に `claude` backend は無い） | `yoki-graph run --backend codex` | `yoki-graph run --backend omp` |
| Artifact（yoki-artifact） | ネイティブ Artifact tool | `yoki-artifact` CLI（harnessを問わず共通） | `yoki-artifact` CLI（harnessを問わず共通） |
| 定期実行（yoki-loop） | `/loop`（セッション内蔵。yoki-loop に `claude` harness は無い） | `yoki-loop`（launchd/cronから呼ぶ外側のheadlessランナー） | `yoki-loop`（同左） |
| `Interrupt` hook | ネイティブ | `codex >= 0.150.0` のみ（古い場合は警告付きでhooks.jsonから除外） | **非対応** |
| `PermissionRequest` | ネイティブ | イベント自体はあるが **headless の `codex exec` からは届かない**（TUIのみ到達可能） | 相当する `tool_approval_requested` はあるが、**headless（`-p`）にはTTYが無く割り込み系イベントは届かない** |
| プロジェクトローカル設定の自動読み込み | `.claude/settings.json` / `.yoki.json` | `.codex/` は信頼プロンプトを経由（Codex側仕様） | **非対応な前提として扱う** — `.omp/` は omp 18.0.4 で信頼プロンプト無しに自動読み込みされるため、生成器は意図的にプロジェクト直下の `.omp/` へは何も書かない |
| `auto` 承認モードの分類器 | 該当なし | Codexネイティブのポリシーで、yoki hooksからは見えず上書きもできない | 該当なし |

## CLI

| コマンド | 役割 |
|---|---|
| `yoki-switch` | パックの有効/無効切り替えと `~/.claude`/`~/.codex`/`~/.omp/agent` への適用（`apply`）、`doctor` |
| `yoki-graph` | `core/workflows/*.js` を Codex/omp から起動する CLI（`run`/`list`/`status`）。Claude Code内ではネイティブ Workflow tool が引き続き本来の経路 |
| `yoki-loop` | Codex/omp向けの外側headlessランナー（`run`/`install`/`uninstall`/`status`/`list`）。`/loop` に相当するものを持たない両CLI向け |
| `yoki-artifact` | HTML 1枚をharnessを問わず同じ private URL に発行・共有・コメント往復する CLI |

## doctor

`yoki-switch doctor [--json]` は claude/codex/omp/artifact の4ターゲットの
実際の状態を読むだけの診断コマンドで、何も書き込まない。1チェック1行、
`[ok|warn|fail] <target> <check> — <hint>` を出力し、`fail` が1件でもあれば
終了コード1（`warn` は0のまま）。

- **claude**: マージdirシンボリックリンクの解決、`settings.json` のパース、
  参照される hook スクリプトの存在/実行可能性、`.yoki/permissions.json` の有無
- **codex**: `codex --version`（`0.147.0` 未満は fail、`0.150.0` 未満は
  `Interrupt` hook 非対応の warn）、`~/.codex` の有無、`[features] hooks = true`、
  自分が生成した `hooks.json` グループの有無と `[hooks.state]` 信頼ハッシュの
  一致、yoki以外のフォアングループの一覧、`codex execpolicy check` による
  `rules/yoki.rules` の構文チェック、`default_permissions`/`sandbox_mode` の
  トップレベル衝突、`models_cache.json` へのtierモデル実在確認、skills
  symlinkの解決
- **omp**: `omp --version`（`18.0.4` 未満で warn）、拡張シンボリックリンクの
  解決、`config.yml` が symlinkでなく生成済みの実ファイルか、
  `yoki-hooks.json` のパース、`functions.zsh` の `omp()` ラッパーに
  `--no-extensions -e` があるか
- **artifact**: `yoki-artifact` が入っていれば `yoki-artifact doctor` に委譲、
  無ければ1行 `ok` でスキップ
