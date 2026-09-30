# 設定の元は種類ごとに一か所に置き、personal 層は作らず、翻訳は生成器が持つ

Status: superseded by 2026-09-24-harness-top-level-dir.md（置き場所だけ。種類ごとの元ディレクトリと、変換は jig の中だけという点はそちらが引き継ぐ） — accepted — 種類ごとの元ディレクトリと生成器の組が複数ハーネス運用の実践と一致する（2026-09-22）

rule: Keep harness source files under domains/dev/llm/harness/, organized by kind (rules/, skills/, agents/, hooks/, mcp/, policy/, jig/), never a separate personal/ layer. Do all per-harness translation inside the jig apply generator, and never commit its generated output to the repository.

## Problem

ルール、スキル、サブエージェント、フック、MCP の一覧、権限といった設定の元を、五つのハーネス(Claude Code、Codex、pi、DSH、omp)に届けるための置き方を決める。ハーネスごとに置き場と形式が違い、共有できる部分とできない部分がある。

## Decision

- 元ファイルは `domains/dev/llm/harness/` 以下に種類ごとに置く: `rules/`(AGENTS.md の元、common と言語別)、`skills/`(言語や領域で分けた SKILL.md)、`agents/`、`hooks/`、`mcp/`、`policy/`(guard-rules.json)、`jig/`(生成器)。
- 言語別のディレクトリは残す。機械ごとの on/off(packs)はやめる。何を読むかは、ルールは `paths:` の指定、スキルは jev の選択が決める。
- personal 層は作らない。jig はユーザー一人の層なので、個人のスキルもルールも同じ場所に置く。
- 翻訳はすべて `jig apply` の生成器が持ち、結果はリポジトリに残さない。symlink で足りるもの: skills(Claude Code は `~/.claude/skills`、他は `~/.agents/skills`)、AGENTS.md(Claude Code は `CLAUDE.md → AGENTS.md`)。翻訳が要るもの: `paths:` の条件付きルール(Codex・pi・DSH はフックで差し込む)、フック(Claude Code と Codex は設定、pi と DSH はコード)、権限(guard-rules.json から四つの形)、MCP の一覧(四つの形)、サブエージェント定義(Codex の形式と pi の package は未確認)。

## Alternatives considered

- **複数の層を外で合成した設定ファイルを丸ごと置く**: 複数ハーネスを一つの設定で運用する公開リポジトリ(agent-config、anywhere-agents、source-agents)はどれもやっていない。全部が元を種類ごとに置き、各ハーネスの置き場へ symlink か小さな生成で届ける。合成結果がリポジトリに残ると、元と結果の二重管理になる。却下。
- **Claude Code の plugin/marketplace で配る**: 実践者の複数ハーネス設定でこれを使う例はゼロ。却下。
- **core と personal を分けたまま生成器で重ねる**: 「配れる部分と自分だけの部分」を分ける発想だが、jig は最初から一人用で分ける理由がない。却下。
- **言語ごとの束を機械ごとに on/off する**: スキルは jev が仕事ごとに動的に選ぶ設計が既に jig にある(`app/routing/select-skills.ts`)。静的な切り替えは、その仕組みと重複する。却下。

## Consequences

- ハーネスごとの置き場の違い(ディレクトリ、形式、層の重ね方)は生成器に閉じ込める。生成器は各ハーネスの層のアルゴリズム(Claude Code の JSON 優先順位、Codex の TOML 優先順位、pi の深いマージ、DSH の profile の patch)を個別に知る必要がある。
- ハーネスが自分の設定ファイルに書き込む一時的な鍵(`feedbackSurveyState` など)を、生成のたびに壊さない配慮が要る(実例で報告あり)。
- 生成される AGENTS.md は五つのハーネスで同一（2026-09-24 の裁定: pi も同じ物を読む。pi 専用の短い `home/shared/harness/pi/AGENTS.md` は退役。長すぎるなら `rules/common` を締める — ハーネスごとに別本を持たない）。
- 生成器の依存は元 → 出力の一方向。出力先やハーネス自身のファイル(`~/.claude.json` など)を読んでよいのは、自分が管理しない鍵をそのまま戻すためだけで、読んだ内容で管理する鍵の値や診断の出力を変えない。二か所にあるものの整理は移行時の一回の手作業であって、生成器の機能ではない(2026-09-22、MCP の二重登録を生成器で検知しようとして依存を逆にしかけた)。

## Sources

- agent-config: https://github.com/domengabrovsek/agent-config 、anywhere-agents: https://github.com/yzhao062/anywhere-agents
- source-agents（生成でなく symlink 化で複数ハーネスに配る例）: https://github.com/iannuttall/source-agents
- Claude Code settings: https://code.claude.com/docs/en/settings 、Codex config: https://learn.chatgpt.com/docs/config-file/config-basic
