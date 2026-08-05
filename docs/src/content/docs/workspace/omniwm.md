---
title: OmniWM
description: Niri/Hyprland インスパイアの tiling WM。内蔵バー・quake terminal・omniwmctl 自動化。
---

Niri/Hyprland インスパイアの tiling window manager
（[BarutSRB/OmniWM](https://github.com/BarutSRB/OmniWM)）。
developer signed + notarized で SIP 無効化は不要。macOS 26 (Tahoe) +
Apple Silicon 必須、「ディスプレイごとに個別の操作スペース」ON が前提。

## 起動 / 終了

```bash
mado use omniwm   # 起動（sketchybar / borders は停止 — OmniWM 内蔵のものを使う）
mado use loop     # いつもの環境に戻る
```

初回起動時に Accessibility 許可が必要。

## レイアウトの考え方

縦カラムが横方向の無限ストリップに並ぶ Niri 方式（Paneru と同じ発想 —
ウィンドウを増やしても既存ウィンドウは縮まない）。workspace ごとに
Niri（scrolling columns）と Dwindle（BSP）を `Opt+Shift+L` で切替できる。

## Keybinds（upstream デフォルト）

alt-hjkl への再割当は settings.toml 生成後に実施予定。

| 操作 | キー |
|------|------|
| フォーカス移動 | `Opt+矢印` |
| ウィンドウ移動 | `Opt+Shift+矢印` |
| workspace 1-9 | `Opt+1-9` |
| フルスクリーン | `Opt+Return` |
| カラムのバランス | `Opt+Shift+B` |
| Niri / Dwindle 切替 | `Opt+Shift+L` |
| Quake terminal | `` Opt+` `` |
| Command palette | `Ctrl+Opt+Space` |
| Overview | `Opt+Shift+O` |

## 内蔵機能

- **Quake terminal** — libghostty 内蔵。位置・サイズ・ガラス効果を設定可
- **Command palette** — ウィンドウ名の fuzzy 検索でジャンプ
- **Overview** — サムネイル付きウィンドウ一覧
- **Scratchpad** — 任意アプリの一時退避 / 呼び出し
- **メニューバーアイコン隠し** — Ice / Bartender 相当

## カスタマイズ

設定は `~/.config/omniwm/settings.toml`（`domains/workspace/config/omniwm/`
への symlink、初回起動で生成、保存で即時反映）+ GUI Settings。

- 全 hotkey 再割当（Settings > Hotkeys）
- App Rules — float 指定 / workspace 自動割当 / サイズ
  （AeroSpace の `on-window-detected` 相当）
- Workspace bar — 位置・高さ・icon override（`[workspaceBar.iconOverrides]`）
- System Hyper Trigger — Caps Lock や F13-F20 を Hyper キー化
- Mouse & Trackpad — ジェスチャ、スクロール感度

## omniwmctl（自動化）

```bash
omniwmctl query workspaces            # 状態を JSON で取得
omniwmctl subscribe                   # イベントストリーム購読
omniwmctl watch active-workspace --exec update-bar.sh   # イベント毎にスクリプト実行
```

`watch` + script で sketchybar 連携も実装可能（現構成では内蔵バーを使用中）。

## 既知の制限

- Dwindle のグループ / タブ順序は実行時状態のため再起動で復元されない
