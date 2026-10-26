# omp（oh-my-pi）のhook・承認・設定階層・サンドボックスの実際の仕様は何か

確認日: 2026-09-22

## 答え

ompはClaude Codeより広いhook/拡張サーフェスを持つ: レガシーな`HookAPI`と現行の`ExtensionAPI`が同じランタイムに統一され、`session_stop`（Claude CodeのStop相当、継続予算・block/advisoryの区別・サブエージェント除外つき）などイベントが豊富。承認は`read`/`write`/`exec`のティア制で、`tools.approvalMode`（`always-ask`/`write`/`yolo`）とツール宣言・ユーザーポリシーの6段階の優先順位で解決される。設定は`.omp` > `.claude` > `.codex` > `.gemini`の優先順位でソースルートを探索し、`config.yml`はdefaults→global→project→overlay→runtimeの順で重ね書きされる。プロファイル（`--profile`）はユーザースコープの設定全体を丸ごと切り替える。重要な欠落: omp自身はOSレベルのサンドボックスを持たない。拡張・hookはサンドボックス化されずメインプロセス内で動作し、hook/拡張のロードに信頼（trust）ゲートは存在しない——外部のサンドボックス／コンテナ／VM境界が前提になっている。

## 根拠

- hookイベント一覧・ペイロード形状は`docs/hooks.md`・`docs/extensions.md`（`can1357/oh-my-pi`リポジトリのrawファイル、直接取得）に明記。`tool_call`は`{block, reason, input}`を返せて`block:true`は即座に実行を止める（fail closed）。
- 「トラスト」要件はhooks/extensions/extension-loadingのいずれのドキュメントにも見当たらなかった（"trust" でgrepして0件）。Codexが要求する明示的なtrustゲートとは対照的。
- 承認ティアの6段階優先順位、`bash.patterns`が`bash`ツールのみを対象とし`eval`ツール（同じく`exec`ティア）は対象外であること、headlessのサブエージェントは常に`yolo`を強制されることは`docs/approval-mode.md`に明記。
- サンドボックス不在の3箇所の独立した明記: 「bashパターンポリシーはプロセスやファイルシステムの隔離ではない」「拡張はサンドボックス化されていない（同一プロセス/ランタイム）」「（この設計は）外側でサンドボックスするホストを前提にしている」（`docs/approval-mode.md`, `docs/extension-loading.md`, `docs/extensions.md`）。
- 設定ソースルートの優先順位・`config.yml`の重ね書き順序・プロファイルの挙動は`docs/config-usage.md`に明記され、実際に`--profile <name>`を使い捨て環境で動かして`~/.omp/profiles/<name>/agent/hooks/pre/...`が生成されることを確認した。
- `session_stop`は継続を最大8回までのadvisoryな`{continue:true}`で許し、`{decision:"block"}`はこの予算を消費せずブロックし続ける——Claude CodeのStop hookより状態遷移が細かい。

## 注意点

- 認証情報が使えないサンドボックス内では、実際のhook発火時のペイロードを1バイトも生で捕獲できなかった——ペイロード形状はドキュメントの記述と、そのドキュメントを消費する本番拡張コードの実装から確認したものであり、生のJSONダンプでの裏取りではない。
- hookが承認ティアシステムより「強い」（blockできる）ことはドキュメントのフロー図から読み取れるが、hookが拒否されるはずの呼び出しをforce-allowできるかどうかは明記がない。
- `~/.omp/agent/lsp.yml`の中身は確認しておらず、存在とパスのみ確認済み。
- ompのバイナリはBunでコンパイルされており、素のNodeランタイムだけでは動かせない（`npm install`経路はなく`bun install -g`またはプリビルドバイナリのcurlインストールが必要）。
