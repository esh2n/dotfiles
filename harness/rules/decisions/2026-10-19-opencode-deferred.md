# OpenCodeは今はjigの配布先に加えず、2.xの正式版を待つ

Status: accepted — 持ち主の裁定（2026-10-19）

rule: Do not add OpenCode as a jig harness yet; add it as a thin harness (rules, skills, agents, the LiteLLM provider, MCP, and a guard plugin on the 2.x API) once OpenCode 2.x is the stable default install.
scope: repo

## Problem

OpenCodeの中でだけ使える無料モデルを使うため、OpenCodeを6つ目のハーネスとしてjigの配布先に加える案があった。

## Decision

今は加えない。OpenCode 2.xが正式版（既定のインストール）になった時点で、2.xのAPIだけを対象に、規則・skill・エージェント・LiteLLMの接続先・MCPと、ガードのプラグインを持つ薄いハーネスとして加える。

## Alternatives considered

- **全部そろえて加える**: 応答の終わりでの型検査の関門とステータスラインは作れない。ガードは1.xと2.xの互換の無い2つのAPIで書く必要がある（「V1 plugin implementations do not run in V2」）。却下。
- **薄く今加える**: プラグインの読み込みに失敗してもガードなしで動き続け、OpenCode自身が「権限の仕組みは境界ではない」と明記し、回避の不具合も残る（#54008・#52083・#47356）。2.xがほぼ毎日更新され、設定の名前をほぼすべて変えるので、作り直しになる。同じことをするrulesyncは3か月でOpenCode向けの修正が約10件、rulerは8件以上。却下。

加える目的の無料モデルも弱い。14個が「期間限定」で、うち4つは送った内容を改良に使い、サブエージェントやbashを禁止したエージェントからの利用が「OpenCodeの外から」と誤判定される不具合が未解決（#49678・#49723）。家のガードの禁止規則を写すと、この不具合に当たる可能性がある。

## Consequences

- OpenCodeの無料モデルは、当面使わない。
- 2.xが正式版になったかは、OpenCodeのnpmの`latest`で判断する。

## Sources

- https://opencode.ai/v2/docs/migrate-v1 、https://github.com/anomalyco/opencode/blob/dev/SECURITY.md
- https://github.com/anomalyco/opencode/issues/56630 、/49678 、/49723 、/54008
- https://github.com/dyoshikawa/rulesync/issues/2592 、https://github.com/intellectronica/ruler/issues/384
- https://opencode.ai/docs/zen/
