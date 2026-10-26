---
title: jig ハーネス
description: 一つのソースツリーから Claude Code / Codex / omp / pi / DSH の5ハーネスへ設定を配る生成器「jig」と、そのガード・判断サービス。
---

jigは`harness/`にあるハーネスの生成器とガード。ソースは
`harness/{skills,rules,agents,mcp,policy,scripts,workflows}`の一つの平らな
ツリーで、層もパックも無い。言語ごとの指針は`skills/<lang>-*`の中にあり
（`rules/`に残るのは常時読み込みの`common/`、決定メモ、調査記録、`knowledge/`だけ）、
skillsは判断サービスが選ぶ。退役したyoki(`claude-profiles/`の
3層合成と`yoki-switch`)の後継で、置き換えの経緯と各マイルストーンの詳細は
`harness/jig/README.md`にある。

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

`jig`は`harness/bin/jig`(`~/bin`にsymlink)のbunランチャー。
チェックアウトの位置は自分のパスから決めるので環境変数は要らない。

## 生成の原則

- **依存は一方向**: ソース → 出力。出力先を読むのは「jigの管理外のキーを
  持ち越す」「削除されるものを報告する」の2目的だけで、そこから設定値を
  導かない。
- **dry-runが既定**: `--write`を付けるまで何も書かない。
- **管理外は保つ**: `settings.json`の未管理キー、`config.toml`の他のテーブル、
  `mcp.json`の他のエントリはバイト単位で残る。`~/.claude.json`は`mcpServers`キーだけを書き、他のキーは読んだまま戻す。

## 5つのターゲット

| ターゲット | 配るもの | 触らないもの |
|---|---|---|
| `claude` (`~/.claude`) | `settings.json`の`hooks` / `permissions` / `sandbox`、`AGENTS.md`(`CLAUDE.md` → `AGENTS.md`)、`skills/` `rules/` `agents/` `scripts/` `workflows/`のリンクディレクトリ、`~/.claude.json`の`mcpServers`(jigが書いたものだけ) | `~/.claude.json`の他のキー、他のsettingsキー |
| `codex` (`~/.codex`) | `AGENTS.md`、`agents/*.toml`(モデルは`agents/models.json`)、`~/.agents/skills`のマウント、`config.toml`の`[mcp_servers.*]`ブロック。ガードは`jig codex register`が`hooks.json`に登録 | ブロック外の`[mcp_servers.*]`(報告のみ)、`~/.codex/skills` |
| `omp` (`~/.omp/agent`) | `agents/*.md`、`mcp.json`のjigエントリ、同じ`~/.agents/skills`マウント、`extensions/jig.ts` → jigのomp拡張 | `config.yml`(報告のみ) |
| `pi` (`~/.pi/agent`) | `AGENTS.md`(旧symlinkを実ファイルで置換)、pi-mcp-adapterの`~/.config/mcp/mcp.json`、同じskillsマウント | `settings.json` / `models.json` / `extensions/`(home-managerのリンク、`home/shared/harness`) |
| `dsh` (`$DSH_HOME`) | scaffold済みプロファイルの`cordis.patch.yml`にあるjigのMCP行、`AGENTS.md` | `settings.yaml`、`hooks.claude.json`、ガードプラグイン(`jig setup`の展開コピー) |

各ハーネスの自前のファイルはhome-managerがリンクし（`home/shared/harness`）、
そのあとactivationの`jig setup`がDSHのプラグインを組み立てて、
`jig apply --target <h> --write`を5つ全部に流す。`make up`一回で揃うのはこのため。

## ガードと判断

- **ガード**: `harness/policy/guard-rules.json`が唯一のルール源。
  `~/.config/jig/policy`へのリンクをhome-managerが張り、
  Claude CodeのPreToolUse hook、Codexのhook、ompの`jig.ts`、piの
  `guard.ts`、DSHのcordisプラグインが同じファイルを読む。
- **判断サービス**: `jig serve`(launchd `com.esh2n.jig-decision`)がloopbackで
  判断を返し、各ハーネスは`JIG_DECISION_URL`で問い合わせる。

## yokiからの移行

完了した(834c0d71で`yoki-switch`と`claude-profiles/`を削除)。yokiが残した成果物の一覧と削除には、今も`jig retire yoki [--write]`を使える。
