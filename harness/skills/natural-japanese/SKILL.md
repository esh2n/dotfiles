---
name: natural-japanese
description: "Skill for writing and revising Japanese work documents in natural, easy-to-read, clear Japanese. Use for drafting or polishing minutes, research reports, client-facing reports, internal guides, technical articles, PR descriptions, research memos, proposals, email and slide outlines, and for writing note posts, blog posts and essays; also for turning a transcript into minutes. Use for requests such as 自然な日本語にしたい, 読みやすくしたい, 簡潔にしたい, 結論から書きたい, and for complaints such as 読みづらい, わかりにくい, 何を言っているかわからない, AI っぽい, AI 臭い, 英語の直訳っぽい, 日本語として不自然, 違和感がある. Also handles judging or scoring how AI-like a text is without rewriting it (この文章AIが書いた？, AI臭さをスコアで出して), and learning the user's own style. Out of scope: chapter structure of technical documents and Markdown formatting itself — this skill covers the prose."
license: MIT
argument-hint: "[write|score] [quick|full|exp] [対象ファイルや依頼内容]"
metadata:
  namespaces: [doc]
---

# natural-japanese

A skill for writing and revising Japanese work documents so they read easily and clearly. It covers work documents — minutes, research reports, internal guides, research memos, slides — as well as note posts, blog posts and essays. Removing AI-like writing habits is part of the process. The documents produced are Japanese; these instructions are in English, and every Japanese example, word list and pattern below is data to match, not text to translate.

`scripts/lint.py` detects suspicious spots mechanically; you decide in context whether to fix them. An AI has trouble noticing its own writing habits, so detection is left to the machine.

Call the scripts by absolute path so the working directory does not matter. Every `scripts/...` path below means `"$SK/scripts/..."`:

```bash
SK="$HOME/.claude/skills/natural-japanese"
# fall back to the dotfiles checkout when the symlink is broken
[ -d "$SK/scripts" ] || SK="${DOTFILES_ROOT:-$HOME/dotfiles}/harness/skills/natural-japanese"
```

## The top rule: add nothing that is not in the original

When revising an existing document, do not add facts, numbers, names, dates, conditions, evaluations, opinions or policies that the original does not contain. Whoever reads the revised document takes everything in it as something the writer said. Added content, even when correct, spreads words the writer never said as the writer's own.

The following changes also count as "adding".

- Changing the degree of certainty: turning 「次回また相談する」 into 「合意した」, 「かもしれない」 into 「決めた」, or, the other way, weakening an assertion into a guess
- Writing in the writer's experience or views, such as 「これには何度も助けられた」 or 「筆者としては〜をすすめる」
- Adding a numeric frame that is not in the original, such as 「理由は3つある」 or 「主に3種類に分けられる」
- Rewriting numbers or table values from the original. Even if one looks wrong, do not rewrite it; tell the user
- Adding paragraphs of general cautions or explanations that are not in the original

The only additions allowed are supplements that follow directly from the original: the full name of an abbreviation, a short explanation of a term, and connecting words that show how sentences relate.

As an example, take revising one sentence of minutes.

- Original: 「佐藤さんが在庫回転率を使う案を出し、鈴木さんも賛成した。最終的にどう決まったかは次回また相談することになった。」
- Wrong revision: 「在庫回転率に変更する方針で合意した。具体案は田中が7/18までに作る。」 (the decision, owner and due date are not in the original)
- Good revision: 「在庫回転率を使う案が佐藤さんから出て、鈴木さんも賛成した。決定は次回に持ち越した。」

Two more examples of revising without changing content. Both change only the wording and keep the facts and the degree of certainty as they were.

- Original: 「このツールを使用することで、作業効率を大幅に向上させることができると言えるでしょう。」
- Revised: 「このツールを使うと、作業の効率は大きく上がるだろう。」 (the restrained conjecture of 「と言えるでしょう」 is kept as 「だろう」, not raised to a strong expectation like 「はずだ」)
- Original: 「この事実は、従来の前提が誤っていたことを示している。」
- Revised: 「この事実から、従来の前提が誤っていたと分かる。」

The same holds when writing something new: use only the material the user gave you and facts you looked up yourself and can cite. When material is short, do not fill the gap with guesses; tell the user what is missing.

## Execution modes

The same process runs in two modes that differ in effort.

Quick (the default) is for everyday documents and finishes in place without subagents. The only reference to read is one file under `references/doctypes/` once the document type is settled. Run lint once, always, even on a short document: on short text the statistical detectors report nothing, but forbidden phrases and translationese are detected from a single sentence, and the run takes a few seconds. When revising an existing document, also write out the paragraph-by-paragraph check at the end of lint's output (§3) all the way through. The structure check (§5) can be as light as reading through the headings and the first sentence of each paragraph. Time as a guide: about 30 seconds for a meeting memo, about 3 minutes even at around 10,000 characters.

Use full when the user says 「しっかり」 or 「時間をかけていい」, for documents where mistakes are costly (external or executive audiences), and for documents over 10,000 characters. Besides lint, run `outline.py` and `terms.py`, and do every structure and readability check in §5.

Use subagents only when splitting the reading of a long document makes it faster, and decide yourself whether to fix what they find. Never split the writing itself: density and the links between sections cannot be kept without seeing the whole document.

Full takes about 7 minutes for a short document and 15–20 minutes at 10,000 characters, so tell the user before starting. Where effort is selectable, use high. Measurements confirm that at low effort the full steps tend to get rationalized away.

When torn between the two, finish in quick and add a line telling the user 「フルで見直すこともできる」.

## Invocation

When the skill is called as a command with arguments, read them as follows.

- `/natural-japanese [quick|full] <対象>`: write or revise (the default). Decide from the target whether this is new writing or a revision of an existing document
- `/natural-japanese write [quick|full] <お題や素材>`: write something new. Proceed in order from §1
- `/natural-japanese score [quick|full|exp] <ファイル>`: diagnose only; do not rewrite the document. Read `references/diagnose.md` first; the score formula and the output format are defined only there. You may propose a rewrite after diagnosing, but do not fix anything until asked

Without a mode, choose one by the criteria above. Treat natural-language requests the same way (「〇〇について書いて」 is write, 「この文章 AI っぽい?」 is score).

## 1. Decide before writing

### Reader and purpose

Decide who reads the document and what should happen after they read it. If unclear, ask the user. If the document type is one of the following, read the matching file; it holds that type's required elements and the failures AIs typically make.

- 議事録 (minutes): `references/doctypes/minutes.md`
- 調査レポート・分析レポート (research / analysis report): `references/doctypes/report.md`
- 社内ガイド・マニュアル (internal guide / manual): `references/doctypes/guide.md`
- リサーチメモ・ディスカッションペーパー・企画書 (research memo / discussion paper / proposal): `references/doctypes/memo.md`
- スライド構成 (slide outline): `references/doctypes/slide.md`

### Main message and headings

Before the body, write the main message in one sentence. If you cannot, the material is insufficient (→ Material).

In headings, write the section's conclusion, not a label like 「背景」 or 「まとめ」. Check that reading only the headings in order carries the argument before moving on to the body. For a section whose conclusion is conditional and will not fit in a heading, do not write a conclusion with the conditions dropped; use a heading that names the topic (§3). But do not force every heading into the same 「名詞: 結論文」 shape; a row of identical shapes itself looks mechanical. Short sections may keep a label. A heading must not raise the degree of certainty above the body: if the body says 「予定」, do not assert it in the heading. Readers often decide from the headings alone, so an assertion in a heading carries further than a reservation in the body.

### Density

Write important sections thick and light sections short. If every section has the same thickness and the same sentence patterns, readers cannot tell weighty content from light. Before writing, list the points and decide how much each is worth writing.

Density is a difference in amount, not a ranking. Do not attach ranks or tiers such as 「最優先・次点・後回し」 to items that are parallel by nature. Write an order only when the content has one by nature.

### Material (素材; when writing something new)

Writing without proper nouns, numbers or real examples at hand produces paragraphs of generalities. If you can explain a claim without any proper noun, number or concrete event, the material is insufficient.

If web search is available, first set up a provisional claim and its grounds, confirm or break them with searches, then rebuild the claim. Do this once or twice. If search is unavailable, ask the user whether they have concrete examples, numbers or primary sources. If the user has no material, you may proceed after telling them the content will stay general.

### Style profile (optional)

If `style-profile.md` exists (at the project root or a place the user named), read it and write with its habits of viewpoint, vocabulary and rhythm in mind. Otherwise write in the generic way. Only when the user asks to have their own style learned, extract the characteristics of 3–5 past pieces following `assets/style-profile-template.md` and write out the profile. Do not assert characteristics; write 「傾向として」. When the user says a particular word or combination is something 「自分は使わない」 or 「不自然」, do not generalize it into a rule; record it under the profile's 「避ける表現」 with its source and scope. Do not ban the whole word; record only the combination that was pointed out.

## 2. Principles for writing

When writing something new, follow the principles below. When revising an existing document, apply them only to the places §3 decided to fix, and only within what the original contains. Never add content to satisfy a principle. For example, if the original does not say 「次にすべきこと」, do not write it in for principle 12. In particular, keep the degree of certainty (principle 10) and the split between fact and opinion (principle 11) as in the original, and change only how they are expressed. Turning 「〜と思われます」 into 「〜と推定する」 is fine; turning it into an assertion is not. When principles conflict, choose the one that actually helps the reader understand.

1. Lead with the conclusion. A preamble such as 「本稿では〜について解説する」 tells the reader nothing. Put the conclusion in the title or the first sentence, and in a long document summarize the conclusion and the main numbers in a few sentences right after it.
2. Write the section's conclusion in its heading (§1).
3. Write causes and sequences in running prose. Bullets erase the 「だから」 and 「しかし」 between items, leaving the reader to supply the relations. Use bullets when items truly stand alone side by side, like a list of action items with owners and due dates. For example, if 「・在庫が減った ・通知が出た ・担当が見落とした ・欠品した」 hides the relation 「通知は出たが見落とした」, write 「在庫が減って通知は出たが、担当が見落として欠品した」. If the original or the material does not state the relation, do not add one.
4. Explain what a technical term does before giving its name. Readers remember a name more easily once it is tied to a phenomenon they know. A short parenthetical explanation at first use is enough.
5. Support abstract claims with proper nouns, numbers and real examples. When material is missing, do not fill it with guesses; write what would need checking to write it, and leave the gap.
6. Use bold only for the spots that truly need to stand out in the whole document. Bold in every paragraph makes nothing look emphasized. Do not decorate with emoji or symbols either: in work documents decoration adds no information and only scatters the reader's eye.
7. Vary density (§1).
8. Do not repeat the same mold three times. When a definition-sentence pattern, the internal build of a section, or a sentence opening appears three times in a row, change at least one. Repeating the structure you chose first is easier, so this habit tends to survive to the end. Change it to fit the content — swap sentence order or subjects, merge two sentences into one. Do not insert questions or noun-ending sentences (体言止め) as a device to break the pattern.
9. Use negation (「〜ではなく〜」「〜ではない。〜だ。」「〜わけではない」) only where readers would actually misunderstand, and where it is needed as a fact or caution. Negating for rephrasing or emphasis makes the construction louder than the content. GPT-family models in particular write many sentences that pre-emptively deny assumptions nobody voiced (§3).
10. Do not blur the degree of certainty with sentence endings; distinguish it. Assert what can be asserted, write a guess as 「〜と推定する」, and mark the unconfirmed as 【要確認】. Scattering 「〜と思われます」 through the whole text leaves the reader unable to tell what is certain from what is not.
11. Separate fact from opinion. Attach a source or data to facts, and name the speaker of an opinion, as in 「筆者は〜と考える」. Both can be written as 「〜だ。」, so the sentence ending alone does not tell them apart. Do not write as fact anything whose source you cannot show.
12. In the close, do not repeat the summary of the body; condense the key points into one or two sentences. In a research report, write what should be done next based on the results. Write next steps from the material or the user's thinking. When you write a proposal you derived from the material yourself, make it recognizable as a proposal (「〜を提案する」). Do not propose beyond what the evidence supports. In documents that have their own path to what comes next, such as guides and minutes, a closing paragraph may not be needed at all.

Sentence-level rules: keep です・ます or である style consistent within a document. One claim per sentence. Aim for 50–60 characters per sentence, but do not cut a sentence that grew long because it states the actor or the relations between words explicitly just for its length. Put long modifiers before short ones. Keep subject and predicate close.

Adjust how the principles apply by genre. Technical documents hold most strictly to one idea per sentence and consistent terminology. Business documents prioritize putting the conclusion at the top. Essays may deviate — leaving things unsaid for an aftertaste, putting the conclusion last — and that is accepted as the writer's intent. Official documents and documents for general readers without specialist knowledge use short sentences, avoid loanwords and double negatives, and state the subject.

## 3. Revising an existing document

Do not change how you revise based on whether a human or an AI wrote the document. It is hard to tell from the text, and documents written by newer models draw few lint findings. Sort what to fix into three groups: what you always fix, what you fix only with a reason, and what you never do in any document.

### What you always fix

- Staging and exaggerating words. Remove them by deletion only (next subsection)
- Phrases lint flagged. Each finding says how to fix it
- Unneeded negation (next subsection)
- Spots that add work for the reader. The following five can be fixed without adding content, so fix them
  - Redundant wording that adds characters without adding information. Shorten it (「〜という形で進めていく予定です」 → 「〜で進める予定です」)
  - Sentences holding two or more claims. Split them by claim
  - Lists and paragraphs where it only becomes clear later what the list or paragraph is about. Show the frame first, in the original's words (if the list is followed by 「〜といった点に注意した。」, put 「注意したのは次の点だ。」 before the list)
  - Headings whose content cannot be guessed, such as 「〜について」. Using words from the body, make it clear what the section says. Do not give every heading the same shape
  - Key terms of the document left unexplained. Within what the original supports, add a short explanation at first use (「SLA(サービスの品質を保証する取り決め)」)
- Wording that makes the reader stop and ask 「具体的に何のこと?」 (next subsection)

Lint barely detects spots that add work for the reader. Reading the document through, you will judge it 「もう読みやすい」 and miss them, so check paragraph by paragraph. At the end of lint's output, under 「段落ごとの確かめ」 (paragraph-by-paragraph check), every heading, bullet item, table row and prose paragraph is listed with a number and line number. For every paragraph, write out anything matching the five kinds above or wording the reader cannot pin down (next subsection) in the form 「番号: 言い回し → 指しているもの」 (number: wording → what it refers to). For a paragraph with nothing, write 「番号: なし」. Do not start fixing until you have written out the last paragraph. Do not skip this even in quick mode. Fix what you wrote out and, as with lint findings, record whether you fixed it or, if you kept it, why (§4). `uv run scripts/paragraphs.py <file>` prints the same list.

When revising a heading or a summary at the top of the original, do not drop the body's conditions. A conclusion stripped of its conditions becomes a stronger claim than the original. If the body says 「年間契約で、月の利用が100回を超えるユーザーは割引の対象になる」, do not make the top 「よく使うユーザーは割引になる」. Write the conditions into the top summary too, splitting it into two sentences if it gets long. Headings must be short to be readable, so make a heading only of a conclusion that holds without conditions, and for a section with involved conditions keep to a heading that names the topic, such as 「割引の対象」.

Make no other rewordings. Do not replace words lint did not flag with words that seem more natural (do not turn 「気軽に試せます」 into 「簡単に試せます」, or 「お知らせいたします」 into 「お知らせします」).

### Turn wording the reader cannot pin down (読み手が何のことか取れない言い回し) back into everyday words

AI-written text mixes in wording that blurs its content with metaphor or paraphrase. The writer holds the exact content but writes it in loose words or literal English, so the reader has to reconstruct the content by guessing. The model that wrote it finds this natural, so reading the document through misses it. It is especially common in text that explains what code does, such as technical articles and PR descriptions.

To find it, take one paragraph at a time, look at every verb and noun in it, and ask: "Can I name the concrete thing this word points to, using facts and names found in the original or the code?" If you can, yet the text uses a word that admits more readings than that, it falls under one of the following. Fix what falls under them.

1. Wording whose content is invisible: saying what happens through a metaphor, so the reader stops and asks 「具体的に何のこと?」 (「この変更はチームの重心を移す」). Treat any wording whose meaning cannot be grasped the same way, metaphor or not
2. Renaming something that already has a name: calling a code behavior, a column or state, or a word used earlier in the same document by a word with more than one reading (in 「支払いの済んでいない注文が宙に浮く」, 「宙に浮く」 does not settle whether the order stays awaiting payment or is no longer referenced from anywhere). Within one document, do not call something you have named by a different word; readers take it to mean something else
3. Personification: treating a non-person (a file, data, a market, a mechanism) as a person or living thing (「設定ファイルが育っていく」「データが語っている」)
4. Word-for-word translation of an English expression that Japanese does not normally use (low-hanging fruit as 「低くぶら下がった果実」, break as 「既存の利用者を壊す」, source of truth as 「真実の源」). Words engineers use often still count if they replace an English expression one word at a time. If the material has the ordinary expression, use it
5. Misaligned collocations: a noun–verb pairing that everyday Japanese does not have (「期限が終了する」 is 「期限が切れる」; 「リスクを踏む」 is 「リスクを負う」). This tends to happen when a native Japanese word is replaced with a Sino-Japanese one
6. Engineers' spoken idiom carried straight into writing (「ログを吐く」「サーバーが死ぬ」「処理を別のキューに投げる」). It works in conversation but blurs in a document what actually happens. Write the action plainly, as 「出力する」「止まる」「渡す」
7. Nominalized actions that erase who does what (in 「重複登録が起きうる点の対処」 it is unclear what gets fixed and how; write 「同じ利用者が二重に登録されないように直す」)

Types 4, 5 and 7 look natural both to the model that wrote them and to a model re-reading them, so impressions will not find them. Check them with these hands-on tests.

- Translate back into English. For Sino-Japanese compounds, and for everyday words describing technical behavior, try putting them into English. If the result is a fixed English expression replaced one word at a time, it is type 4 (「一級市民として扱う」 is first-class citizen, 「優雅な劣化」 is graceful degradation, 「端のケース」 is edge case). Exclude translations established in the field (such as 「依存性の注入」)
- Rewrite noun sentences as verb sentences. Where an action is packed into a noun — 「〜は未着手です」「〜の対応」「〜の検討」 — rewrite it as a sentence about who does what. If the rewritten sentence makes the action clearer, it is type 7 (「権限の整理は未着手です」 can be written 「権限を誰に付けるかは、まだ決めていません」)
- Check whether you would say the noun–verb pairing in everyday conversation. If not, it is type 5. Check especially where a native word was replaced with a Sino-Japanese one (「消える」 → 「消失する」, 「切れる」 → 「失効する」)

Do not fix expressions that call up a concrete image and are used in ordinary work writing (「目を通す」「手を打つ」「腰を据える」 and the like). Do not fix established idioms, quotations of a speaker's words, or usages established as terms in the field. Do not fix technical expressions that are established and have a single reading (「キャッシュが効く」). Whether something is established is decided by whether it is used in written language such as specifications and reference documentation; being common in engineers' conversation does not count. The same word is fixed when used with an unsettled reading. Do not fix a metaphor whose content is stated in the same sentence (「バックアップを毎晩取っているので、データは守られる」). When odd wordings follow one another within a paragraph, readers pile up 「どういうこと?」 and lose the will to read, so look at all of them in the paragraph together, not just one.

How to fix:

- Write the content the metaphor was carrying in everyday words, using only what the original says (「設定ファイルが育っていく」 → 「設定ファイルに項目が増えていく」; 「低くぶら下がった果実から取る」 → 「すぐできるものから手を付ける」)
- Write things that already have a name by that name. For code behavior, write what is fetched, what goes into which column, and what is not executed. If the material or the code has the ordinary expression, return to it
- Do not change the connotation (direction and strength of evaluation) or the breadth of meaning. Do not change the kind of sentence (fact, opinion, proposal, hypothesis, hearsay) or the degree of certainty either
- Do not replace with stiff Sino-Japanese words. Turning 「育っていく」 into 「拡充される」 creates a different unnaturalness
- An AI-written metaphor may have no content even for its writer. If the surrounding context narrows it to one reading, fix it to that reading and always state in your report how you read it (「『重心を移す』を、前後の担当表から『担当の範囲を変える』と読んで直した。優先順位を変えるという意味なら、そう直す」). The user sees the fixed sentence and the stated reading and can choose again if it is wrong
- When context does not narrow the reading (two or more readings are about equally plausible), do not fix it. List the candidate readings and ask the user which one to use

### Keep only negation that carries content

Negation comes in three kinds, handled differently. Lint's `negation_repetition` and `antithesis_repetition` flag overuse.

- Sentences that pre-emptively deny an assumption nobody voiced, often in the form 「〜するだけで自動的に〜わけではない」 (「ただし、CI を入れれば、自動的にバグがなくなるわけではありません。」). What it means to say is usually in the next sentence, so delete the whole sentence. Keep it if deleting it breaks the link to the next sentence
- Deny-then-restate in the form 「AはBではない。Cだ。」. Delete the negated part and connect the subject to the affirmative sentence. Add no new words
  - Good example: 「コードレビューは、粗探しの場ではありません。設計の意図をチームで共有する機会です。」 → 「コードレビューは、設計の意図をチームで共有する機会です。」
- Negation with content: narrowing the meaning of a vague word (「ここでいう『軽い』は、ファイルの大きさではなく、起動するまでの時間のことだ」), stating an easily misunderstood fact (「SQLite は、別のプロセスとして動くデータベースサーバーではありません」), or needed as a caution (「環境変数に入れたという理由だけで、秘密が守られるわけではありません」). Keep these. Keep contrasts that explain a difference (「ファイル全体を送り直すのではなく、変わった部分だけを送る」) too, since deleting them breaks the explanation

### Remove staging words by deletion only

AI-written text often mixes in words that only raise the tone without adding content: exaggeration (「徹底的に」「例外なく」「劇的に」), overblown descriptions of scenes or bodily reactions (「警告音が頭の中で鳴り続ける」「背筋が凍る」), direct appeals to the reader (「あなたにも経験がないだろうか」), and so on.

Delete these only when the sentence still says the same thing without them. Do not reword them or compensate with other words. Make 「圧倒的に多くの利用者」 into 「多くの利用者」, not 「非常に多くの利用者」. Adding new words or sentences invites new staging. After deleting, check that what remains is grammatical; if not, keep it instead of deleting. For example, deleting just 「他ならない」 from 「〜の放棄に他ならない」 breaks the sentence. A sentence carrying only emotion and no fact (「……背筋が凍った。」) may be deleted whole.

- Good example: 「設定ファイルの書き方を徹底的に解説する。」 → 「設定ファイルの書き方を解説する。」 (only 「徹底的に」 deleted)
- Good example: 「テストのないプロジェクトは、例外なく保守が難しくなる。」 → 「テストのないプロジェクトは、保守が難しくなる。」 (only 「例外なく」 deleted)
- Example of what not to do: turning 「『どの設定が使われているのか』『どこを直せばよいのか』が一切わからない。」 into 「どの設定が使われているのか。どこを直せばよいのか。手がかりは何もない。」. It splits the questions into short sentences and closes with a punchline not in the original (「手がかりは何もない。」) — adding staging rather than removing it

When the user has indicated the narrative voice is intentional, as in an essay, do not make this fix.

### What you fix only with a reason

Make structural changes — swapping bullets and running prose, reorganizing paragraphs, changing the number or order of headings — only when the user asks, or when you can say concretely that without the change readers will misread the content or fail to find it. Applying the same kind of conversion to every item erases the natural unevenness of the original and makes it look more mechanical. In a blind evaluation, a revision that rewrote every heading into a conclusion beat the original on value to the reader but lost on whether it looked human-written.

- If you restructure, list the original's headings and sections before starting and mark each keep or change. The default is keep. If change exceeds 30% of the whole, record the reason (§4)
- Rewrite headings into conclusions in at most 2–3 places, where opening the section to look for its content costs the most
- Turn bullets back into prose only where they hide causes or sequences. Leave bullets that readers scan later for a specific item, such as lists of advice or action items
- Do not convert line-by-line writing into bullets unasked

When splitting a sentence, use the original's words and do not add connecting words between the sentences that the original did not have (「しかし」「ただ」「その結果」「そこで」「そのため」). The original's 「〜が」「〜ので」「〜ため」 may be used.

### What you never do in any document

- Add content not in the original (the top rule). This includes writing in the writer's views or policies and turning 「未定」 into an assertion. Do not add filler sentences without content (「以下で詳しく見ていきます。」) either. A sentence that frames what comes next in the original's words is not this
- Add a new summary section the original does not have (「この文書の要点」「まとめ」 and so on). Keep where the conclusions and key points sit as the original arranges them; if you think putting them at the top would make them easier to find, propose that to the user. Framing a list with one sentence before it ("What you always fix") is not this
- Supply who a subjectless sentence is about. In minutes especially, mistaking who said or did something makes the record wrong. Where it is unclear who is meant, do not supply it; tell the user
- Change numbers. Even if the original's numbers disagree (it says 「次の3点」 and lists four), do not fix them; tell the user
- Add concrete examples or numbers of your own to a paragraph that only states generalities. Tell the user what material would make it concrete
- Delete claims, examples, grounds, exceptions or conditions. Delete only repetition that adds no information. A sentence with a new implication (a condition or consequence) is not repetition even if it looks similar. When in doubt, keep it
- Fill a missing required element of the document type with boilerplate. Consider whether the document truly needs it; if so, write it from the original's content. If there is no content, ask the user
- Flatten the writer's habits. Quotations of speech (such as 「それ先に言ってよ」), the level of honorifics (「いたします」「させていただきます」), emoji and emoticons, arrows and shorthand, notation habits, line-break-separated writing (do not join lines into one sentence), and unevenness between sections stay as long as they do not hinder reading. Flattening these traces produces a document nobody could have written

## 4. Mechanical detection with lint

```
uv run scripts/lint.py --json <file>
```

It detects forbidden phrases, translationese, overuse of 「〜ではなく」, monotonous sentence length, a total absence of noun-ending sentences, recycled vocabulary, literal English syntax, and more. If the document's genre is known, pass `--genre essay|tech|business` for thresholds suited to that genre and fewer false positives.

Lint findings are suspicions, not orders to fix everything. Each finding's explanation says what it suspects and how to fix it. Decide against the context whether to fix or keep. When unsure, read the sentence aloud and decide by whether it is close to how a person would say it.

Go through the findings recording, for each, that you fixed it or, if you kept it, a one-word reason. Reasons like 「固有名詞の一部」「文脈上必要」「技術用語」「ジャンル上自然」 are enough. A "keep" with no reason is the same as not having judged, so avoid it. Writing the record in your response is enough. If you make it a file, follow §7.

```
- [直した] translationese「〜という点で」: 「〜では」に言い換えた
- [残す/固有名詞] forbidden_phrase「多角的」: 製品名「多角的レビュー機能」の一部
```

Which lint to run: `uv run scripts/lint.py` (Sudachi) is the default, because only it carries this version's detectors and the paragraph-by-paragraph list §3 requires. Where `uv` is unavailable but `node` is, `writeup-kit`'s Node lint (`${DOTFILES_ROOT:-$HOME/dotfiles}/harness/tools/writeup-kit/bin/lint.mjs <file> --json`; same JSON shape, `--baseline` works, `--config` auto-discovers `.writeup.toml`) is a fallback. It is a port of an older version of this lint with fewer detectors, IPADIC instead of Sudachi, and no paragraph list, so with it write the paragraph list for §3 by hand. Where neither runs (Claude.ai and the like), check the same points by eye following `references/manual-checklist.md`.

`scripts/semantic.py` is an optional, experimental detector that measures the flatness of topic from how similar adjacent sentences are in meaning. It downloads a model of about 1GB on first run, so run `uv run scripts/semantic.py --json <file>` only in full mode when the environment allows, and treat its findings like lint's.

## 5. Check structure and readability

Lint only looks at the surface of sentences. In bullet-heavy minutes and slides it detects almost nothing, so check the structure separately.

### Structure check (構造の点検)

Read only the headings and the first sentence of each paragraph in order and check the following. `uv run scripts/outline.py <file>` extracts headings, each paragraph's first sentence and bullets with line numbers.

1. Can the argument be followed from the headings and first sentences alone?
2. Does each heading state a conclusion?
3. Does the same mold (definition-sentence pattern, section build, opening sentence pattern) repeat?
4. Does density vary between sections?
5. Does the reader have to wait until the second half for the conclusion they want? Apart from explaining facts, does the text make the reader follow a plot like 「思い込み→異変→種明かし→回収」? In incident investigations where the sequence itself is evidence, and in essays about a process of discovery, the chronology may stay
6. Does the close lead to what should be done next? (For newly written reports. When revising, check only if the original contains it)

Once the document type is settled, also check against the required elements and typical AI failures in its doctypes file.

### Readability check (読みやすさの点検)

`uv run scripts/lint.py --reading-load <file>` points at spots likely to be hard to read (overlong sentences, lists buried in a sentence, long kanji runs, double negatives, chains of 「の」, 「〜することができる」). This is a separate check from AI-likeness detection; it enters neither the naturalness score nor the `--baseline` comparison. Fix the sentences it points at if they add work for the reader (§3).

Check in this order. Earlier items weigh more heavily on the reader.

1. Nested negation and conditions. Straighten double negatives and nested conditions. After folding, always check that truth values and conditions correspond to the original. 「設定が無効でない限り」 and 「設定が有効なら」 differ in how the unset case is handled. Where the writer deliberately avoids an assertion, leave it alone if it cannot be folded without changing the meaning
2. Distance in modification. Split a sentence with two or more claims. Check that subject and predicate are not so far apart that they twist, and that long modifiers come first. Put commas at the sentence's structural breaks. Split sentences running 「〜が、〜が、」. Check that 「これ」 and 「それ」 resolve to one referent from the preceding sentence
3. Word weight. Seven or more kanji in a row hide word boundaries, so open them up with hiragana. Where 「の」 appears three or more times in a row, or actions are nominalized as in 「〜の実現」「〜への寄与」, who does what is hard to see, so return to verbs. If a run of passives hides the actor, bring the actor out. Replace katakana words whose meaning varies by reader with native or Sino-Japanese words
4. Redundant wording. 「〜することができる」 → 「〜できる」, 「〜という形になる」 → 「〜になる」. These add characters without information, so delete only; add nothing
5. Paragraphs. Avoid both long unbroken blocks, where readers cannot tell where to pause, and one-sentence fragments, which cut connected logic
6. Lists buried in a sentence. Only when there are three or more coordinate items and the sentence has grown long, open them into bullets. Avoid making each item 「太字: 説明」; that shape is itself the typical look of an AI-written document
7. Repetition across paragraphs. For paragraphs restating the same thing, delete only the parts that add no information (§3)
8. Inconsistent notation. Write the same thing the same way. `uv run scripts/terms.py <file>` lists where each technical term first appears and whether it is explained
9. Structure and the reader's knowledge. Fix structures where the conclusion never appears until the end, and technical terms used without explanation

Shortness is not a goal in itself. First check that the needed facts remain and that subjects match predicates and modifiers match what they modify. Only between candidates equal on those two, choose the shorter. Splitting sentences or opening lists so that the character count grows is a correct result.

## 6. Convergence and finishing

After applying your fixes, run lint again. Passing the previous `--json` output as `--baseline` sorts findings into resolved, new and persisting, so you only need to look at new and persisting. Convergence is when every finding is sorted into "fixed" or "kept (reason)" and the fixes produced no new findings. Set no number of passes; stop when this state is reached.

If the same finding recurs twice in a row, more rewording will not converge. Rewrite the sentence or paragraph's structure, or keep it with a reason.

Once converged, finish by laying the revised document beside the original and checking that no fact, number, evaluation or policy absent from the original crept in (the top rule). For a newly written document, check for facts not in the material. Even newly written documents tend to blur content with wording the writing model finds natural (writing with a noun as subject and not saying the content, as in 「三つの論点が浮かび上がる」). Check and fix paragraph by paragraph using the method in §3 "Turn wording the reader cannot pin down back into everyday words".

After revising an existing document, the following commands list the numbers, proper nouns and Latin-alphabet words that appear only in the revised document. If the original remains as a separate file, compare against it. If you rewrote a git-tracked file in place, `--git` compares against the content of the last commit. Only when neither applies — rewriting an untracked file in place — copy the original into a working directory before revising (§7).

```
uv run scripts/newfacts.py <元の文書> <直した文書>
uv run scripts/newfacts.py --git <直した文書>
```

If a word it picks up is a fact not in the original, delete it or restore the original content. A supplement that follows directly from the original, such as the full name of an abbreviation, may stay. The script picks up only newly appearing numbers, proper nouns and Latin-alphabet words; it cannot catch details added with ordinary nouns, changes in the degree of certainty, or swapped speakers. Even when it finds nothing, do not skip checking by eye.

## 7. Cleanup

Do not put intermediate files made during the work (lint JSON, the record of fixes, copies of the original, draft backups and so on) in the same directory as the target document. Put them in the environment's scratchpad if there is one, otherwise in a temporary directory made with `mktemp -d`. When done, delete the temporary directory with everything in it, so working files do not mix into the user's project. The only things left in the user's project are the finished document and, only when the user explicitly wanted it, `style-profile.md`.

## English text

When asked to remove AI smell from English text, refer to `references/patterns-en.md` (a catalog of English AI-writing patterns).
