# コーディングエージェントのサンドボックス境界は誰が持つべきか（ハーネス本体・横断仕様・実行基盤・選択レイヤーのどれか）

確認日: 2026-09-22

## 答え

2026年時点の業界慣行では、サンドボックスは圧倒的にハーネス本体が持つ（Claude Code・Codex CLI・Gemini CLI はいずれも自前のサンドボックスをデフォルトで搭載する）。複数のハーネスに同じ境界を横断して適用したいときの、ベンダーが推奨し実践者も独立に収束している答えは devcontainer.json であり、複数ハーネスをまとめて一つのコンテナに入れて動かすパターンが実例として複数見つかる。E2B・Daytona・Docker Sandboxes・AWS Bedrock AgentCore のような実行基盤は、その下で使われる土台であって、「どのハーネスにどの隔離を選ぶか」を判断する層そのものではない。「どのハーネスが動こうとしているかを検知して隔離方式を動的に切り替える、ハーネス非依存の選択レイヤー」という発想には、業界に確立された前例が一つも見当たらなかった——近い実例（ai-bwrap、ai-jail）はどれも「どのエージェントにも同じ一つのポリシーを適用する」ラッパーであり、ハーネスごとに異なる隔離を選ぶものではない。

## 根拠

- Claude Code のドキュメント（`code.claude.com/docs/en/sandbox-environments`）: Bash サンドボックス（Seatbelt/bubblewrap）、サンドボックスランタイム（`@anthropic-ai/sandbox-runtime`）、devcontainer/カスタムコンテナ/VM/クラウドセッションの三層をすべて自前で用意し、外部の管理者チャネル（managed-settings.json/MDM）は「そのハーネス自身のスキーマに値を流し込む」だけで、隔離の実装そのものを置き換えるものではない。
- Codex CLI: `sandbox_mode`（read-only/workspace-write/danger-full-access）と `approval_policy` は独立した軸で、組織側の `requirements.toml` も同様にベンダー自身が用意した設定チャネル。
- Gemini CLI: Seatbelt/Docker・Podman/gVisor・LXC/LXD/Windows `icacls` まで含む多バックエンドのサンドボックスを自前で持ち、devcontainer への言及は見当たらなかった。
- Anthropic 自身の devcontainer ドキュメント（`code.claude.com/docs/en/devcontainer`）: 「Claude Code はコンテナの中の一員であり、コンテナを定義する側ではない」「チーム全体でサンドボックス環境を標準化する」ための推奨経路と明記。
- 実践者側の独立した収束（`gh search` による実例）: `stefanoginella/aicontainer`（Claude Code・Codex・OpenCode を1つの devcontainer にまとめ、`pre-tool-use.sh` という一つのスクリプトを3ツールそれぞれのネイティブ拡張点から呼ぶ）、`morimorijap/sunaba-cli`、`EltonAU/devcontainers`、`hildstrom/apple-devcontainer`、`av-k/devenv` など複数のリポジトリが独立に同じパターン（複数ハーネス・一つのコンテナ）を採用している。
- ハーネス非依存のラッパー（`didvc/ai-bwrap`, `akitaonrails/ai-jail`）は実在するが、どちらも「どのエージェントバイナリにも同一の固定ポリシーを適用する」設計であり、ハーネスの種類に応じて異なる隔離機構を選択する仕組みは持たない。

## 注意点

- DSH（DeepSeek Harness）自身のサンドボックス機構は公開文書が見当たらず、この調査からは除外されている。
- OWASP GenAI/LLM Top 10 の「サンドボックス境界を誰が持つべきか」に関する具体的な立場は、ページ取得の失敗により確認できなかった（沈黙ではなく取得失敗として扱う）。
- Gemini CLI のサンドボックスドキュメントは GitHub リポジトリのファイル経由でのみ確認しており、レンダリングされた公式ドキュメントサイトとの突き合わせはできていない。
- 「ハーネスを検知して隔離方式を動的に選ぶ層」が存在しないのは、この調査で到達できた公開情報の範囲での結論であり、非公開の内部実装まで否定するものではない。
