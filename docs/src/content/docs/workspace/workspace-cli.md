---
title: Workspace CLI (mado)
description: WM + sketchybar + borders をセットで切り替える profile switcher。
---

WM（AeroSpace / Paneru / OmniWM）とsketchybar / bordersを「セット」として
1コマンドで切り替えるCLI。全WMはインストールしたまま、起動状態だけを
切り替える。有効なprofileはmachine-localなstate
（`~/.local/state/mado/`）に記録され、commitされない。

## Profiles

| Profile | WM | sketchybar | borders |
|---------|----|-----------|---------|
| `loop`（default） | Loop（on-demand snapper） | on | on |
| `paneru` | Paneru（sliding tiling） | on | on |
| `aerospace` | AeroSpace（fixed grid） | on | on |
| `omniwm` | OmniWM（内蔵bar / borders） | off | off |
| `none` | なし（素のmacOS） | on | off |

## Commands

| Command | 操作 |
|---------|------|
| `mado` | 対話menu（switch / status / stop / layout / info） |
| `mado use <profile>` | セット切替（冪等。再実行で宣言状態に収束 = restart） |
| `mado use` | 現profileを再適用 |
| `mado use <profile> --dry-run` | 実行せず操作予定を表示 |
| `mado status` | 記録上のprofileと実プロセスの突き合わせ |
| `mado list` | profile一覧 |
| `mado stop` | 全WM + 管理対象serviceを停止 |
| `mado layout` | layoutのsave / restore menu（aerospace限定） |
| `mado info` | window / workspace / monitor情報（aerospace限定） |

`mado layout` / `mado info`は廃止した`ws` CLIから吸収した機能で、
AeroSpace CLIに依存するためaerospace profile稼働中のみ使える。

## Legacy commands

| Command | 操作 |
|---------|------|
| `brdr` / `brds` / `brdk` | Borders restart / start / stop |
| `sbr` / `sbs` / `sbk` | Sketchybar restart / start / stop |
| `wsls` / `wsstart` / `wsrestart` / `wsstop` | madoへのthin wrapper |
