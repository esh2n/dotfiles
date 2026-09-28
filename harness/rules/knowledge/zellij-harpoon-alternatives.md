# zellij 0.44 系で harpoon（pane bookmark/jump）が壊れたときの代替は何か

確認日: 2026-09-25

## 答え

zellij は 0.44.0 で `focus_terminal_pane`（および兄弟関数）に第3引数 `should_be_in_place_if_hidden` を意図的に追加した（zellij 本体メンテナによる正式な機能拡張）。Nacho114/harpoon は zellij-tile を 0.42.2 のまま16か月以上更新しておらず、この変更に追従できていない。upstream の issue/PR 一覧のどこにも「0.44」への言及が無く、メンテナが問題を認識している形跡自体が無い。フォークのうち3引数化を実際に行ったのは2件のみで、どちらも星0・リリース0件・CI無しの個人作業ログに近い。

代替として最も筋が良いのは shihanng/zellij-pane-picker（旧名 yapp）で、pane の star/unstar・cycle・toggle 機能を持ち、CI ビルドのリリースを重ねている。ただし配布されている最新リリース（v0.6.0）は実は harpoon と同じ古い `zellij-tile 0.42.2` でビルドされたもので、main ブランチだけが 0.44.0 へ上がっている。それでも実践者の issue 報告は、この旧ビルドが zellij 0.44.0 上で普通にロードして動くことを示している（致命的な非互換ではなさそうという推測、実機未検証）。次点は timonwong/zellij-palette で、zellij-tile 版は課題対象（0.44.3）と完全一致するが、メンテナ自身が「mostly AI slop」と明言する若いプロジェクト。

zellij 自体に harpoon 相当の組み込み機能は無い。公式の組み込みプラグインエイリアスは `tab-bar`/`status-bar`/`strider`/`compact-bar`/`session-manager` の6種のみで、pane 単位のピッカー/ジャンプ/ブックマーク機能はどれにも無い。

## 根拠

- `focus_terminal_pane` への第3引数追加が意図した機能拡張であること — https://api.github.com/repos/zellij-org/zellij/pulls/4546（zellij 本体メンテナ imsnif、2025-12-11マージ、0.44.0同梱）
- Nacho114/harpoon の upstream issue/PR 22件に「0.44」「focus_terminal_pane」への言及が0件 — https://api.github.com/repos/Nacho114/harpoon/issues?state=all
- 3引数化に成功したフォーク2件（cartwmic/harpoon, gabber235/zellij-harpoon）はいずれも星0・リリース0件 — GitHub API 直接取得
- shihanng/zellij-pane-picker の公式配布 wasm（v0.6.0）が `zellij-tile 0.42.2` でビルドされていること — https://github.com/shihanng/zellij-pane-picker
- 旧ビルドが zellij 0.44.0 上でロード・動作すること（間接証拠） — https://github.com/shihanng/zellij-pane-picker/issues/71
- timonwong/zellij-palette のメンテナ自己評価「mostly AI slop」 — https://github.com/timonwong/zellij-palette
- zellij 公式の組み込みプラグインエイリアス一覧（pane 単位機能なし） — https://zellij.dev/documentation/plugin-aliases

## 注意点

- shihanng/zellij-pane-picker v0.6.0 が持ち主の環境（zellij 0.44.1）で実際に安定動作することの直接検証はしていない。
- zellij 0.44.0 の WASM ランタイム移行（wasmtime→wasmi）が旧クレートのプラグイン呼び出しをどう後方互換に扱っているかの一次技術記述は見つからなかった。
- Picalines/zellij-leap（zellij-tile 0.45.0 向け）が 0.44.1 で動くかは未確認。
- timonwong/zellij-palette のリリースアセットに実際に `.wasm` ファイルが含まれるかはファイル名を直接確認できていない。
- どちらの候補を採用しても、実機での動作確認はこの調査の範囲外だった。
