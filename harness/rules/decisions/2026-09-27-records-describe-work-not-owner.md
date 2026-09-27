# 記録には仕事だけを書く。持ち主の口調・人柄・言い間違い・発言そのものは書かない

Status: accepted — 持ち主の裁定（2026-09-27）。

rule: Records in this public repository (research, decisions, plans, writeups, commit messages) describe the work, never the owner as a person: no tone, personality, mood or habits of speech, no misspellings or misremembered names the owner used, and no quotation of the owner's messages. State a requirement as the requirement ("both machines must be covered"), a ruling as "accepted by the owner, <date>", and a mistaken name as the correct name alone.

## Problem

調査記録・決定記録は公開リポジトリに Markdown で残す決まり（`2026-09-22-writeup-markdown-source-two-builds.md`）で、エージェントは調べる前に `rules/research/INDEX.md` を読む。記録の中身（URL・引用・結論）はこの用途に必要だが、書き手のエージェントは依頼の文脈として持ち主その人のことも書いていた。持ち主の覚え違いの名前が記録の題と INDEX にそのまま入り、持ち主の心配や口ぶり、裁定のときの言葉がかぎ括弧で引用されていた。どれも調べた結果の再利用には要らず、公開されると持ち主が困る。

## Decision

- 記録（research・decisions・plans・writeup・コミットメッセージ）に書くのは、問い・根拠・結論・要件・裁定の事実だけ。
- 書かないもの:
  - 持ち主の口調・人柄・感情・話し方の癖。
  - 持ち主の言い間違い・覚え違い（名前は正しい名前だけを書く）。
  - 持ち主の発言そのもの（かぎ括弧の引用、ほぼそのままの言い換えを含む）。
- 要件は要件として書く（「両方の機械を覆うこと」）。「持ち主が心配する」のように人に帰さない。
- 裁定は `Status: accepted — 持ち主の裁定（日付）` の形に留め、そのときの言葉を添えない。
- 調査を頼むエージェントへの依頼文にも、持ち主の言葉や人柄を書き写さない（依頼文の文言がそのまま記録に流れ込むため）。

## Alternatives considered

- **記録を git から外し、手元にだけ置く**: 公開はされないが、Mac など他の機械のエージェントに記録が届かず、同じ問いを調べ直すことになる。記録の中身そのものは困らないため、書き方を直す方を採った。
- **リポジトリを非公開にする**: dotfiles 全体を閉じることになり、目的に対して大きすぎる。

## Consequences

- `harness/agents/research.md` の出力規則に同じ一文を足し、調査エージェントに直接届くようにする。
- 既存の記録は、この決まりに合わせて書き直す（該当箇所の洗い出しを先に行う）。過去のコミット履歴に残る分は、持ち主の判断で残す。
