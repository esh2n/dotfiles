---
title: Install
description: dotfiles の入れ方と更新の仕方、機械の役割。
---

## 入れる・更新する

新しい機械に入れるときも、今の機械を更新するときも、同じ一行です。何度実行しても結果は同じです。

```bash
cd dotfiles
make up    # = ./bootstrap.sh
```

`bootstrap.sh`は、Nixが無ければ公式のインストーラー（multi-user）で入れて止まります（終了コード2）。新しいシェルを開いて`make up`をもう一度実行すると、あとを`dotctl up`に渡します。`dotctl up`がすることは次のとおりです。

1. 役割ファイル（下記）を確かめる
2. 旧構成が残した切れたリンクを消す
3. macOSはnix-darwin、Linuxはhome-managerで構成を作って切り替える
4. Nixでは宣言できない手順（`dotctl setup`の各手順）を走らせる
5. ログインシェルをzshにし、miseで言語の実行環境を入れる

## 役割ファイル

どの役割を持つかは、機械ごとの追跡しないファイル`~/.config/dotfiles/roles.json`に書きます。無いと`dotctl up`が止まり、書き方の例を出します。

```json
{"roles": ["developer", "desk-user", "model-provider", "observer"]}
```

| 役割 | 足すもの |
|------|----------|
| （全部の機械） | シェル、CLIの道具、各アプリの設定 |
| `developer` | 言語の道具、手元のLiteLLM、jigの判断サービス |
| `desk-user` | GUIアプリ、フォント、メディアの道具 |
| `model-provider` | 手元のモデルをtailnetに貸す。macOSはLM Studio、Linux + NVIDIAはllama-server |
| `observer` | Prometheus、Grafana、Open WebUI、AIの利用コストの台帳（一台だけ） |

## Packageの置き場所

| 種類 | 置き場所 |
|------|----------|
| CLIの道具・language server | flake（`home/*/packages*`） |
| GUIアプリ | nix-darwinが宣言するHomebrewのcask（`system/darwin/homebrew.nix`） |
| 言語の実行環境 | mise |

変えたら`make up`で反映します。
