# omp（oh-my-pi）の hook・承認・設定階層・サンドボックスの実際の仕様は何か

確認日: 2026-09-22

## 答え

omp は Claude Code より広い hook/拡張サーフェスを持つ: レガシーな `HookAPI` と現行の `ExtensionAPI` が同じランタイムに統一され、`session_stop`（Claude Code の Stop 相当、継続予算・block/advisory の区別・サブエージェント除外つき）などイベントが豊富。承認は `read`/`write`/`exec` のティア制で、`tools.approvalMode`（`always-ask`/`write`/`yolo`）とツール宣言・ユーザーポリシーの6段階の優先順位で解決される。設定は `.omp` > `.claude` > `.codex` > `.gemini` の優先順位でソースルートを探索し、`config.yml` は defaults→global→project→overlay→runtime の順で重ね書きされる。プロファイル（`--profile`）はユーザースコープの設定全体を丸ごと切り替える。重要な欠落: omp 自身は OS レベルのサンドボックスを持たない。拡張・hook はサンドボックス化されずメインプロセス内で動作し、hook/拡張のロードに信頼（trust）ゲートは存在しない——外部のサンドボックス／コンテナ／VM 境界が前提になっている。

## 根拠

- hook イベント一覧・ペイロード形状は `docs/hooks.md`・`docs/extensions.md`（`can1357/oh-my-pi` リポジトリの raw ファイル、直接取得）に明記。`tool_call` は `{block, reason, input}` を返せて `block:true` は即座に実行を止める（fail closed）。
- 「トラスト」要件は hooks/extensions/extension-loading のいずれのドキュメントにも見当たらなかった（"trust" で grep して 0 件）。Codex が要求する明示的な trust ゲートとは対照的。
- 承認ティアの6段階優先順位、`bash.patterns` が `bash` ツールのみを対象とし `eval` ツール（同じく `exec` ティア）は対象外であること、headless のサブエージェントは常に `yolo` を強制されることは `docs/approval-mode.md` に明記。
- サンドボックス不在の3箇所の独立した明記: 「bash パターンポリシーはプロセスやファイルシステムの隔離ではない」「拡張はサンドボックス化されていない（同一プロセス/ランタイム）」「（この設計は）外側でサンドボックスするホストを前提にしている」（`docs/approval-mode.md`, `docs/extension-loading.md`, `docs/extensions.md`）。
- 設定ソースルートの優先順位・`config.yml` の重ね書き順序・プロファイルの挙動は `docs/config-usage.md` に明記され、実際に `--profile <name>` を使い捨て環境で動かして `~/.omp/profiles/<name>/agent/hooks/pre/...` が生成されることを確認した。
- `session_stop` は継続を最大8回までの advisory な `{continue:true}` で許し、`{decision:"block"}` はこの予算を消費せずブロックし続ける——Claude Code の Stop hook より状態遷移が細かい。

## 注意点

- 認証情報が使えないサンドボックス内では、実際の hook 発火時のペイロードを1バイトも生で捕獲できなかった——ペイロード形状はドキュメントの記述と、そのドキュメントを消費する本番拡張コードの実装から確認したものであり、生の JSON ダンプでの裏取りではない。
- hook が承認ティアシステムより「強い」（block できる）ことはドキュメントのフロー図から読み取れるが、hook が拒否されるはずの呼び出しを force-allow できるかどうかは明記がない。
- `~/.omp/agent/lsp.yml` の中身は確認しておらず、存在とパスのみ確認済み。
- omp のバイナリは Bun でコンパイルされており、素の Node ランタイムだけでは動かせない（`npm install` 経路はなく `bun install -g` またはプリビルドバイナリの curl インストールが必要）。
