# English AI-Writing Tells — Pattern Catalog

Source levels are marked: **[peer-reviewed]** (journals / top conferences),
**[preprint]** (arXiv), **[vendor]** (detector vendors, company blogs — trend-indicative,
not rigorous statistics). Trust peer-reviewed vocabulary findings most; treat exact
multipliers from vendors as directional.

## 1. Overused Vocabulary [peer-reviewed]

The single hardest evidence: after ChatGPT's release (late 2022), word frequencies in
scientific writing jumped discontinuously. Kobak et al. borrowed the "excess mortality"
method to measure "excess vocabulary" across 15M+ PubMed abstracts and found 2024's excess
words were **almost entirely style words** (66% verbs, 18% adjectives).

**Highest-signal words (verbs/adjectives/adverbs):**

```
delve / delves / delving   showcasing / showcases   underscore(s) / underscoring
intricate / intricacies    meticulous / meticulously  pivotal   boast(s)
tapestry   testament (to)   commendable   surpass(ing)   garnered   realm
groundbreaking   advancements   comprehending   aligns (with)   notably
```

Measured frequency multipliers (human → LLM-era):
- `delves` ~25× (Kobak et al.)
- `meticulous` 34.7×, `intricate` 11.2×, `commendable` 9.8× (Liang et al., peer-review corpora)
- `showcasing` ~9×, `underscores` ~9× (Kobak et al.)

High-impact marker set often flagged together:
`across, additionally, comprehensive, crucial, enhancing, exhibited, insights, notably,
particularly, within`

**Fix:** swap for the plain word. `delve into` → `look at / dig into / examine`.
`underscores` → `shows / points to`. `intricate` → `complicated / detailed`.
`leverage` → `use`. `utilize` → `use`. `a testament to` → cut or `shows`.

**Cause [preprint]:** RLHF preference amplification, not training data — annotators under
time/reward pressure favored these words as proxies for "good writing," and the loop
amplified them (Juzek & Ward 2025; arXiv:2508.01930). Practical upshot: it's a *style
default*, so it's safe and correct to strip.

## 2. Formulaic Phrases

- Openers: `It's important to note that`, `In today's fast-paced world`, `In the realm of`, `When it comes to`
- Fillers: `plays a crucial role`, `plays a vital role`, `it is worth mentioning`, `a wide range of`, `aims to`
- Closers: `In conclusion`, `Overall`, `In summary` followed by a restatement that adds nothing
- Transitions placed mechanically at fixed intervals: `Furthermore`, `Moreover`, `Additionally`, `On the other hand`

`testament to` appears at extreme frequency across instruction-tuned models
(AI Brown/AI Koditex corpus, arXiv:2509.22996 [preprint]). Exact multipliers like
`today's fast-paced world` ~107× are **[vendor]** aggregations (ai-text-humanizer.com),
directionally consistent with the peer-reviewed vocabulary results.

**Fix:** delete the opener/closer scaffolding entirely. Start with the actual point; end on
the actual point. Keep at most a fraction of the transitions and let sentence logic carry
the rest.

## 3. Structural Tells

**[peer-reviewed]** (Muñoz-Ortiz et al. 2024, *Artificial Intelligence Review*):
- **Uniform sentence length** — humans scatter; LLMs cluster at 10–30 tokens. This is the
  linguistic basis of "low burstiness."
- **Lower lexical diversity** (STTR: human 0.491 > LLaMa ~0.46 > Falcon 0.424).
- POS skew: LLMs use more numerals/symbols/auxiliaries/pronouns, fewer adjectives/nouns/punctuation.

**[vendor/blog]** (Bloomberry research):
- **Tricolon / rule-of-three lists** signalling false completeness ("fast, reliable, and scalable").
- Claimed "four-fingerprint" pattern: hedge openers → tricolon lists → em-dash asides → resolution closers.

**Fix:** vary sentence length deliberately — follow a long sentence with a short one.
Break rule-of-three into two, or four, or one. Cut list items that exist only to hit three.

## 4. Punctuation & Formatting [vendor / blog — directional]

- **Em dash overuse (—)**: AI uses ~3–5× the em dashes of an average human; widely called
  the most reliable single tell (Plagiarism Today 2025, and corpus blogs). *Trim to the one
  or two that genuinely help; convert the rest to commas, periods, or parentheses.*
- **Too-perfect punctuation/grammar**: near-zero typos reads as machine. (Peer-reviewed
  backing: LLMs use *less* punctuation overall — Muñoz-Ortiz et al.)
- Curly quotes “ ” from copy-paste, emoji section headers (✅ 💡 🚀), Oxford-comma uniformity.
- **Bold overuse for emphasis** — bold appearing every paragraph reads as template. Humans bold rarely (0–1 per section).
- **Inline `code` overuse** — backticks on identifiers/commands is correct; backticks on ordinary words for emphasis (`important`, `key point`) is an AI tell. LLMs over-format.

## 5. Tone Tells

- **Neutral / mildly positive flattening**: rewrites pull sentiment toward center; LLMs skew
  positive and avoid strong negative emotion (Muñoz-Ortiz et al. [peer-reviewed]; Originality.AI [vendor]).
- **Over-hedging**: significantly more hedge terms than humans (`may`, `could`, `some argue`,
  `it depends`) — arXiv:2509.12102 [preprint].
- **Meta-commentary / servile politeness**: `Certainly!`, `I hope this helps`, `As an AI
  language model`, `Great question!` — RLHF tone bias, systematic and measurable
  (arXiv:2512.19950 [preprint]).

**Fix:** take a position. Replace "there are pros and cons" with the actual recommendation.
Cut the meta-politeness. Let one strong claim stand without three hedges around it.

## Primary Sources

**Peer-reviewed / top venues (highest confidence):**
1. Kobak D. et al. (2025). *Delving into LLM-assisted writing in biomedical publications through excess vocabulary.* Science Advances 11(27). arXiv:2406.07016 — https://arxiv.org/abs/2406.07016
2. Liang W. et al. (2024). *Monitoring AI-Modified Content at Scale (ICLR/NeurIPS peer reviews).* ICML 2024. arXiv:2403.07183 — https://arxiv.org/abs/2403.07183
3. Juzek T. S. & Ward Z. B. (2025). *Why Does ChatGPT "Delve" So Much?* COLING 2025. arXiv:2412.11385 — https://arxiv.org/html/2412.11385v1
4. Muñoz-Ortiz A. et al. (2024). *Contrasting Linguistic Patterns in Human and LLM-Generated News Text.* Artificial Intelligence Review. PMC11422446 — https://pmc.ncbi.nlm.nih.gov/articles/PMC11422446/

**Preprints (medium confidence):**
5. *AI Brown and AI Koditex: LLM-Generated Corpora.* arXiv:2509.22996 — https://arxiv.org/pdf/2509.22996
6. *QUDsim: Quantifying Discourse Similarities in LLM-Generated Text.* arXiv:2504.09373
7. *Word Overuse and Alignment in LLMs (RLHF).* arXiv:2508.01930

**Vendor / blog (directional only, not rigorous stats):**
8. GPTZero — perplexity & burstiness — https://gptzero.me/news/perplexity-and-burstiness-what-is-it/
9. Bloomberry — sentence-level AI patterns — https://www.bloomberry.ai/research/how-ai-detects-your-writing
10. Plagiarism Today — em dashes & spotting AI (2025) — https://www.plagiarismtoday.com/2025/06/26/em-dashes-hyphens-and-spotting-ai-writing/
