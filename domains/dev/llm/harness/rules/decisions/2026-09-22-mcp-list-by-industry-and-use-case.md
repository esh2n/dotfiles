# MCP の一覧は業界評価とユースケース適合で決め、使われていない物は案内の仕組みを直す

Status: accepted — 要否の軸は業界評価とユースケース適合の二つ。使用回数は「使いこなせていない」検知にだけ使う（2026-09-22）。案内の仕組みと pi・omp への届け方は調査後に追記する

## Problem

八つの MCP サーバーが設定されているが、30 日の実呼び出しは合計 23 回で、五つは 0 回。これを「要らない」の根拠にする案が出たが、判断の軸が誤っていた。何を残し、何を足さず、使われていない物をどうするかを、業界評価とユースケースで決め直す。

## Decision

- **残す**: serena（シンボル単位の検索・編集。Claude Code の LSP plugin は診断だけで役割が重ならない）、codebase-memory-mcp（コードグラフ。ベンダー主張の 99% 削減は未検証なので自分の監査で測る）、context7（version 固定の文書注入。`.mcp.json` で最多採用 4,168 件。Codex だけでなく MCP を持つ全ハーネスに配る）、playwright-mcp（ブラウザのネイティブ手段が無いハーネス向け。Claude Code は `claude-in-chrome` があるので不要）、figma-remote（設計を受け取る仕事がある）、notion-mcp（コードの仕事の中で読み書きする）。
- **外す**: figma-desktop（使わない）、claude-mem の mcp-search（記憶の裁定でファイルだけにした）。
- **足さない**: GitHub MCP（93 ツール・約 55,000 トークン、`gh` で同じ機能がほぼ無料。Huntley と Steinberger が数字で否定）、DB 系と Linear/Jira 系（lethal trifecta の事故が三件とも同じ形。ユースケースも無い）、四つ目の記憶系。
- **使われていない物は捨てず、使えるようにする。** serena・codebase-memory・context7・playwright の「いつ使うか」を案内する仕組み（rules の一行、skill の `allowed-tools`、ツール説明の書き方）を調べて入れ、jig の監査で呼び出しを見て一か月後に測る。案内しても使われないときに初めて要否を再検討する。
- **pi と omp への届け方は調査後に決める。** pi は本体に MCP client が無い（拡張の有無を調べる）。omp は `mcp.json` を持つ（遅延読み込みの有無などを調べる）。

## Alternatives considered

- **30 日で 0 回のものを外す**: 当初の私の案。使用回数は「設計が動いていない」検知にはなるが価値の判定にはならない。ユーザーが二度指摘（skill の棚卸し、MCP）。却下。
- **全部残す**: figma-desktop は使わず、claude-mem は別の裁定で無効。二つは理由があって外す。却下。
- **GitHub MCP を足す**: 上記。却下。

## Consequences

- Claude Code は tool search（既定 on、Anthropic の測定で文脈 85% 削減・精度 49→74%）でツール定義を遅延読み込みするが、Codex には無く手動の `enabled_tools` と出力上限だけ。omp・DSH は調査中。定義の費用はハーネスごとに違う。
- MCP の元は `mcp/` 一つ。生成器が各ハーネスの形に翻訳し、`~/.claude.json` には触らない（config-layout の決定）。初回の移行で `claude mcp remove` を手で行う。
- 測定: 案内を入れた後の呼び出し回数を jig の監査 jsonl で見る。ベンダー主張（codebase-memory の 99%、claude-mem の 10 倍）は独立の検証が無い。
- 前例なし: serena・context7・codebase-memory を名指しで評価した実践者の記事は見つかっていない（GitHub MCP への評だけ）。

## Sources

- `.tmp-research/mcp-servers-value.md`、`mcp-pi-omp-and-usage-guidance.md`（調査中）
- Claude Code MCP: https://code.claude.com/docs/en/mcp.md 、tool search: https://www.anthropic.com/engineering/advanced-tool-use
- 実践者: https://simonwillison.net/2025/Aug/22/too-many-mcps/ 、https://simonwillison.net/2025/Oct/14/agentic-engineering/
- 事故: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ 、https://simonwillison.net/2025/May/26/github-mcp-exploited/ 、https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/
- サーバー: https://github.com/oraios/serena 、https://github.com/DeusData/codebase-memory-mcp 、https://github.com/upstash/context7 、https://github.com/microsoft/playwright-mcp
