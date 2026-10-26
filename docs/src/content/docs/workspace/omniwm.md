---
title: OmniWM
description: Niri/Hyprland インスパイアの tiling WM。内蔵バー・quake terminal・omniwmctl 自動化。
---

Niri/Hyprlandインスパイアのtiling window manager
（[BarutSRB/OmniWM](https://github.com/BarutSRB/OmniWM)）。
developer signed + notarizedでSIP無効化は不要。macOS 26 (Tahoe) +
Apple Silicon必須、「ディスプレイごとに個別の操作スペース」ONが前提。

## 起動 / 終了

```bash
mado use omniwm   # 起動（sketchybar / borders は停止 — OmniWM 内蔵のものを使う）
mado use loop     # いつもの環境に戻る
```

初回起動時にAccessibility許可が必要。

## レイアウトの考え方

縦カラムが横方向の無限ストリップに並ぶNiri方式（Paneruと同じ発想 —
ウィンドウを増やしても既存ウィンドウは縮まない）。workspaceごとに
Niri（scrolling columns）とDwindle（BSP）を`Opt+Shift+L`で切替できる。

## Workspaces

バーには「番号 + 絵文字」を併記（displayNameで実現、2026-08-19）。

| WS | ラベル | 用途 |
|----|--------|------|
| 1 | 1 💻 | メイン作業 |
| 2 | 2 🌐 | ブラウズ |
| 3 | 3 💬 | コミュニケーション |
| 4 | 4 📝 | メモ・ドキュメント |
| 5 | 5 🎧 | メディア・その他 |
| 6 | 6 ❤️ | （secondary用途） |
| 7 | 7 🚀 | （secondary用途） |

## Keybinds（現在の割当）

| 操作 | キー |
|------|------|
| フォーカス移動 | `Opt+矢印`（直前のウィンドウは`Opt+Tab`） |
| ウィンドウ移動 | `Opt+Shift+矢印` |
| workspace切替 / ウィンドウを送る | `Opt+1-9` / `Opt+Shift+1-9` |
| **workspaceをモニターへ移動** | `Ctrl+Cmd+矢印`（セッション限り） |
| モニター間フォーカス | `Ctrl+Cmd+Tab` |
| フルスクリーン（WM内） | `Opt+Return` |
| カラムを横幅いっぱいに | `Opt+Shift+F` |
| **float ⇔ タイル切替** | `Opt+T` |
| カラムのタブ化 | `Opt+Shift+T` |
| **Scratchpad呼び出し / 退避** | `Opt+Shift+Space` |
| **Scratchpadに登録** | `Ctrl+Opt+Shift+Space`（フォーカス中のウィンドウ） |
| カラム幅プリセット循環 | `Opt+.` / `Opt+,`（1/3, 1/2, 2/3） |
| 幅 ±10% | `Opt+-` / `Opt+=` |
| カラムのバランス | `Opt+Shift+B` |
| Niri / Dwindle切替 | `Opt+Shift+L` |
| Quake terminal | `` Opt+` `` |
| Command palette | `Ctrl+Opt+Space` |
| Overview | `Opt+Shift+O` |

## モニター割当の仕組み

`monitorAssignment`は **workspaceの必須フィールド**で、「割当なし＝動的」
という状態は存在しない。取りうる値は3つ：

- `main` / `secondary` — ヒューリスティック解決。モニター構成が変わると
  意図しない画面に張り付く（3面構成でsecondaryが内蔵Retinaに解決した実績あり）
- `specificDisplay` — ディスプレイをUUIDで名指し。**接続されていない時は
  最寄りのモニターに自動フォールバック**するので、出先ではノート画面に畳まれる

**推奨はspecificDisplay**。GUIのSettings > Workspacesで各workspaceの
ドロップダウンから実ディスプレイ名（例: DELL U2723QE (2)）を選ぶと永続する。
`Ctrl+Cmd+矢印`や`omniwmctl workspace move-to-monitor`による移動は
runtime overrideで、**再起動で消える**。

## 設定編集の注意 — IMPORTANT

`settings.toml`はOmniWMが所有するファイルで、外部編集には制約がある：

- **稼働中の外部編集は無視される**（「保存で即時反映」はGUI変更のみ）
- **`mado stop`（強制kill）直後の編集も消える** — 不正終了と見なされ、
  起動時に内部バックアップから設定ごと復元される
- スキーマ違反（例: `monitorAssignment`の削除）も同様にバックアップ復元が走る

正しい手順：**メニューバーから正常終了（or `osascript -e 'quit app "OmniWM"'`）
→ 編集 → `open -a OmniWM`**。

## 内蔵機能

- **Quake terminal** — libghostty内蔵。位置・サイズ・ガラス効果を設定可
- **Command palette** — ウィンドウ名のfuzzy検索でジャンプ
- **Overview** — サムネイル付きウィンドウ一覧
- **Scratchpad** — 任意アプリの一時退避 / 呼び出し（キーは上表）
- **メニューバーアイコン隠し** — Ice / Bartender相当

## カスタマイズ

設定は`~/.config/omniwm/settings.toml`（`home/darwin/omniwm/config/`
へのsymlink）+ GUI Settings。外部編集は上記の手順で。

- 全hotkey再割当（Settings > Hotkeys）
- App Rules — float指定 / workspace自動割当 / サイズ
  （AeroSpaceの`on-window-detected`相当）
- Workspace bar — 位置・高さ・icon override（`[workspaceBar.iconOverrides]`）
- System Hyper Trigger — Caps LockやF13-F20をHyperキー化
- Mouse & Trackpad — ジェスチャ、スクロール感度

## omniwmctl（自動化）

`general.ipcEnabled = true`設定済み（変更時はOmniWM再起動が必要）。

```bash
omniwmctl query workspaces --format table        # workspace とモニターの対応
omniwmctl query displays --format table          # ディスプレイ配置
omniwmctl workspace move-to-monitor 5 right      # workspace をモニターへ移動
omniwmctl command toggle-focused-window-floating # 任意アクションの実行
omniwmctl subscribe                              # イベントストリーム購読
omniwmctl watch active-workspace --exec update-bar.sh   # イベント毎にスクリプト実行
```

`omniwmctl help`でアクション全一覧。`watch` + scriptでsketchybar連携も
実装可能（現構成では内蔵バーを使用中）。

## 既知の制限

- Dwindleのグループ / タブ順序は実行時状態のため再起動で復元されない
- キー / CLIでのworkspaceモニター移動は再起動で消える（永続はspecificDisplayで）
