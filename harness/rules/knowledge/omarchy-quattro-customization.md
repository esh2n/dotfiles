# Omarchy（v4 Quattro）のカスタマイズ面と、コミュニティ資産をどう見るか

確認日: 2026-09-26

## 答え

Omarchy v4 Quattroはバー・メニュー・通知・ロック画面が単一のQuickshellプロセス（`omarchy-shell`）に統合され、Hyprland設定は`.conf`ではなくLuaになった。バーの設定ファイルは`~/.config/omarchy/shell.json`（JSON）で、下へ移すには`omarchy bar position bottom`が最もdotfiles向き（内部は`jq`で`shell.json`を書き換えるだけ）。ユーザー向けの「自分のファイル」はhypr側の6 Luaファイル＋`.luarc.json`、`shell.json`、端末設定、`~/.bashrc`だが、**上書きしないと明示的に約束されているのは`~/.bashrc`だけ**。`omarchy update`本体は`omarchy-refresh-*`を呼ばないが、`omarchy-migrate`が回す個別のmigrationスクリプトが`shell.json`へウィジェットを自動追加する例が実在し、「アップデートで新しいデフォルトウィジェットが勝手に出ることはない」という公式マニュアルの説明には反例がある。ユーザーが明示的に叩く`omarchy-refresh-hyprland`/`omarchy-refresh-shell`/汎用`omarchy-refresh-config <path>`はいずれも`cp -f`/`mv`ベースの実装で、symlink管理下のファイルを破壊する（`shell.json`をsymlink管理していると`omarchy bar`コマンド自体がそのリンクを壊す、という具体的な矛盾が実装レベルで確認できた）。

テーマは`~/.config/omarchy/themes/<name>/colors.toml`（base16寄りのフラットなTOML、26キー）が中心ファイルで、pi・Claude・opencode・Helix・VSCode・GNOME・キーボードまで含む広範なpost-hookで反映される。git cloneされたテーマは`.lua`/端末設定/`vscode.json`を自動的に剥奪され「色だけ」になる、というコード実行防止の仕組みがある。dotfiles側の13パレット中8件はOmarchyの22既定テーマと名前ベースで重複し、両者とも「1つの色定義ファイルから全アプリ設定を生成する」という同じ設計思想を持つため、キー変換スクリプトを書けばOmarchyテーマとして表現するのは構造的に無理がない（忠実度は未検証）。

コミュニティ面では、キュレーションリストは1本に収束していない（aorumbayev/awesome-omarchyが最も網羅的かつ現行で、同名のWheel-Smith版はQuattro以前のアーキテクチャを記述したまま停止している——star数は現行性を保証しない）。公式プラグインマーケットプレイスは500件超のプラグインを抱え急成長中。バー刷新の最有力候補はHANCORE-linux/Shibumi-Shell（24プラグイン付き）だが、特定ビルドにピン留めされたベータであることを作者自身が明記している。Quattro移行はコミュニティ資産に実害を出しており、個別テーマの破損報告、公式に近いテーマ（dracula/omarchy）ですら対応PRが未マージ、本体側のマイグレーションが警告なくユーザー設定（monitors.conf等）を破壊した報告が2026-09時点でもopenのまま残っている。

## 根拠

- バーの設定ファイルとCLI操作（`omarchy bar position bottom`等） — https://omarchy.org/manual/the-top-bar/、`bin/omarchy-bar`（`raw.githubusercontent.com/omacom/omarchy`）
- `~/.bashrc`のみ「上書きされない」と明示されていること — Omarchyマニュアル（2026-09-24記録で確認済み、本記録で再確認）
- migrationが`shell.json`へウィジェットを自動追加する具体例 — `migrations/1790042972.sh`（"Install Elsewhen, the world clock plugin"）
- `omarchy-refresh-*`が`cp -f`/`mv`でsymlinkを破壊すること — `bin/omarchy-refresh-config`、`bin/omarchy-shell-config`（`commit()`関数）、対応するopen issue #5013・#11096・#9326・#10413
- テーマ機構（`colors.toml`、post-hook群、git cloneテーマのコード実行剥奪） — `bin/omarchy-theme-set`、`themes/nord/colors.toml`、https://omarchy.org/manual/making-your-own-theme/
- キュレーションリストの現行性の差（aorumbayev 577★・2026-09-25 push、Wheel-Smith 128★・2025-11-24停止） — GitHub API直接取得
- Quattro移行による実害の報告 — https://github.com/imbypass/omarchy-theme-hook/issues/55、https://github.com/omacom/omarchy/issues/6911、https://github.com/dracula/omarchy/pulls/5（いずれも 2026-09時点でopen）

## 注意点

- dotfiles側13パレットを実際に`colors.toml`へ変換した場合の見た目の忠実度は検証していない。
- `omarchy-font-set`がバー自体のフォント表示にどう反映されるかの実装経路は未確認。
- `migrations/*.sh` 124件超を悉皆確認できておらず、`shell.json`を自動更新するmigrationが他に何件あるかは不明。
- Noctalia-Shell / DankMaterialShellがOmarchyの`colors.toml`テーマ切替と統合するかどうかの一次資料は無い（post-hookリストに名前が無いことからの推論）。
- Reddit（r/omarchy, r/unixporn）の投稿内容はサンドボックスから到達不能で、コミュニティの「見せびらかし」文化の全体像はこの調査では把握できていない。
