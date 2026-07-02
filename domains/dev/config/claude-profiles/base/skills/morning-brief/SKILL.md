---
name: morning-brief
description: "Daily morning briefing - collects trending topics across tech, AI, politics, gaming, finance, design, business, hardware, and more. Outputs structured digest with analysis and personal insights."
---

# Morning Brief - Daily Intelligence Digest

今日のトレンドを多領域から収集し、構造化されたモーニングブリーフィングを生成する。
読了目安: 10-15分。情報の羅列ではなく「なぜ注目すべきか」の分析が主軸。

---

## Step 1: ブロックソースの事前取得

Claude CodeのWebFetchでブロックされるソース（Reddit, NHK, IGN Japan）を先にスクリプトで取得する。

```bash
SCRIPT=~/.claude/skills/morning-brief/scripts/fetch_blocked_sources.py
[ -f "$SCRIPT" ] || SCRIPT=~/go/github.com/esh2n/dotfiles/domains/dev/config/claude-profiles/base/skills/morning-brief/scripts/fetch_blocked_sources.py
python3 "$SCRIPT" > /tmp/morning-brief-blocked.json
# 出力が空/実行失敗なら黙殺せず報告する(該当ソースをスキップする旨をユーザーに伝えて続行)
[ -s /tmp/morning-brief-blocked.json ] || echo "WARN: blocked-sources取得に失敗。Reddit/NHK/IGNをスキップして続行"
```

結果は `/tmp/morning-brief-blocked.json` に保存される。このファイルをReadツールで読み込んで後続ステップで使う。

---

## Step 2: 3グループ並列でニュース収集

以下の3グループを**並列実行**すること。Agentツールで3つのサブエージェントを同時起動する。

### グループA: WebFetch直接取得（API/RSS）

以下のURLをWebFetchで取得し、記事タイトル・URL・スコア/ブクマ数を抽出する。

| ソース | URL | 形式 | 抽出対象 |
|--------|-----|------|----------|
| はてブ 総合 | `https://b.hatena.ne.jp/hotentry.rss` | RSS 1.0 | title, link, hatena:bookmarkcount |
| はてブ テクノロジー | `https://b.hatena.ne.jp/hotentry/it.rss` | RSS 1.0 | 同上 |
| はてブ 政治経済 | `https://b.hatena.ne.jp/hotentry/economics.rss` | RSS 1.0 | 同上 |
| はてブ ゲーム | `https://b.hatena.ne.jp/hotentry/game.rss` | RSS 1.0 | 同上 |
| はてブ エンタメ | `https://b.hatena.ne.jp/hotentry/entertainment.rss` | RSS 1.0 | 同上 |
| Zenn トレンド | `https://zenn.dev/api/articles?order=daily&count=20` | JSON | title, path, liked_count, user.name |
| Qiita 人気 | `https://qiita.com/api/v2/items?page=1&per_page=20&query=stocks:>10` | JSON | title, url, likes_count, tags |
| Hacker News Top | `https://hacker-news.firebaseio.com/v0/topstories.json` | JSON | IDリスト→上位10件を個別取得 |
| Google News 日本 | `https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja` | RSS | title, link |
| Yahoo!ニュース | `https://news.yahoo.co.jp/rss/topics/top-picks.xml` | RSS | title, link |
| 4Gamer | `https://www.4gamer.net/rss/index.xml` | RSS 1.0 | title, link |
| AUTOMATON | `https://automaton-media.com/feed/` | RSS 2.0 | title, link |
| GIGAZINE | `https://gigazine.net/news/rss_2.0/` | RSS 2.0 | title, link |
| PC Watch | `https://pc.watch.impress.co.jp/data/rss/1.0/pcw/feed.rdf` | RSS 1.0 | title, link |
| ITmedia NEWS | `https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml` | RSS 2.0 | title, link |
| Yahoo Finance | `https://finance.yahoo.com/news/rssindex` | RSS | title, link |
| Google News 株式 | `https://news.google.com/rss/search?q=株式市場+OR+日経平均&hl=ja&gl=JP&ceid=JP:ja` | RSS | title, link |

**Hacker News の個別記事取得方法:**
topstories.json から上位10件のIDを取得し、それぞれ `https://hacker-news.firebaseio.com/v0/item/{id}.json` で title, url, score, descendants を取得。

### グループB: スクリプト結果の読み込み

Step 1 で取得済みの `/tmp/morning-brief-blocked.json` をReadツールで読む。
内容: Reddit (7サブレディット), NHK NEWS (6カテゴリ), IGN Japan

### グループC: WebSearch（検索でしか取れないもの）

以下の検索を実行:

1. `X Twitter 今日 バズ 話題 エンジニア 技術` — Xでの技術系バズ
2. `X Twitter 今日 話題 トレンド 日本` — Xでの一般トレンド
3. `AI LLM news today 2026` — AI/LLM最新動向
4. `product management news today 2026` — PM/プロダクト系
5. `UI UX design news today 2026` — デザイン系
6. `startup funding news today 2026` — スタートアップ/ビジネス
7. `Blender 3D modeling news 2026` — 3Dモデリング（話題があれば）
8. `スペシャルティコーヒー ニュース 2026` — コーヒー（話題があれば）

---

## Step 3: 重複排除

以下のルールで重複を排除:
- 同一URLの記事は1つにまとめる
- 同一トピックが複数ソースに出ている場合、最もスコア/ブクマ数が高いソースを主とし、他ソースは「他: [source名]でも話題」と記載
- 過去のブリーフィングがある場合 (`~/.claude/skills/morning-brief/archive/` 配下)、直近7日分のURLと重複するものは除外

---

## Step 4: カテゴリ分類と記事選定

全記事を以下のカテゴリに分類し、重要度順に選定する。
件数に上限は設けない。重要な記事が多い日は多く、少ない日は少なくて良い。
その日に該当記事がないカテゴリはスキップ。

### コアカテゴリ（毎日収集）

| カテゴリ | スコープ |
|----------|----------|
| Tech | 言語、アーキテクチャ、OSS、インフラ、DDD、設計思想、セキュリティ |
| AI / LLM | モデルリリース、ツール、エージェント、規制、研究 |
| Product / PM | プロダクト戦略、ユーザーリサーチ、グロース、PM論 |
| Design | UI/UX、デザインシステム、Figma、デザインツール |
| Business | スタートアップ、営業、マーケティング、経営戦略、資金調達 |
| Politics | 国内政治、国際情勢、選挙、法規制、外交、経済政策 |
| Gaming | ゲーム業界、新作、ゲームデザイン、eスポーツ |
| Hardware | デバイス、半導体、ガジェット、自作PC |
| Finance | 株価、暗号資産、マクロ経済、為替 |

### サブカテゴリ（話題があれば）

| カテゴリ | スコープ |
|----------|----------|
| Creative | Blender、3Dモデリング、動画編集、映像制作 |
| Coffee | 焙煎、器具、スペシャルティコーヒー、カフェ文化 |

---

## Step 5: 記事フォーマット

各記事を以下のフォーマットで記述する。**情報の羅列ではなく分析が主軸**。

```markdown
### [日本語の見出し — キャッチーかつ正確に]
**Source**: [ソース名](URL) | YYYY-MM-DD
**Category**: [カテゴリ名]
**Buzz**: [はてブ数 / Reddit score / Likes数 など、あれば]

[何が起きたか — 具体的な事実を3-5文で。数字、固有名詞、技術的な詳細を含める。
曖昧な表現や一般論は禁止。「〜が注目されている」ではなく「〜が〜の理由で〜件のブクマを集めた」。
背景にある文脈やトレンドとの接続も書く。]

**あなたへの示唆**:
[この記事があなた（広い視野を持つエンジニア）にとってなぜ重要か。2-3文。
以下のいずれかの観点で書く:
- 日々の技術的意思決定にどう影響するか
- キャリアや成長にどう関係するか
- チームや組織の動きにどう活かせるか
- 世界の見方がどう変わるか
抽象的なアドバイスではなく、具体的なアクションや考え方の転換を提示する。]
```

---

## Step 6: 統合サマリー

全記事の後に、以下を追加:

```markdown
---

## Today's Cross-Cutting Theme

[今日の記事群を横断する最も重要なテーマを1段落で。
異なるカテゴリの記事がどう繋がっているか。大きな潮流は何か。
例: 「今日はAI規制の話が政治とテックの両方で出ている。EUのAI法改正案がGaming業界のAI利用にも波及しつつあり...」]

## Deep Dive候補

[今日の記事の中で、時間があれば深く読むべきもの上位3件をピックアップ。
なぜ深掘りする価値があるか1文ずつ添える。]

1. [記事タイトル](URL) — [なぜ深掘りすべきか]
2. [記事タイトル](URL) — [なぜ深掘りすべきか]
3. [記事タイトル](URL) — [なぜ深掘りすべきか]

## Action Items

- [ ] [今日の記事に基づく具体的なアクション。なければ「特になし」で良い]
```

---

## Step 7: 出力

実行条件: 7a/7b/7d は**常に実行**。7c(Notion)は**Notion MCPが接続されている場合のみ**
(未接続ならスキップした旨を報告)。

### 7a. ローカルファイル出力（Obsidian vault）

`~/morning-brief/` にカテゴリ別ファイルを出力する。
このディレクトリはgitリポジトリであり、Obsidianのvaultとしても開ける。
存在しない場合は `mkdir -p ~/morning-brief && git -C ~/morning-brief init` で初期化してから出力する。

```
~/morning-brief/
└── YYYY/MM/DD/
    ├── index.md          # Daily summary + cross-cutting theme + deep dive + action items
    ├── tech.md
    ├── ai-llm.md
    ├── politics.md
    ├── finance.md
    ├── business.md
    ├── design.md
    ├── gaming.md
    ├── hardware.md
    ├── product-pm.md
    ├── creative.md       # (話題があれば)
    └── coffee.md         # (話題があれば)
```

各ファイルにはfrontmatter（date, category）を付ける。
index.mdにはObsidianのwikilink `[[tech|Tech]]` 形式で各カテゴリへのリンクを置く。

### 7b. ターミナル出力

index.md の内容（サマリー、Deep Dive候補、Action Items）をターミナルに表示。
全カテゴリの記事一覧は長くなるため、ターミナルにはカテゴリ名と記事数のみ表示。

### 7c. Notionに書き出し (Notion MCP接続時)

`notion-create-page` skillでカテゴリごとにサブページを作成する。

- 親ページ: `Morning Brief - YYYY-MM-DD`（新規作成）
- 子ページ: 各カテゴリ名（tech, ai-llm, politics, ...）

### 7d. アーカイブ保存（重複排除用）

`~/.claude/skills/morning-brief/archive/YYYY-MM-DD.md` にURLリストを保存。

---

## 品質基準

- **言語**: 日本語。技術用語は原語のまま
- **トーン**: 対等な同僚として。ニュースキャスターではなく、詳しい友人が教えてくれる感じ。意見があるのは良いこと
- **分析の深さ**: 「何が起きたか」だけでなく「なぜ起きたか」「次に何が起きるか」まで踏み込む
- **具体性**: 数字、固有名詞、技術用語を恐れずに使う。曖昧な表現を避ける
- **接続性**: 異なるカテゴリ間のつながりを見つけたら積極的に言及する
- **Devil's Advocate**: 多数派の意見に対する反論や懐疑的な視点も必要に応じて含める
- **量より質**: 薄い記事を無理に入れるより、濃い記事だけを残す。各カテゴリ0件でもOK。逆に話題が多い日は遠慮なく増やす
- **サブカテゴリ**: Creative/Coffeeは本当にニュースがある時だけ。無理に入れない
