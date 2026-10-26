# zellij 0.44系でharpoon（pane bookmark/jump）が壊れたときの代替は何か

確認日: 2026-09-25

## 答え

zellijは0.44.0で`focus_terminal_pane`（および兄弟関数）に第3引数`should_be_in_place_if_hidden`を意図的に追加した（zellij本体メンテナによる正式な機能拡張）。Nacho114/harpoonはzellij-tileを0.42.2のまま16か月以上更新しておらず、この変更に追従できていない。upstreamのissue/PR一覧のどこにも「0.44」への言及が無く、メンテナが問題を認識している形跡自体が無い。フォークのうち3引数化を実際に行ったのは2件のみで、どちらも星0・リリース0件・CI無しの個人作業ログに近い。

代替として最も筋が良いのはshihanng/zellij-pane-picker（旧名yapp）で、paneのstar/unstar・cycle・toggle機能を持ち、CIビルドのリリースを重ねている。ただし配布されている最新リリース（v0.6.0）は実はharpoonと同じ古い`zellij-tile 0.42.2`でビルドされたもので、mainブランチだけが0.44.0へ上がっている。それでも実践者のissue報告は、この旧ビルドがzellij 0.44.0上で普通にロードして動くことを示している（致命的な非互換ではなさそうという推測、実機未検証）。次点はtimonwong/zellij-paletteで、zellij-tile版は課題対象（0.44.3）と完全一致するが、メンテナ自身が「mostly AI slop」と明言する若いプロジェクト。

zellij自体にharpoon相当の組み込み機能は無い。公式の組み込みプラグインエイリアスは`tab-bar`/`status-bar`/`strider`/`compact-bar`/`session-manager`の6種のみで、pane単位のピッカー/ジャンプ/ブックマーク機能はどれにも無い。

## 根拠

- `focus_terminal_pane`への第3引数追加が意図した機能拡張であること — https://api.github.com/repos/zellij-org/zellij/pulls/4546（zellij 本体メンテナimsnif、2025-12-11マージ、0.44.0同梱）
- Nacho114/harpoonのupstream issue/PR 22件に「0.44」「focus_terminal_pane」への言及が0件 — https://api.github.com/repos/Nacho114/harpoon/issues?state=all
- 3引数化に成功したフォーク2件（cartwmic/harpoon, gabber235/zellij-harpoon）はいずれも星0・リリース0件 — GitHub API直接取得
- shihanng/zellij-pane-pickerの公式配布wasm（v0.6.0）が`zellij-tile 0.42.2`でビルドされていること — https://github.com/shihanng/zellij-pane-picker
- 旧ビルドがzellij 0.44.0上でロード・動作すること（間接証拠） — https://github.com/shihanng/zellij-pane-picker/issues/71
- timonwong/zellij-paletteのメンテナ自己評価「mostly AI slop」 — https://github.com/timonwong/zellij-palette
- zellij公式の組み込みプラグインエイリアス一覧（pane単位機能なし） — https://zellij.dev/documentation/plugin-aliases

## 注意点

- shihanng/zellij-pane-picker v0.6.0が持ち主の環境（zellij 0.44.1）で実際に安定動作することの直接検証はしていない。
- zellij 0.44.0のWASMランタイム移行（wasmtime→wasmi）が旧クレートのプラグイン呼び出しをどう後方互換に扱っているかの一次技術記述は見つからなかった。
- Picalines/zellij-leap（zellij-tile 0.45.0向け）が0.44.1で動くかは未確認。
- timonwong/zellij-paletteのリリースアセットに実際に`.wasm`ファイルが含まれるかはファイル名を直接確認できていない。
- どちらの候補を採用しても、実機での動作確認はこの調査の範囲外だった。
