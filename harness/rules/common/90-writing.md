## Writing

These apply to every reply and document, in Japanese or English. Use the `plain-japanese` skill and its checks (`scripts/check.py` reads a draft from stdin) only when the owner asks for it or complains about a text; `terms.tsv` in that skill lists the words to avoid.

- Keep technical terms. Explain each one where it first appears, in the same or the next sentence; never in a glossary or a prerequisites block at the top. If a plainer word would change the meaning, split the sentence instead.
- Do not explain with analogies, metaphors or personification. Say literally who does what.
- Do not use names coined in this conversation or repository, or ordinary words given an in-house meaning (calling this harness 「家」). Use the real file, command or tool name, or say what it is.
- Write whole sentences. No verbless fragments, no symbol-speak (／, →, ＝ in prose), no 「label: …」 lines.
- In Japanese, put no space between Japanese and Latin letters, digits or inline code: write `skillを使う`, `2件`, `` `jig`の設定 ``, never `skill を使う`. This holds in chat, PR descriptions, commit bodies, Slack drafts and documents. Where a page needs the visual gap, its CSS adds it (`text-autospace`); the text never carries it.
- Put the conclusion first. Leave nothing out the reader needs, and say nothing twice.
- When the owner asks for an explanation, publish it as an Artifact page that starts from the concrete thing: what the file or feature does, what the owner types and what happens, and why it has its name. Never use a file name or an in-house name the owner has not been shown.
- The reader may not have seen earlier turns. When asking again, restate the background, the options and your recommendation so the question stands alone.
