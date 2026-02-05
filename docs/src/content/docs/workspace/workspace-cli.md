---
title: Workspace CLI
description: Sketchybar, Borders, AeroSpace などの workspace service を管理する CLI。
---

workspace 関連の service を管理する CLI tool。

## Interactive mode

| Command | 操作 |
|---------|------|
| `ws` | menu を起動 |
| `ws service` | service 管理 |
| `ws layout` | layout 管理 |
| `ws info` | info 表示 |

## Features

- Service の start / stop / restart
- Window layout の save と restore
- 一般的な setup 向けの preset (Communication layout など)
- Window, workspace, monitor, app の情報表示

## Legacy commands

| Command | 操作 |
|---------|------|
| `brdr` / `brds` / `brdk` | Borders restart / start / stop |
| `sbr` / `sbs` / `sbk` | Sketchybar restart / start / stop |
| `wsls` | 全 service の status 表示 |
| `wsrestart` | すべて restart |
| `wsstart` | すべて start |
| `wsstop` | すべて stop |
