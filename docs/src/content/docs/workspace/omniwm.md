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

## Workspaces

バーには「番号 + 絵文字」を併記（displayName で実現、2026-08-19）。

| WS | ラベル | 用途 |
|----|--------|------|
| 1 | 1 💻 | メイン作業 |
| 2 | 2 🌐 | ブラウズ |
| 3 | 3 💬 | コミュニケーション |
| 4 | 4 📝 | メモ・ドキュメント |
| 5 | 5 🎧 | メディア・その他 |
| 6 | 6 ❤️ | （secondary 用途） |
| 7 | 7 🚀 | （secondary 用途） |

## Keybinds（現在の割当）

| 操作 | キー |
|------|------|
| フォーカス移動 | `Opt+矢印`（直前のウィンドウは `Opt+Tab`） |
| ウィンドウ移動 | `Opt+Shift+矢印` |
| workspace 切替 / ウィンドウを送る | `Opt+1-9` / `Opt+Shift+1-9` |
| **workspace をモニターへ移動** | `Ctrl+Cmd+矢印`（セッション限り） |
| モニター間フォーカス | `Ctrl+Cmd+Tab` |
| フルスクリーン（WM 内） | `Opt+Return` |
| カラムを横幅いっぱいに | `Opt+Shift+F` |
| **float ⇔ タイル切替** | `Opt+T` |
| カラムのタブ化 | `Opt+Shift+T` |
| **Scratchpad 呼び出し / 退避** | `Opt+Shift+Space` |
| **Scratchpad に登録** | `Ctrl+Opt+Shift+Space`（フォーカス中のウィンドウ） |
| カラム幅プリセット循環 | `Opt+.` / `Opt+,`（1/3, 1/2, 2/3） |
| 幅 ±10% | `Opt+-` / `Opt+=` |
| カラムのバランス | `Opt+Shift+B` |
| Niri / Dwindle 切替 | `Opt+Shift+L` |
| Quake terminal | `` Opt+` `` |
| Command palette | `Ctrl+Opt+Space` |
| Overview | `Opt+Shift+O` |

## モニター割当の仕組み

`monitorAssignment` は **workspace の必須フィールド**で、「割当なし＝動的」
という状態は存在しない。取りうる値は 3 つ：

- `main` / `secondary` — ヒューリスティック解決。モニター構成が変わると
  意図しない画面に張り付く（3 面構成で secondary が内蔵 Retina に解決した実績あり）
- `specificDisplay` — ディスプレイを UUID で名指し。**接続されていない時は
  最寄りのモニターに自動フォールバック**するので、出先ではノート画面に畳まれる

**推奨は specificDisplay**。GUI の Settings > Workspaces で各 workspace の
ドロップダウンから実ディスプレイ名（例: DELL U2723QE (2)）を選ぶと永続する。
`Ctrl+Cmd+矢印` や `omniwmctl workspace move-to-monitor` による移動は
runtime override で、**再起動で消える**。

## 設定編集の注意 — IMPORTANT

`settings.toml` は OmniWM が所有するファイルで、外部編集には制約がある：

- **稼働中の外部編集は無視される**（「保存で即時反映」は GUI 変更のみ）
- **`mado stop`（強制 kill）直後の編集も消える** — 不正終了と見なされ、
  起動時に内部バックアップから設定ごと復元される
- スキーマ違反（例: `monitorAssignment` の削除）も同様にバックアップ復元が走る

正しい手順：**メニューバーから正常終了（or `osascript -e 'quit app "OmniWM"'`）
→ 編集 → `open -a OmniWM`**。

## 内蔵機能

- **Quake terminal** — libghostty 内蔵。位置・サイズ・ガラス効果を設定可
- **Command palette** — ウィンドウ名の fuzzy 検索でジャンプ
- **Overview** — サムネイル付きウィンドウ一覧
- **Scratchpad** — 任意アプリの一時退避 / 呼び出し（キーは上表）
- **メニューバーアイコン隠し** — Ice / Bartender 相当

## カスタマイズ

設定は `~/.config/omniwm/settings.toml`（`domains/workspace/config/omniwm/`
への symlink）+ GUI Settings。外部編集は上記の手順で。

- 全 hotkey 再割当（Settings > Hotkeys）
- App Rules — float 指定 / workspace 自動割当 / サイズ
  （AeroSpace の `on-window-detected` 相当）
- Workspace bar — 位置・高さ・icon override（`[workspaceBar.iconOverrides]`）
- System Hyper Trigger — Caps Lock や F13-F20 を Hyper キー化
- Mouse & Trackpad — ジェスチャ、スクロール感度

## omniwmctl（自動化）

`general.ipcEnabled = true` 設定済み（変更時は OmniWM 再起動が必要）。

```bash
omniwmctl query workspaces --format table        # workspace とモニターの対応
omniwmctl query displays --format table          # ディスプレイ配置
omniwmctl workspace move-to-monitor 5 right      # workspace をモニターへ移動
omniwmctl command toggle-focused-window-floating # 任意アクションの実行
omniwmctl subscribe                              # イベントストリーム購読
omniwmctl watch active-workspace --exec update-bar.sh   # イベント毎にスクリプト実行
```

`omniwmctl help` でアクション全一覧。`watch` + script で sketchybar 連携も
実装可能（現構成では内蔵バーを使用中）。

## 既知の制限

- Dwindle のグループ / タブ順序は実行時状態のため再起動で復元されない
- キー / CLI での workspace モニター移動は再起動で消える（永続は specificDisplay で）
