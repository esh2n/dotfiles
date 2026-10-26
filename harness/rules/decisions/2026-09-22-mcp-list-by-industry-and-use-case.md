# MCPの一覧は業界評価とユースケース適合で決め、使われていない物は案内の仕組みを直す

Status: accepted — 要否の軸は業界評価とユースケース適合の二つ。使用回数は「使いこなせていない」検知にだけ使う。届け方は各ハーネスの読み込み方（遅延かeagerか）で決め、使わせる仕組みは強制しない（2026-09-22）。Consequencesの「`~/.claude.json`には触らない」はsuperseded by `2026-09-25-jig-writes-claude-json-mcp.md`（jigが`~/.claude.json`の`mcpServers`に直接書く）

rule: Keep serena, codebase-memory-mcp, context7, playwright-mcp, figma-remote and notion-mcp as MCP servers, but drop figma-desktop and claude-mem's mcp-search, and never add GitHub MCP (use gh instead) or DB/Linear/Jira MCP (lethal-trifecta risk). Do not force tool use via deny hooks; instead guide usage with rule lines and disable-model-invocation skills, and measure calls via jig's audit log.

## Problem

八つのMCPサーバーが設定されているが、30日の実呼び出しは合計23回で、五つは0回。これを「要らない」の根拠にする案が出たが、判断の軸が誤っていた。何を残し、何を足さず、使われていない物をどうするかを、業界評価とユースケースで決め直す。

## Decision

- **残す**: serena（シンボル単位の検索・編集。Claude CodeのLSP pluginは診断だけで役割が重ならない）、codebase-memory-mcp（コードグラフ。ベンダー主張の99% 削減は未検証なので自分の監査で測る）、context7（version固定の文書注入。`.mcp.json`で最多採用4,168件。CodexだけでなくMCPを持つ全ハーネスに配る）、playwright-mcp（ブラウザのネイティブ手段が無いハーネス向け。Claude Codeは`claude-in-chrome`があるので不要）、figma-remote（設計を受け取る仕事がある）、notion-mcp（コードの仕事の中で読み書きする）。
- **外す**: figma-desktop（使わない）、claude-memのmcp-search（記憶の裁定でファイルだけにした）。
- **足さない**: GitHub MCP（93ツール・約55,000トークン、`gh`で同じ機能がほぼ無料。HuntleyとSteinbergerが数字で否定）、DB系とLinear/Jira系（lethal trifectaの事故が三件とも同じ形。ユースケースも無い）、四つ目の記憶系。
- **使われていない物は捨てず、使えるようにする。** serena・codebase-memory・context7・playwrightの「いつ使うか」を案内する仕組み（rulesの一行、skillの`allowed-tools`、ツール説明の書き方）を調べて入れ、jigの監査で呼び出しを見て一か月後に測る。案内しても使われないときに初めて要否を再検討する。
- **届け方（同日、調査後に追記）**: piは本体がMCPを恒久的に拒否しているので、拡張pi-mcp-adapter（npm月間101万DL、proxyツール一本約200トークン + 必要時に遅延接続、設定は同じ`mcpServers`のJSON）で`mcp/`の一覧をそのまま届ける。二番手はsupi（serena + context7相当をpiネイティブに置き換える拡張、92星）。ompは本体が遅延読み込み（`xdev`）なので一覧をそのまま。DSHは本体がeager（スキーマが全リクエストに載る）なのでserena・codebase-memory・context7の三つだけ届け、生成器がCordisのYAMLに翻訳する。
- **使わせる仕組みは二段で、強制はしない。** (1) rulesに「いつ使うか」を一行ずつ（context7: ライブラリのAPIを書くときは現行の文書を取る、ユーザーが言うのを待たない。serena: シンボルの改名・参照探索は`find_symbol`/`find_referencing_symbols`）。(2) 人が起点の仕事は`disable-model-invocation: true`のskill（`/refactor-symbol`など）に手順を持たせ、人が呼ぶ。効果はjigの監査で一か月後に測り、使われなければserenaはCLI包み（mcporter）かsupiへ切り替える判断をそのとき行う。

## Alternatives considered

- **30日で0回のものを外す**: 当初の私の案。使用回数は「設計が動いていない」検知にはなるが価値の判定にはならない（skillの棚卸しでもMCPでも同じ）。却下。
- **全部残す**: figma-desktopは使わず、claude-memは別の裁定で無効。二つは理由があって外す。却下。
- **GitHub MCPを足す**: 上記。却下。
- **PreToolUseの拒否フックでserenaの使用を強制する**: serenaのメンテナ自身が「Claude Codeの更新でserenaを使わなくなるのが劇的に悪化した」「唯一somewhat feasibleなのは拒否フック」と認め（#1398）、その拒否フックはLSPのシンボルが無いファイルに誤爆し、denyの3秒後に同じReadをリトライ、フックが120秒盲目化する（#1429）。Ronacherは新しいモデルほど非ネイティブのツール形式が訓練で暗黙に罰される可能性を指摘。却下。
- **piでMCPを使わずCLIに包む（mcporter、作者の推奨）**: 作者の線として正当だが、`mcp/`の一覧を五つに同じ形で届ける設計に合わず、pi-mcp-adapterの遅延設計で文脈コストの懸念は解ける。二番手として残す。

## Consequences

- Claude Codeはtool search（既定on、Anthropicの測定で文脈85% 削減・精度49→74%）でツール定義を遅延読み込みするが、Codexには無く手動の`enabled_tools`と出力上限だけ。ompは本体が遅延、DSHはeager、piは拡張次第（pi-mcp-adapterは遅延）。定義の費用はハーネスごとに違う。
- MCPの元は`mcp/`一つ。生成器が各ハーネスの形に翻訳し、`~/.claude.json`には触らない（config-layoutの決定）。初回の移行で`claude mcp remove`を手で行う。
- 測定: 案内を入れた後の呼び出し回数をjigの監査jsonlで見る。ベンダー主張（codebase-memoryの99%、claude-memの10倍）は独立の検証が無い。
- 前例なし: serena・context7・codebase-memoryを名指しで評価した実践者の記事は見つかっていない（GitHub MCPへの評だけ）。

## Sources

- pi: https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/ 、https://github.com/nicobailon/pi-mcp-adapter 、https://github.com/mrclrchtr/supi
- omp: https://github.com/can1357/oh-my-pi （docs/mcp-config.md）、DSH: https://github.com/deepseek-ai/deepseek-harness （packages/mcp/mcp-client/README.md）
- 誘導: https://github.com/oraios/serena/issues/1398 、/1429 、https://github.com/upstash/context7/issues/2287 、https://lucumr.pocoo.org/2026/7/4/better-models-worse-tools/
- Claude Code MCP: https://code.claude.com/docs/en/mcp.md 、tool search: https://www.anthropic.com/engineering/advanced-tool-use
- 実践者: https://simonwillison.net/2025/Aug/22/too-many-mcps/ 、https://simonwillison.net/2025/Oct/14/agentic-engineering/
- 事故: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ 、https://simonwillison.net/2025/May/26/github-mcp-exploited/ 、https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/
- サーバー: https://github.com/oraios/serena 、https://github.com/DeusData/codebase-memory-mcp 、https://github.com/upstash/context7 、https://github.com/microsoft/playwright-mcp
