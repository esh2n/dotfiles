# 前とは別のdotfiles方式が残した残骸（dangling symlink等）はどう片付けるのが業界の型か

確認日: 2026-09-26

## 答え

「別のdotfiles方式が残した残骸を、単一の冪等install命令が自動で片付ける」という業界標準は存在しない。home-manager、nix-darwin、chezmoi、GNU Stow、dotbot、yadm、rcm、Mackupの主要ツールは例外なく「自分が作った/追跡しているものだけを掃除する」設計であり、home-managerはソースコードレベルで二重のガード（①前の自分自身の世代のマニフェストに載っている、②リンク先が自分のNix storeパターンに一致する）を持つ。「前とは別の方式」という概念そのものが、どのツールの設計にも存在しない。

見つかった対処パターンは3種のみ: ①対象を厳密に絞った上で自動実行（dotbotの`clean` — dotfilesディレクトリ内を指すdangling symlinkのみ）、②明示的なopt-inフラグ（home-managerの`overwriteBackup` — 実装者本人が「無条件推奨は無責任」と明記）、③別コマンド（GNU Stowの`chkstow`、chezmoiの`destroy` — いずれも自分の管理対象のみ）。「デフォルトで無条件に前方式の残骸を消す」という形はどこにも見つからなかった。

独立した3つの個人dotfilesリポジトリ（dcreager/dotfiles-base、clormor/dotfiles、muhac/dotfiles-manager）のうち2件は「リンク先が自分のリポジトリを指しているか」を確認してから削除する型に自然に収束しているが、1件（muhac）はリンク先を確認せず無条件に`rm -f`する設計で、収束は全会一致ではない。

否定側の証拠として、chezmoiが片付けをしない設計選択の結果、人間が手作業で片付けようとして動いていたVimプラグイン一式を誤って削除した事故が実在する一方（chezmoiは「壊さない」が「事故を無くしはしない」）、yadmは逆に別方式（home-manager）が張った外部symlinkを無条件削除するバグを6年以上openのまま放置している。

## 根拠

- home-managerの掃除対象は自分自身の前世代マニフェストとリンク先パターンの一致に限る — `modules/files.nix`（`cleanOldGen`/`legacyCleanup`、`raw.githubusercontent.com/nix-community/home-manager`）
- home-managerの衝突時の選択肢は「バックアップして置換」「forceで強制上書き」「activation中止」の3つのみ、削除は選択肢に無い — `modules/files/check-link-targets.sh`
- `overwriteBackup`は実装されたが既定off、実装者が「無条件に勧めるのは無責任」と明記 — https://github.com/nix-community/home-manager PR #7887
- dotbotの`clean`は「dotfilesディレクトリ内を指すdangling symlinkのみ」自動削除 — https://raw.githubusercontent.com/anishathalye/dotbot/master/README.md
- chezmoiは前方式の残骸検知機能を持たず、人間の手作業がVimプラグイン一式を誤削除した事故 — msleigh.ioのブログ記事（2026-06-13）
- yadmが別方式（home-manager）のsymlinkを無条件削除するバグが6年以上open — https://github.com/yadm-dev/yadm/issues/236
- GNU Stowの`--adopt`は既存ファイルをstowディレクトリへ移すだけで削除しない、dangling symlink検査は別ユーティリティ`chkstow` — GNU Stowマニュアル

## 注意点

- nix-darwinの`/etc`衝突処理の一次ドキュメント本文には直接到達できておらず、WebSearchの要約のみで裏取りした。
- GNU Stowの`--adopt`によるユーザーデータ損失の一次インシデント報告は見つからなかった（存在しないことの証明ではない）。
- dotfilesの掃除ロジックの安全性に関する学術的・定量的な評価はこの分野に存在しない。
- 「前とは別の方式の残骸」に対処する専用の共有ライブラリ・プラグインは見つからず、いずれも個人リポジトリ内の自作パッチだった。
