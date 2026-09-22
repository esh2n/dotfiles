# MCP の一覧は業界評価とユースケース適合で決め、使われていない物は案内の仕組みを直す

Status: accepted — 要否の軸は業界評価とユースケース適合の二つ。使用回数は「使いこなせていない」検知にだけ使う。届け方は各ハーネスの読み込み方（遅延か eager か）で決め、使わせる仕組みは強制しない（2026-09-22）

## Problem

八つの MCP サーバーが設定されているが、30 日の実呼び出しは合計 23 回で、五つは 0 回。これを「要らない」の根拠にする案が出たが、判断の軸が誤っていた。何を残し、何を足さず、使われていない物をどうするかを、業界評価とユースケースで決め直す。

## Decision

- **残す**: serena（シンボル単位の検索・編集。Claude Code の LSP plugin は診断だけで役割が重ならない）、codebase-memory-mcp（コードグラフ。ベンダー主張の 99% 削減は未検証なので自分の監査で測る）、context7（version 固定の文書注入。`.mcp.json` で最多採用 4,168 件。Codex だけでなく MCP を持つ全ハーネスに配る）、playwright-mcp（ブラウザのネイティブ手段が無いハーネス向け。Claude Code は `claude-in-chrome` があるので不要）、figma-remote（設計を受け取る仕事がある）、notion-mcp（コードの仕事の中で読み書きする）。
- **外す**: figma-desktop（使わない）、claude-mem の mcp-search（記憶の裁定でファイルだけにした）。
- **足さない**: GitHub MCP（93 ツール・約 55,000 トークン、`gh` で同じ機能がほぼ無料。Huntley と Steinberger が数字で否定）、DB 系と Linear/Jira 系（lethal trifecta の事故が三件とも同じ形。ユースケースも無い）、四つ目の記憶系。
- **使われていない物は捨てず、使えるようにする。** serena・codebase-memory・context7・playwright の「いつ使うか」を案内する仕組み（rules の一行、skill の `allowed-tools`、ツール説明の書き方）を調べて入れ、jig の監査で呼び出しを見て一か月後に測る。案内しても使われないときに初めて要否を再検討する。
- **届け方（同日、調査後に追記）**: pi は本体が MCP を恒久的に拒否しているので、拡張 pi-mcp-adapter（npm 月間 101 万 DL、proxy ツール一本約 200 トークン + 必要時に遅延接続、設定は同じ `mcpServers` の JSON）で `mcp/` の一覧をそのまま届ける。二番手は supi（serena + context7 相当を pi ネイティブに置き換える拡張、92 星）。omp は本体が遅延読み込み（`xdev`）なので一覧をそのまま。DSH は本体が eager（スキーマが全リクエストに載る）なので serena・codebase-memory・context7 の三つだけ届け、生成器が Cordis の YAML に翻訳する。
- **使わせる仕組みは二段で、強制はしない。** (1) rules に「いつ使うか」を一行ずつ（context7: ライブラリの API を書くときは現行の文書を取る、ユーザーが言うのを待たない。serena: シンボルの改名・参照探索は `find_symbol`/`find_referencing_symbols`）。(2) 人が起点の仕事は `disable-model-invocation: true` の skill（`/refactor-symbol` など）に手順を持たせ、人が呼ぶ。効果は jig の監査で一か月後に測り、使われなければ serena は CLI 包み（mcporter）か supi へ切り替える判断をそのとき行う。

## Alternatives considered

- **30 日で 0 回のものを外す**: 当初の私の案。使用回数は「設計が動いていない」検知にはなるが価値の判定にはならない。ユーザーが二度指摘（skill の棚卸し、MCP）。却下。
- **全部残す**: figma-desktop は使わず、claude-mem は別の裁定で無効。二つは理由があって外す。却下。
- **GitHub MCP を足す**: 上記。却下。
- **PreToolUse の拒否フックで serena の使用を強制する**: serena のメンテナ自身が「Claude Code の更新で serena を使わなくなるのが劇的に悪化した」「唯一 somewhat feasible なのは拒否フック」と認め（#1398）、その拒否フックは LSP のシンボルが無いファイルに誤爆し、deny の 3 秒後に同じ Read をリトライ、フックが 120 秒盲目化する（#1429）。Ronacher は新しいモデルほど非ネイティブのツール形式が訓練で暗黙に罰される可能性を指摘。却下。
- **pi で MCP を使わず CLI に包む（mcporter、作者の推奨）**: 作者の線として正当だが、`mcp/` の一覧を五つに同じ形で届ける設計に合わず、pi-mcp-adapter の遅延設計で文脈コストの懸念は解ける。二番手として残す。

## Consequences

- Claude Code は tool search（既定 on、Anthropic の測定で文脈 85% 削減・精度 49→74%）でツール定義を遅延読み込みするが、Codex には無く手動の `enabled_tools` と出力上限だけ。omp は本体が遅延、DSH は eager、pi は拡張次第（pi-mcp-adapter は遅延）。定義の費用はハーネスごとに違う。
- MCP の元は `mcp/` 一つ。生成器が各ハーネスの形に翻訳し、`~/.claude.json` には触らない（config-layout の決定）。初回の移行で `claude mcp remove` を手で行う。
- 測定: 案内を入れた後の呼び出し回数を jig の監査 jsonl で見る。ベンダー主張（codebase-memory の 99%、claude-mem の 10 倍）は独立の検証が無い。
- 前例なし: serena・context7・codebase-memory を名指しで評価した実践者の記事は見つかっていない（GitHub MCP への評だけ）。

## Sources

- `.tmp-research/mcp-servers-value.md`、`mcp-pi-omp-and-usage-guidance.md`
- pi: https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/ 、https://github.com/nicobailon/pi-mcp-adapter 、https://github.com/mrclrchtr/supi
- omp: https://github.com/can1357/oh-my-pi （docs/mcp-config.md）、DSH: https://github.com/deepseek-ai/deepseek-harness （packages/mcp/mcp-client/README.md）
- 誘導: https://github.com/oraios/serena/issues/1398 、/1429 、https://github.com/upstash/context7/issues/2287 、https://lucumr.pocoo.org/2026/7/4/better-models-worse-tools/
- Claude Code MCP: https://code.claude.com/docs/en/mcp.md 、tool search: https://www.anthropic.com/engineering/advanced-tool-use
- 実践者: https://simonwillison.net/2025/Aug/22/too-many-mcps/ 、https://simonwillison.net/2025/Oct/14/agentic-engineering/
- 事故: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ 、https://simonwillison.net/2025/May/26/github-mcp-exploited/ 、https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/
- サーバー: https://github.com/oraios/serena 、https://github.com/DeusData/codebase-memory-mcp 、https://github.com/upstash/context7 、https://github.com/microsoft/playwright-mcp
