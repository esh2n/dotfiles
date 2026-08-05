---
title: Workspace CLI (mado)
description: WM + sketchybar + borders をセットで切り替える profile switcher。
---

WM（AeroSpace / Paneru / OmniWM）と sketchybar / borders を「セット」として
1 コマンドで切り替える CLI。全 WM はインストールしたまま、起動状態だけを
切り替える。有効な profile は machine-local な state
（`~/.local/state/mado/`）に記録され、commit されない。

## Profiles

| Profile | WM | sketchybar | borders |
|---------|----|-----------|---------|
| `loop`（default） | Loop（on-demand snapper） | on | on |
| `paneru` | Paneru（sliding tiling） | on | on |
| `aerospace` | AeroSpace（fixed grid） | on | on |
| `omniwm` | OmniWM（内蔵 bar / borders） | off | off |
| `none` | なし（素の macOS） | on | off |

## Commands

| Command | 操作 |
|---------|------|
| `mado use <profile>` | セット切替（冪等。再実行で宣言状態に収束 = restart） |
| `mado use` | 現 profile を再適用 |
| `mado use <profile> --dry-run` | 実行せず操作予定を表示 |
| `mado status` | 記録上の profile と実プロセスの突き合わせ |
| `mado list` | profile 一覧 |
| `mado stop` | 全 WM + 管理対象 service を停止 |
| `mado layout` | layout の save / restore menu（aerospace 限定） |
| `mado info` | window / workspace / monitor 情報（aerospace 限定） |

`mado layout` / `mado info` は廃止した `ws` CLI から吸収した機能で、
AeroSpace CLI に依存するため aerospace profile 稼働中のみ使える。

## Legacy commands

| Command | 操作 |
|---------|------|
| `brdr` / `brds` / `brdk` | Borders restart / start / stop |
| `sbr` / `sbs` / `sbk` | Sketchybar restart / start / stop |
| `wsls` / `wsstart` / `wsrestart` / `wsstop` | mado への thin wrapper |
