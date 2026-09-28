# Docker エンジンをログイン時に自動起動する（macOS/OrbStack と Omarchy）

確認日: 2026-09-26

## 答え

OrbStack は CLI から `orb config set app.start_at_login true` で自動起動を設定できるが、このキーは2024年にメンテナが実装を認めたのみで、公式ドキュメント（Settings ページ、リリースノート）のどちらにも記載が無い「隠れた」設定である。より重い事実として、OrbStack は「ログインセッションが無い状態（LaunchDaemon としての root 実行、または GUI ログイン無しのヘッドレス運用）での自動起動」を公式に非サポートと明言している（メンテナ: "This is not supported"／"there are no plans to support running OrbStack as root"）。Docker Desktop のネイティブな start-at-login 機能も、colima の `brew services start colima` 頼みの自動起動も、それぞれ独自の失敗モードを抱えたまま繰り返し壊れており、macOS で Docker エンジンをログイン時に確実に立ち上げるという課題自体が業界的に枯れていない。

Omarchy は Docker を標準パッケージセットに最初から含み（`docker`/`docker-buildx`/`docker-compose`/`lazydocker`/`ufw-docker`）、`docker.socket` を有効化する（`docker.service` ではない）ため次回ブート後は socket activation 経由で使える。ただし 4.x 以降はセキュリティ上の理由でユーザーを docker グループに入れない設計に変わっており、`sudo` かポリシー経由のアクセスが必要になる。

systemd --user ユニットも launchd エージェントも、システムスコープのサービス（Docker エンジン）の準備完了を宣言的に待つ仕組みを持たない。systemd はスコープをまたぐ依存をサイレントに無視し（エラーも警告も出ない）、launchd にはそもそも依存順序を宣言するキー自体が存在しない。両陣営の実践者が独立に同じ結論（`until docker info; do sleep 3; done` のようなポーリング待ちループを自分で書く）に達している。

## 根拠

- OrbStack の `app.start_at_login` がメンテナにより2024-12に実装表明されたが公式ドキュメントに未記載 — https://github.com/orbstack/orbstack/issues/1581、https://docs.orbstack.dev/settings
- OrbStack がヘッドレス／無ログイン起動を非サポートと明言 — https://github.com/orbstack/orbstack/issues/1767、https://github.com/orbstack/orbstack/issues/1444（"Daemons run as root, and there are no plans to support running OrbStack as root"）
- Docker Desktop の start-at-login が複数バージョンで再発・再修正 — https://github.com/docker/for-mac/issues/7052
- colima の `brew services start colima` が複数の失敗モードを抱えたまま open — https://github.com/abiosoft/colima/issues/960
- Omarchy が Docker をベースパッケージに含み `docker.socket` を有効化する記述、4.x 以降 docker グループに追加しない設計 — `install/omarchy-base.packages`、`install/config/enable-services.sh`、`install/config/docker.sh`
- systemd --user ユニットがシステムユニットへの依存をサイレントに無視する — https://github.com/systemd/systemd/issues/26305、https://github.com/systemd/systemd/issues/3312（poettering の回答）
- launchd に依存順序キーが存在しない — Apple 公式 `launchd.plist(5)` man page

## 注意点

- `orb config set app.start_at_login true` が OrbStack の自己更新を跨いで維持されることを直接検証した一次報告は無い。
- Omarchy の `docker.socket` のみ有効化という構成で、初回 `docker info` 呼び出しからの実測レイテンシは確認できていない。
- Omarchy の docker 関連スクリプトにログドライバ上限（log-driver/max-size）設定があるかは網羅調査していない。
