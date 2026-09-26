---
title: jig ハーネス
description: 一つのソースツリーから Claude Code / Codex / omp / pi / DSH の5ハーネスへ設定を配る生成器「jig」と、そのガード・判断サービス。
---

jig は `harness/` にあるハーネスの生成器とガード。ソースは
`llm/harness/{skills,rules,agents,mcp,policy,scripts,workflows}` の一つの平らな
ツリーで、層もパックも無い。言語ごとの指針は `skills/<lang>-*` の中にあり
（`rules/` に残るのは常時読み込みの `common/`、決定メモ、調査記録だけ）、
skills は判断サービスが選ぶ。yoki(`claude-profiles/` の
3層合成と `yoki-switch`)の後継で、置き換えの経緯と各マイルストーンの詳細は
`harness/jig/README.md` にある。

## 入口

```bash
make up                                    # リンク + 5ハーネスすべてに jig apply --write
make claude                                # ~/.claude だけ (jig apply --target claude --write)
jig apply --target claude|codex|omp|pi|dsh  # dry-run: 計画だけ表示
jig apply --target <x> --write             # 書く
jig codex register [--write]               # Codex の hooks.json にガードを登録
jig retire yoki [--write]                  # yoki が残した成果物を一覧 / 削除
jig box new|list|resume|fetch|rm           # sbx microVM の中でこのリポの clone を動かす
```

`jig` は `harness/bin/jig`(`~/bin` に symlink)の bun ランチャー。
チェックアウトの位置は自分のパスから決めるので環境変数は要らない。

## 生成の原則

- **依存は一方向**: ソース → 出力。出力先を読むのは「jig の管理外のキーを
  持ち越す」「削除されるものを報告する」の2目的だけで、そこから設定値を
  導かない。
- **dry-run が既定**: `--write` を付けるまで何も書かない。
- **管理外は保つ**: `settings.json` の未管理キー、`config.toml` の他のテーブル、
  `mcp.json` の他のエントリはバイト単位で残る。`~/.claude.json` には触れない。

## 5つのターゲット

| ターゲット | 配るもの | 触らないもの |
|---|---|---|
| `claude` (`~/.claude`) | `settings.json` の `hooks` / `permissions` / `sandbox`、`AGENTS.md`(`CLAUDE.md` → `AGENTS.md`)、`skills/` `rules/` `agents/` `scripts/` `workflows/` のリンクディレクトリ。MCP は `claude mcp add` 行を印字するだけ | `~/.claude.json`、他の settings キー |
| `codex` (`~/.codex`) | `AGENTS.md`、`agents/*.toml`(モデルは `agents/models.json`)、`~/.agents/skills` のマウント、`config.toml` の `[mcp_servers.*]` ブロック。ガードは `jig codex register` が `hooks.json` に登録 | ブロック外の `[mcp_servers.*]`(報告のみ)、`~/.codex/skills` |
| `omp` (`~/.omp/agent`) | `agents/*.md`、`mcp.json` の jig エントリ、同じ `~/.agents/skills` マウント、`extensions/jig.ts` → jig の omp 拡張 | `config.yml`(報告のみ) |
| `pi` (`~/.pi/agent`) | `AGENTS.md`(旧 symlink を実ファイルで置換)、pi-mcp-adapter の `~/.config/mcp/mcp.json`、同じ skills マウント | `settings.json` / `models.json` / `extensions/`(home-manager のリンク、`home/shared/harness`) |
| `dsh` (`$DSH_HOME`) | scaffold 済みプロファイルの `cordis.patch.yml` にある jig の MCP 行、`AGENTS.md` | `settings.yaml`、`hooks.claude.json`、ガードプラグイン(`jig setup` の展開コピー) |

各ハーネスの自前のファイルは home-manager がリンクし（`home/shared/harness`）、
そのあと activation の `jig setup` が DSH のプラグインを組み立てて、
`jig apply --target <h> --write` を5つ全部に流す。`make up` 一回で揃うのはこのため。

## ガードと判断

- **ガード**: `llm/harness/policy/guard-rules.json` が唯一のルール源。
  `~/.config/jig/policy` へのリンクを home-manager が張り、
  Claude Code の PreToolUse hook、Codex の hook、omp の `jig.ts`、pi の
  `guard.ts`、DSH の cordis プラグインが同じファイルを読む。
- **判断サービス**: `jig serve`(launchd `com.esh2n.jig-decision`)が loopback で
  判断を返し、各ハーネスは `JIG_DECISION_URL` で問い合わせる。

## yoki からの移行(所有者の一回きりの手順)

1. `jig apply --target claude --write` — `scripts` / `workflows` のリンクを
   yoki-switch の `.<x>-merged` から jig のものに置き換える
2. `jig retire yoki` で一覧を確認し、`jig retire yoki --write` で削除
   (`.<x>-merged`、`.yoki/`、`.claude-packs`、Codex の `# yoki:begin` ブロックと
   hook グループ、omp の `yoki-*.ts` / `RULES.md` / `yoki-hooks.json`、
   Cursor の rules リンク)。証拠に合わないパスは SKIP で止まらない
3. `jig apply --target codex --write` — yoki のブロックが消えると
   `[mcp_servers.*]` の衝突が解ける。Codex が再信頼を求めたら
   `jig codex register --write`
4. `domains/dev/bin/yoki-switch` と `claude-profiles/` のツリーを削除
