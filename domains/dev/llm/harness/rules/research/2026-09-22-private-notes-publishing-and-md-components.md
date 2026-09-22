---
question: "私的ノート公開の閲覧制御(Q1: プライバシー優先・モバイル対応・あとで1件だけ公開)と、Markdown→デザインシステムコンポーネント化(Q2: コールアウト/ディレクティブ記法の互換性)についての2026年業界動向"
date: 2026-09-22
verdict: "Q1は Notionのページ単位Publishトグルが最も直接的だがMarkdown-in-git前提と衝突し、代替としてQuartz自身のfrontmatterレベル機構(ExplicitPublish/EncryptedPages/UnlistedPages)がgitネイティブに近い答えになる。Q2はCommonMark範囲に収まる記法(ブロッククォート派生コールアウト、remark-directive)が最も安全で、MDX/JSX埋め込み(Mintlify等)が最もlintと相性が悪い。"
unverified:
  - "Quartz+Cloudflare Accessで非公開デジタルガーデンを運用した一人称の実名ブログ記事"
  - "Obsidian Publish/Notion/Cloudflare Access/セルフホストを試して別方式に乗り換えた一人称の移行談"
  - "HTMLオーサリングからMarkdown+コンポーネントへ移行した実名の記録"
  - "Cloudflare Access/Zero Trustの無料枠ユーザー数上限を明記したベンダー一次資料(コミュニティの伝聞50ユーザーのみ確認)"
  - "Cloudflare Access/Zero Trustの稼働率SLAを明記した現行ページ"
  - "Quartz等静的サイトのページ読み込み速度・Lighthouseパフォーマンス測定値"
  - "Obsidian Publishのユーザー数・サイト数などの規模を示す数字"
  - "claude.ai Artifactのlink rot(unpublish後にリンク機能停止)を実際に踏んだ外部からの苦情報告"
  - "Tailscale Funnel機能(選択的な公開インターネット露出)のドキュメント"
  - "コールアウト/アドモニション構文の分断を主題にした長文のブログ記事・エッセイ"
  - "Markdocが『MDXに明示的に対抗する』という位置づけを裏付ける現行ドキュメント上の一次記述"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 私的ノート公開の閲覧制御と、Markdown→デザインシステムコンポーネント化(2026)

調査日: 2026-09-22。四方向(ベンダー/実践者/測定/実態)を Q1・Q2 それぞれで揃えた。

## 方法と検証の凡例

- **[direct]** — WebFetch / `curl` / `gh api` で実際に取得したページ・レスポンスからの一次引用。
- **[community]** — ベンダー一次資料ではなく、Hacker News コメント等の非公式だが実名/実アカウントの裏取り。
- **[inference]** — CommonMark 仕様や textlint/remark の一般的挙動からの推論であり、ベンダー文書の断定ではない(各所で明記)。
- **[unreachable]** — 404・JS レンダリング・タイムアウト等で取得不能。「見つからなかった」であり「存在しない」ではない。
- **[unverified]** — 依頼文の前提を検証しようとしたが確認/反証どちらもできなかったもの。

**重要な方法論上の制約**: このセッション全体を通じて WebSearch ツールは利用不能だった(4本のサブエージェント全てで "budget used 200/200" により最初のクエリ前に枯渇)。すべての知見は WebFetch(既知 URL への直接取得)、`gh` CLI(`search code` / `search issues` / `api`)、および npm registry API・Hacker News Algolia API への直接 `curl` から得た。これは GitHub にインデックスされたコンテンツ(リポジトリ、issue、README)に偏り、ブログ集積サイト・Reddit・X(Twitter)・Obsidian 公式フォーラム(forum.obsidian.md)・Cloudflare コミュニティフォーラムなど、WebSearch でしか見つからない一次情報を取りこぼしている可能性が高い。以下の「見つからなかった」は、この制約下での「見つからなかった」である。

もう一つの観察: Cloudflare Access + Quartz のパターンを GitHub 上で検索すると、ヒットの多くが人間の一人称の運用記(ブログ記事)ではなく、AIコーディングエージェント(Claude Code 等)が生成した `CLAUDE.md` / `SKILL.md` / セッション引き継ぎメモの形で「エージェントがユーザーのためにこのパターンをセットアップした」記録だった。これらは実践者本人の一次証言として数えていない。

---

## Q1 — プライバシー優先のノート公開と閲覧制御、モバイル対応(2026)

### 1. ベンダー方向

**Cloudflare Pages/Workers + Cloudflare Access (Zero Trust)**
- Access は既定 deny。`developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/` [direct]: "All Access applications are deny by default -- a user must match an Allow policy before they are granted access."
- パスごとのゲーティングが可能(サイト全体だけでなく特定パスだけ制限できる)。`.../cloudflare-one/access-controls/policies/app-paths/` [direct]: より具体的なルールが優先される、`example.com/alpha/*` は配下のみカバーし親パス自体はカバーしない、等の具体例あり。ポート番号・クエリ文字列・アンカーはパス指定でサポートされない。
- Include ルールは OR: `.../cloudflare-one/access-controls/policies/` [direct] "Include rules ... function like an OR logical operator." 単一メールアドレス指定でのゲーティング例そのものはページ抜粋内には出てこなかったが(ドメインサフィックス例のみ確認)、一般的な Access ポリシー UI では単一メールの Include ルールで「一人だけに許可」が可能([unverified] な部分あり、メカニズム自体は確認)。
- カスタムドメイン: apex ドメインは Cloudflare ゾーンであることが必須、サブドメインは CNAME で足りる。
- **無料枠の人数上限**: ベンダー一次資料(`cloudflare.com/plans/zero-trust-services/` は JS レンダリングで静的取得不能、Wayback Machine 2026-09-13 スナップショットにも数値なし)からは確認できず [unreachable]。ただし Hacker News の実名コメント2件、5年以上隔てて同じ数字を独立に述べている: tmikaeld (2020-12-22, https://news.ycombinator.com/item?id=25505832) "Cloudflare Access (50 users free)."、arush15june (2026-02-20, https://news.ycombinator.com/item?id=47090030) "it's free upto 50 users" [community]。ベンダー一次資料での確証は得られていない。

**Obsidian Publish** (https://obsidian.md/publish [direct])
- 価格: "$8 USD Per site, per month, billed annually" / "$10 USD Per site, per month, billed monthly"。ストレージ上限 4GB。
- パスワード保護: サイト設定に "This site is password protected" チェックボックスがあり、"Restrict access to your site with the ability to manage multiple passwords." — 複数パスワードを設定できるが、ページ単位の粒度についての記述はマーケティングページには無い(サイト全体保護が基本と見られる)。
- カスタムドメイン: "Point your domain name to Obsidian Publish for a more branded experience." site settings に Custom URL / redirect-to-domain あり。
- モバイル: "SEO and mobile performance" という曖昧な文言のみ。Obsidian モバイルアプリ自体のマーケティングページ(obsidian.md/mobile)には Publish サイト閲覧との統合について言及が無い — Publish サイトは普通のウェブサイトとしてどのブラウザからでも見られる、というのが構造上の推定([inference])。
- password protection の詳細ヘルプページは複数候補 URL が 404/リダイレクトで内容取得できず [unreachable]。

**Notion** (https://www.notion.com/help/public-pages-and-web-publishing [direct])
- 公開手順: ページの Share → Publish タブ → Publish。
- サブページは連動して公開されるが、個々のサブページの権限を絞って隠すことは可能 — **これが Q1 の「あとで1件だけ公開する」を最も明快に満たす**: ページごとに独立した Publish トグルがあり、他は非公開のまま特定の1ページだけ公開できる。
- 閲覧側: "Anyone on the web can view it." ログイン不要。
- 重要な複雑さ: Notion には「Notion Sites での publish-to-web」と旧来の「Share menu の "Anyone on the web with link"」という**2種類の別の公開機構**が存在するとドキュメント自身が明記している。
- モバイル: notion.com/help/notion-for-mobile [direct] "Read, edit and comment on any of your Notion content from the mobile app." ホバー状態が無くカラムレイアウトはモバイルで単一カラムに折り畳まれる。非公開ページ特有のオフライン挙動は確認できず [unverified]。

**claude.ai Artifacts** (https://support.claude.com/en/articles/9487310 [direct])
- "By default, artifacts in Claude Code are visible only to the person who created them"(この一文は Claude Code の artifact に関するもので、claude.ai ウェブ製品全体に対する同等に明示的な「既定で非公開」の一文はこのページからは見つからなかった)。
- 共有: リンクで共有可能。Pro/Max は誰でもリンクで閲覧可。Team/Enterprise は組織設定で External sharing を有効化する必要あり。
- 閲覧者のログイン要否は本ページからは特定できず [unverified]。
- **持続性の落とし穴(このリサーチが探していた核心的知見)**: 原文 "Persistent storage is only available for published artifacts." および "Unpublishing an artifact permanently deletes all associated storage data." — publish 状態を解除するとストレージに紐づくデータが恒久的に削除される。GitHub Pages や Cloudflare、Obsidian と異なり、Claude Artifacts はコンテンツの生存が「published」フラグに構造的に結びついている。
- **裏取りの「link rot」報告**: Hacker News Algolia API・`gh search issues` いずれでも該当する外部からの苦情スレッドは見つからず(0件)[direct 検索、結果は陰性証拠]。持続性の落とし穴自体はベンダー自身の一次資料で確認できるが、それを実際に踏んだという外部の報告は今回のセッションでは発見できなかった。

**GitHub Pages — 非公開は Enterprise Cloud 限定か**
- `docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site` は `enterprise-cloud@latest` へ 301 リダイレクトされる。free-pro-team@latest バージョンの同ページも同様に enterprise-cloud へリダイレクトされる — つまり GitHub の無料/Pro/Team ドキュメントツリーにはこのページ自体が存在しない、という構造的な裏付け。
- 原文(両 URL から一貫して取得): **"To publish a GitHub Pages site privately, your organization must use GitHub Enterprise Cloud."** Pro/Team が対象になるとの記載は一切なし。**確認: 個人/Pro アカウントでは非公開 Pages サイトは作れない。**

**Netlify / Vercel パスワード保護**
- Netlify (`docs.netlify.com/manage/security/secure-access-to-sites/password-protection/` [direct]): "Basic password protection for your entire site is available on all Pro plans. All basic password protection and team login protection options are available on Enterprise plans." サイト全体に対してだが、対象デプロイ(本番のみ/プレビュー含む全て)は選べる。Pro プランの具体的な月額は本セッションでは未取得 [unverified]。
- Vercel (`vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection` [direct]): 価格表を原文で確認—Hobby は利用不可、**Pro は $20/月/保護対象プロジェクト**、Enterprise は Team Level Password Protection が含まれる、レガシー Advanced Deployment Protection 契約者は $150/月/チーム。プロジェクト単位、プロジェクト内でどの環境(本番のみ/全プレビュー含む)を保護するか選択可。パスワードは Cookie でデプロイ URL 単位に保持され、別のデプロイ URL には引き継がれない。
- 費用構造の違い(未確定な部分含む): Vercel は機能単体で $20/月/プロジェクトの追加課金、Netlify は Pro プランに含まれる書きぶりで単体追加課金のようには読めない — ただし Netlify Pro 自体の価格は本セッションで未確認のため、比較の確度は限定的 [unverified]。

**Tailscale + 自宅サーバー(スマホは Tailscale アプリ経由)**
- 価格 (`tailscale.com/pricing` [direct]): Personal プラン **"$0 Free forever"**、"Up to 6 users"、デバイス数無制限、tagged resources 50件まで、ephemeral resources 月1,000分まで。
- iOS クライアント (`tailscale.com/kb/1020/install-ios` [direct]): iOS 15.0+、iPhone/iPad 対応、VPN構成のインストールとプッシュ通知許可が必要。Tailscale 自体は IdP ではない: "Tailscale is not an identity provider—there are no Tailscale passwords." Apple/Google/GitHub/Microsoft/Okta/OneLogin または カスタム OIDC でログイン。
- Android クライアントのドキュメントは本セッションでは未取得 [unverified]。
- **「あとで1件だけ公開する」への回答が未検証のまま残った**: Tailscale には Funnel という選択的に公開インターネットへ公開する機能があるはずだが、本セッションでは Funnel のドキュメントを取得していない [unreachable/未着手] — Q1 の核心的要件に直結するため、次回リサーチの優先事項として明記する。

### 2. 実践者方向

- **Quartz の「公開範囲」バグを実名で報告した人々**(いずれも GitHub issue、ブログ記事ではない):
  - archifont (github.com/archifont), https://github.com/jackyzha0/quartz/issues/2531(未クローズ、2026-09-05頃)。原文: "`explicit-publish` keeps unpublished notes off the site, but attachments belonging to those notes are still copied into `public/` and served... A vault used with `explicit-publish` therefore publishes every image, PDF and video it contains, including those only ever referenced from notes marked `publish: false`." — 添付ファイルは非公開フラグの対象外という構造的リーク。
  - Lucordes (github.com/lucordes), https://github.com/jackyzha0/quartz/issues/1941(クローズ、"not reproduced in v5")。原文: "While using ExplicitPublish() and editing a file to trigger a rebuild private files ... are shown in the explorer and in the graph and they're readable."
  - Stephen Tse / Stephen-X (github.com/Stephen-X, blog: stepht.org), https://github.com/jackyzha0/quartz/issues/1950。原文: "Currently all posts marked as draft still have their assets emitted to the public directory and deployed as part of the website."
  - LilTrublMakr, https://github.com/jackyzha0/quartz/issues/1519。frontmatter の `publish` フィールドが文字列 `"false"` の場合に JS の型強制で真になってしまう、という具体的なバグ。
- **Quartz 公式ドキュメント自身がこのパターンの限界を認めている**(準ベンダー扱いだが本質的): `quartz.jzhao.xyz/features/private-pages` [direct] "all non-markdown files will be emitted and available publically in the final build." 公開リポジトリで使う場合は `.gitignore` も併用するよう案内 — つまり Quartz の `publish:true` フィルタは、プロジェクト自身の言葉で言えば「セキュリティ境界ではない」。
- **アクセス制御方式の比較を書いた実名ブロガー**: einverne (github.com/einverne, blog: blog.einverne.info), 記事 https://einverne.github.io/post/2026/08/ignis-obsidian-web-app.html (2026-08-16, 中国語)。Obsidian Publish・Quartz・Flowershow を "render note libraries into static websites... suit external sharing but are essentially read-only" と評した上で、個人 vault の露出方法として "Reverse proxy Basic Auth is simplest; Authelia, Authentik, OAuth2 Proxy offer more complete SSO solutions" および "Cloudflare Access paired with Tunnel, or simply use Tailscale and WireGuard" を列挙し、最終的に **Tailscale serve を「証明書管理が不要で、個人デバイスだけが自然にアクセスできる」として好む**、と明言。「試して戻った」形の移行談ではなく、選択肢を比較した末の実名の意見表明。
- Xinyang Yu (github.com/xy-241, notes.yxy.ninja) は実在する Quartz ベースの実サイトに `/Security/Authentication/Cloudflare-Access` という該当ページを持つが、取得できた内容は一人称の意見ではなくリファレンス的記述だった — 実在する関連実践者ではあるが、引用できる一次的な感想は確認できず [unverified]。
- **「試して、やめた」移行談**: 明確な形では見つからなかった。複数の切り口で検索したが陰性([no precedent found] として扱う)。

### 3. 測定方向

依頼通り「数字は期待されない」を確認する形になった:
- Cloudflare Access/Zero Trust の稼働率 SLA %: developers.cloudflare.com、cloudflarestatus.com とも数値記載なし。cloudflare.com の SLA ページ候補 URL は2つとも 404 [unreachable]。**数字なし。**
- Quartz の静的サイト表示速度/Lighthouse ベンチマーク: どこにも見当たらず。**数字なし。**
- Obsidian Publish のユーザー数/サイト数: 見当たらず。**数字なし。** ただし唯一見つかった数値は "Out of the box, Obsidian Publish has a perfect 100% Lighthouse accessibility score"(アクセシビリティスコアであり速度ベンチマークではない、混同しないこと)。
- **結論**: このトピックには比較可能な公開数値がほぼ存在しないことを確認した。唯一の数字(Lighthouse a11y 100%)はベンダー発表・単一指標で、比較対象が無い。

### 4. 実態方向

- Quartz リポジトリ (jackyzha0/quartz): **13,279 stars**、最終 push **2026-09-20T20:17:23Z**、open issues 76。ただし GitHub Releases は古く、最新タグは v4.0.8 (2023-08-21) — 実コミットは活発なのに正式リリースタグは2023年で止まっている。
- Quartz 公式ドキュメント(リポジトリを直接クローンして読了):
  - `docs/features/private pages.md`: フィルタプラグインは `RemoveDrafts`(`draft:true` を除外)と `ExplicitPublish`(`publish:true` 以外を除外)の2種。`ignorePatterns` での glob 除外も可能。明記された警告: 非 Markdown ファイルは常に公開ビルドに出力される。リポジトリが公開なら `.gitignore` も必要。
  - `docs/plugins/UnlistedPages.md`(Quartz v5 新機能): `unlisted:true` は検索・グラフ・サイトマップ・RSS・逆リンク等の発見経路から隠すが、HTML 自体は生成されて直接 URL でアクセス可能 — 「隠蔽によるセキュリティ」であり本当のアクセス制御ではない。
  - `docs/plugins/EncryptedPages.md`(Quartz v5 新機能、**Q1 の核心に直結**): frontmatter の `password:` でページ単位のパスワード保護。ビルド時に AES-256-GCM で暗号化、クライアント側で Web Crypto API により復号、PBKDF2 既定 600,000 反復。`stealth:true` を組み合わせると、他のページを正しく復号した訪問者にすら常に不可視 — "private notes linked from an external wiki, personal pages you send to specific people" という想定用途が明記されている。明示的な限界: "This is client-side encryption of a static site. It protects against casual browsing but not against determined attackers with access to the page source." パスワードは frontmatter に平文で入るため「公開リポジトリにパスワードをコミットするな」との注意書きあり。**これは「1件だけ後で公開する」の逆(1件だけ暗号化して隠す)を、プラットフォーム側のゲーティングなしに git ネイティブに実現する仕組みであり、Cloudflare Access のようなサイト全体ゲーティングとは補完関係にある。**
  - `docs/hosting.md`: Cloudflare Pages, GitHub Pages, Vercel, Netlify, GitLab Pages, 汎用セルフホストを案内しているが、**Cloudflare Access / Zero Trust への言及は一切ない**。Quartz のメンテナはプラットフォームレベルのゲーティングではなく frontmatter レベル(RemoveDrafts/ExplicitPublish/EncryptedPages)の運用を前提にしていると読める。
- `_headers` ファイル調査(`gh search code`): Quartz を Cloudflare Pages にデプロイしている実リポジトリ2件(diogoseca/bjjgraph、ulmus/Riket)の `_headers` を確認したが、いずれも CSP/キャッシュ設定のみで **Cloudflare Access 関連のディレクティブは無し**。
- `gh search code '"Cloudflare Access" quartz'`(文字列一致)は **0 件**。Quartz と Cloudflare Access の組み合わせが公開リポジトリ上で言及された例は見つからなかった — これ自体が陰性証拠。
- 実態としての採用数(`gh api search/code` の `total_count`、推定値ではなく API 応答値):
  - `"cloudflare/pages-action" quartz` → **14** リポジトリ
  - `"wrangler pages deploy" quartz` → **93** リポジトリ
  - `quartz.config.ts cloudflare` → **324** リポジトリ
  - 母数: `filename:quartz.config.ts`(ホスト問わず全 Quartz サイト) → **4,016** リポジトリ
  - (GitHub コード検索の `total_count` は近似値である可能性がある、との注記付き)
- GitHub Pages の非公開制限(上記ベンダー節で確認済み)は Quartz 自身の `hosting.md` からも GitLab Pages についての言及があり、原文引用: "By default, the page is private and only visible when logged in to a GitLab account with access to the repository."(Quartz 側の文書からの孫引きであり GitLab 公式での独立検証はしていない [unverified])。

### Q1 比較表

| アプローチ | 認証モデル | ページ単位 vs サイト全体 | コスト | モバイル体験 | 「あとで1件公開」 | ロックイン |
|---|---|---|---|---|---|---|
| Cloudflare Access + Pages | Zero Trust ログインポリシー(メール/IdP) | パス単位のゲーティング可(`app-paths`) | 無料枠あり(50ユーザーは community 情報のみ、ベンダー一次未確認) | 通常ブラウザ、Access はブラウザ認証フロー | ポリシーでそのパスだけ Allow を外す | Cloudflare のドメイン/ゾーン設定に依存 |
| Obsidian Publish | サイトパスワード(複数設定可) | サイト全体が基本、ページ単位の粒度は文書上未確認 | $8-10/月/サイト、4GB上限 | 通常ブラウザ閲覧、モバイルアプリとの統合記述なし | 個別ページの扱いは Publish 単位の設定に依存、未確認箇所あり | Obsidian エコシステム依存 |
| Notion | Notion アカウント権限 + Publish トグル | **ページ単位**(サブページごとに独立) | Notion のプラン内(追加課金の詳細は今回未確認) | 公式モバイルアプリで閲覧・編集 | **トグル1つでそのページだけ公開、最も直接的** | Notion 全体への依存(データエクスポートは別途要検討) |
| claude.ai Artifacts | 既定非公開、リンク共有 | Artifact 単位 | 無料/Pro/Max/Team で条件差 | ブラウザ/アプリでリンク閲覧 | 元々 artifact 単位で公開可能だが恒久保存は published 中のみ | **unpublish でストレージデータが恒久削除**という強い破棄リスク |
| GitHub Pages | リポジトリコラボレーター権限 | サイト単位 | **非公開 Pages は Enterprise Cloud 限定**、個人/Pro不可(確認済み) | 通常ブラウザ | 別リポジトリ/別 Pages サイトに分離するしかない | GitHub 依存、無料での非公開は不可能 |
| Netlify/Vercel パスワード保護 | サイト/プロジェクトパスワード | サイト・プロジェクト単位(Vercel はデプロイ環境選択可) | 両者とも有料プラン以上が必要(Vercel Pro: $20/月/プロジェクト、Netlify Pro: 額未確認) | 通常ブラウザ | プロジェクト分離が必要 | ホスティングベンダー依存 |
| 自宅サーバー + Tailscale | Tailscale の SSO(Apple/Google/GitHub等) | サーバー側の設定次第 | Personal プラン無料(6ユーザーまで、デバイス数無制限) | 公式 iOS アプリで VPN 接続、Android 未確認 | **Funnel 機能で個別公開できる可能性が高いが本セッションでは未検証** | 自宅回線・自前運用への依存、最も可搬 |

### Q1 の結論(証拠が支持すること)

- 「プライバシー優先、モバイル対応、あとで1件だけ公開」という要件の**最も直接的な答えは Notion のページ単位 Publish トグル**であることが一次資料から確認できる。ただし Notion はノート本体を独自フォーマットで抱え込む(Markdown-in-git という前提と衝突する)。
- 「Markdown を git で管理し、静的サイトとして生成する」という前提を守ったまま個別公開を実現する現実的な道は、**Quartz 自身が用意した frontmatter レベルの仕組み(ExplicitPublish/EncryptedPages/UnlistedPages)**であり、これはプラットフォームのアクセス制御(Cloudflare Access 等)とは別のレイヤーで動く。Quartz の公式ドキュメントは Cloudflare Access に一切触れておらず、実際に公開リポジトリでも「Quartz + Cloudflare Access」の組み合わせを配線した例はゼロ件だった — この2つを組み合わせる設計は前例に乏しい、少なくとも公開リポジトリのコードとしては存在しない。
- Cloudflare Access は**パス単位のゲーティングが可能**なため、「サイト全体は非公開、特定ノートだけ公開パスに置く」設計自体は技術的に成立する(ドキュメントで確認済み)。ただし無料枠のユーザー数上限はベンダー一次資料で確認できず、コミュニティの伝聞(50ユーザー)に留まる。
- Quartz を「非公開」にする既存の仕組み(ExplicitPublish/ignorePatterns)には、**添付ファイル(画像・PDF等)が常にビルド出力に漏れる**という、実名の複数バグ報告で裏付けられた構造的な穴がある。Quartz 自身のドキュメントも「これはビルドからの除外であり、セキュリティ境界ではない」と明言している。Cloudflare Access のようなプラットフォームレベルのゲーティングを併用しない限り、frontmatter だけでの「非公開」は不完全である。
- 自宅サーバー + Tailscale は最も可搬でロックインが少なく、無料でモバイル対応も公式アプリで確認できたが、「あとで1件だけ公開」を Tailscale 側でどう実現するか(Funnel 機能)は本セッションでは検証しきれていない。
- claude.ai Artifacts は「既定非公開・リンク共有」は成立するが、**unpublish でストレージデータが恒久削除される**という、他の選択肢には無い破棄的な落とし穴がベンダー自身の文書で確認された。ノートの永続的な記録という用途には構造的に不向き。
- GitHub Pages での非公開は個人・Pro アカウントでは不可能、Enterprise Cloud 限定であることをドキュメントの URL リダイレクト構造自体が裏付けている。

---

## Q2 — Markdown をデザインシステムのコンポーネント集に変換する

### 1. ベンダー方向

**Quartz**(Preact)
- コンポーネントは Markdown 本文から呼び出すのではなく、`quartz.layout.ts` という TypeScript 設定でサイト全体に配線する。原文(`docs/layout-components.md`): "Quartz provides several higher-order components that help with layout composition and responsive design." 例: `Component.Flex({...})`。モバイル/デスクトップ専用ラッパー `Component.MobileOnly(...)` / `Component.DesktopOnly(...)` あり。
- コールアウト構文(`quartz.jzhao.xyz/features/callouts` [direct]): `> [!info] Title` — Obsidian と同じ Admonition 構文。"Quartz supports the same Admonition-callout syntax as Obsidian." 12種のタイプとエイリアス、折り畳み対応。**これは通常の CommonMark 引用ブロックとして解釈可能なため、textlint 等の素の Markdown パーサーは特別扱いせず中身の文章を普通に検査できる**([inference])。
- Mermaid はクライアントサイドレンダリング、Obsidian 互換プラグインの一部として有効化。原文: "This is enabled as a part of [[Obsidian compatibility]] and can be configured and enabled/disabled from that plugin."
- 保守状態: **13,279 stars**、最終 push 2026-09-20、open issues 76。ただしリリースタグは 2023-08-21 (v4.0.8) で止まっており、頻繁なコミットの割にタグ付けはされていない。

**Astro**
- **plain `.md` にはコンポーネントを埋め込めないことが公式文書で明確に確認できた**。原文 (docs.astro.build/en/guides/markdown-content/): "For additional functionality, such as including components and JSX expressions in Markdown, add the @astrojs/mdx integration to write your Markdown content using MDX." つまり素の Markdown はコンポーネント機能を持たず、コンポーネントが必要なら MDX(JSX 混在)に移行する必要がある。
- MDX 構文例: `import ReactCounter from '../components/ReactCounter.jsx'` の後 `<ReactCounter client:load />` のように JSX タグを地の文に埋め込む。標準 Markdown 要素をコンポーネントに置き換える `export const components = {...}` も可能。
- 素の `.md` は**この比較の中で最もリント親和性が高い**(コンポーネントが構造的に不可能だから壊れようがない)。ただし `.mdx` は本物の JSX であり、MDX 対応の remark-mdx なしでは自己終了タグ等をどう扱うか予測できない。
- 保守状態: **62,747 stars**、最終 push 2026-09-22(調査当日)、open issues 75。非常に活発。

**Docusaurus**
- Admonition 現行(v3)構文、原文(docusaurus.io/docs/markdown-features/admonitions): ` :::note ... ::: `。タイトル付き `:::note[Your Title]`、CSS クラス付与、ネストは `:::::` のようにコロン数を増やす必要あり。
- 「以前構文が変わった」という依頼文の前提は、取得できたページからは裏付けられず [unverified]。
- Mermaid は別テーマパッケージ `@docusaurus/theme-mermaid` を追加しクライアントサイドで動的レンダリング(`mermaid.initialize()`)。
- `:::note` は CommonMark ではないため、素のパーサーはエラーにはしないが地の文の断片として扱う — textlint のルールが誤爆する可能性がある([inference])。
- モバイル対応ドキュメントページは HTTP 520 で取得不能 [unreachable]。
- 保守状態: **66,314 stars**、最終 push 2026-09-22、open issues 395。非常に活発。

**MkDocs Material**
- Admonition 構文(squidfunk.github.io/mkdocs-material/reference/admonitions/): `!!! note` の後にインデントされた本文。`???`/`???+` で折り畳み。15種のタイプ。必須の `mkdocs.yml` 拡張3点。
- タブ構文: `=== "Tab Title"` の後にインデントされた本文。
- Mermaid: `pymdownx.superfences` のカスタムフェンスで有効化、クライアントサイド。公式サポートはフローチャート/シーケンス/状態/クラス/ER図、円グラフ・ガントチャートは「動くが非公式サポート」。
- `!!!` や `=== ` のマーカー行自体はクラッシュしないが、その下の4スペースインデント本文は CommonMark の「インデントコードブロック」に該当しうるため、素の CommonMark/textlint パーサーはこれをコードブロックと誤認してプロース検査をスキップする可能性がある([inference])。
- 保守状態: **27,478 stars**、最終 push 2026-09-15、open issues **1**(サポートを Issues ではなく Discussions/Insiders に誘導している可能性、未検証)。実運用での採用: `gh search code` で `mkdocs.yml` 内に `pymdownx.superfences` を使う実リポジトリ(webonyx/graphql-php, smarty-php/smarty, LukeMathWalker/pavex 等)を確認、公式ドキュメント以外での広範な採用を裏付け。

**Markdoc (Stripe)**
- タグ構文(markdoc.dev/docs/syntax): `{% tag %} ... {% /tag %}`、自己終了 `{% tag attr="value" /%}`。
- 設計思想、原文(markdoc.dev/docs/overview): "By design, Markdoc is not a full-blown templating language and does not allow mixing arbitrary code and content." および "Markdoc is, however, a fully declarative format."
- **依頼文にあった「MDX に対して明示的に自らを位置づけている」という主張は、overview ページ・ランディングページ・Stripe 公式ブログ発表(stripe.dev/blog/markdoc)の3ソースいずれからも "MDX" という単語自体が見つからず裏付けられなかった** [unverified] — 過去のドキュメントバージョンの記述か、未取得の別ページの可能性がある。
- 保守状態: **「停滞している」という依頼文の仮説は覆された**。stars **8,484**、最終 push **2026-09-16**(調査6日前)、open issues 29、最新リリース v0.5.10(2026-09-16、最終 push と同日)。直近1週間(2026-09-08〜09-16)にマージされた PR が5件(#626, #629, #633, #636, #640, #642, #644)。open issue は具体的な最近のバグ報告が中心で、大規模な不満の噴出は見られない。**「静かに、しかし実際に保守されている」状態であり停滞ではない。**

**remark-directive**
- 構文(github.com/remarkjs/remark-directive README): コンテナ `:::main{#id} ... :::`、リーフ `::youtube[caption]{#id}`、インライン `:i[lovely]`。
- 標準化状況: README は「generic directives proposal」への対応と説明し、CommonMark フォーラムの議論にリンク — **CommonMark として採択された標準ではなく、あくまで拡張提案**であることを明記。
- プラグイン無しでは `:::name{...}` は地の文として素通しされる(HTML やテンプレート構文と違いクラッシュも意味不明な挙動もしにくい)— この比較の中で「プレーン Markdown 互換性」は相対的に高いと見られる([inference])。
- 保守状態: **424 stars**、最終 push **2025-02-27**(調査時点で約7ヶ月停滞)、open issues 3 — 他のリポジトリと比べ明確に活動が鈍い。
- 実運用採用: `gh search code --filename package.json "remark-directive"` で約30件の実プロダクション利用を確認(quran/quran.com-frontend-next, axelarnetwork/axelar-docs, spicetify/docs, hirosystems/docs, delta-io/website, unraid/docs 等)— バッテリー同梱型の SSG を使わず、自前でディレクティブ構文の上にコールアウトを組む例が一定数存在する。派生パッケージ(naiyerasif/remark-callout-directives [アーカイブ済み]、incentro-ic/remark-github-admonitions-to-directives、lin-stephanie/remark-directive-sugar)も確認、ディレクティブ・プリミティブの上に「シュガー」を積むエコシステムがある。

**Mintlify**
- コンポーネント構文は**MDX 前提**で、すべての例が JSX タグ。callouts: `<Note>`, `<Warning>`, `<Info>`, `<Tip>`, `<Check>`, `<Danger>`、汎用 `<Callout icon="..." color="..." iconType="...">`。Steps: `<Steps><Step title="...">...</Step></Steps>`。
- **依頼文の前提と食い違う発見**: 現行 Mintlify ドキュメントに `CardGroup` コンポーネントは存在せず、`<Columns cols={2}>` で `<Card>` を囲む形に変わっている。"The Columns component supports one to four columns and automatically adjusts for smaller screens." — API 名称が移り変わっている(ドキュメントのドリフト)。
- リント親和性はこの比較で**最も低い**と見られる。CommonMark は生 HTML ブロックを許容するため `<Note>...</Note>` 自体でパーサーがクラッシュすることは無いだろうが、remark ベースの textlint 実装は一般に HTML ブロックを不透明ノードとして扱い、中の文章をリント対象からスキップする — つまり `<Note>`/`<Step>`/`<Card>` の中身は静かにチェックから漏れる可能性がある([inference]、textlint/Mintlify いずれの文書にも明記なし)。
- 保守状態: Mintlify はクローズドソースの SaaS であり公開リポジトリ無し。stars/最終 push は評価不能。
- **Anthropic のドキュメントが Mintlify かどうかの確認は依頼文の前提を修正する結果になった**: mintlify.com/customers に Anthropic のロゴと事例("Managing Claude Code docs with one writer")が掲載され、リンク先は `claude.com/docs`。一方で `docs.claude.com/...` は `platform.claude.com/docs/...` へ 302 リダイレクトされ、そのページの raw HTML(479KB を直接 curl)には `mintlify` の文字列が一切なく、`og:site_name = "Claude Platform Docs"`、Next.js のビルド構造 — **つまり platform.claude.com はセルフホストの Next.js サイトで Mintlify ではない**。一方で **claude.com/docs を直接見ると HTML 内に `mintcdn.com/claude-ai/.../logo/light.svg` という Mintlify 専用 CDN のフィンガープリントが確認でき、claude.com/docs は確かに Mintlify で構築されている**。結論: Anthropic は少なくとも2つの異なるスタックでドキュメントを運用しており(claude.com/docs = Mintlify、platform.claude.com/docs = 自前 Next.js)、「docs.claude.com が Mintlify」という前提は現状もう成立しない。

### 2. 実践者方向

**MDX への苦情(リンティング/地の文への JS 混入)**
- mdx-js/mdx issue #255「Linting for mdx?」(2018-09-12, 11コメント): OP "My biggest hesitation to convert them, however, is that it's really useful to have default eslint linting of the normal js/jsx files"。コントリビュータ @silvenon: "unlike JSX, MDX isn't being parsed by Babel, so I'm not sure how to approach this problem... We aren't [solving it]. 😕" — 地の文の(プロース)リンティングは未解決のまま issue はクローズされ、JS 部分のリンティングだけが「95%のユースケース」として扱われた。
- facebook/docusaurus issue #3018「RFC: CommonMark compatibility」(2020-07-01, 32コメント): 原文 "People using Docusaurus don't always like the MDX parser: ... you might want to keep compatibility to CommonMark, to stay compatible with existing ecosystem (Github md viewer, markdownlint etc...) It creates more 'lock-in', because to leave MDX you have to convert back to CommonMark."
- facebook/docusaurus issue #4029「Migrate to MDX 2.0」(2021, 33コメント): @armano2 "mdx 2.0 introduced breaking change, comments `<!-- -->` are not longer allowed in code, and thus mdxjs can't be used for simple markdown files" — MDX のバージョンアップが素の Markdown の記法まで壊した具体例。@slorber は MDX コア開発者間の内部対立にも言及("There are also disagreements in the MDX core contributors")、xdm という並行実装が一時存在した("There's also a 'fork' xdm project from Titus himself")が、後に本家へマージされ現在は不要になっている(github.com/wooorm/xdm README で確認)。
- mdx-js/mdx issue #821「Don't replace literal HTML elements with MDXProvider」(2019年発、2024年でも参照される): MDX のコンポーネント置換セマンティクスが直感に反するという長期未解決の不満。
- **textlint と MDX を直接結びつけた苦情スレッドは見つからなかった**(0件)— 素直な陰性証拠。

**HTML ↔ Markdown+コンポーネント の移行談**
- **明確な「HTML authoring から Markdown+components へ移行した/その逆」という実名の記録は見つからなかった**。ツール間移行(MkDocs→Zensical、Docusaurus→Astro Starlight 等)の issue は多数見つかったが、「生 HTML に戻した」または「生 HTML から離れた」という軸での記録は無い [no precedent found]。
- 近いが軸が異なる実例: TanStack/tanstack.com issue #1140「Collapsible +/- callout syntax lost during Markdown migration」(2026-08-12): 原文 "Before migrating to TanStack Markdown, the website made use of rehype-callouts... However, when TanStack Markdown was introduced, it changed how callouts are parsed. This now causes documentation sites using that feature to have broken callouts." — Markdown 処理パイプラインを切り替えたことで、既存コンテンツのコールアウト構文が壊れた、という日付付きの実例(2026年)。ツール切り替えのリスクとして直結する知見。
- 未確認情報として: 複数の無関係なリポジトリで「MkDocs Material (EOL) → Zensical への移行」を題する issue が見つかった(bcit-tlu/qcon-guide#2 等)が、squidfunk 自身の一次アナウンスでは検証していない [unverified]。MkDocs Material が候補に残る場合は要フォロー。

**Markdoc の採用シグナル**
- Hacker News (Algolia API で実数取得): 発表時「Markdoc: Stripe's Markdown-based authoring framework」(2022-05-11)**810ポイント、146コメント**という大きな反響。半年後のフォローアップ記事(2022-09-14)は157ポイント、47コメント。それ以降の Markdoc 関連投稿は軒並み一桁〜低い二桁ポイントで、**2022年のローンチ時の勢いはその後再現していない**。
- Stripe 社員 @nkohari(自己申告「engineer on the Stripe Docs team」)の HN コメント: "The primary difference between MDX and Markdoc is that an MDX article is essentially imperative code... whereas a Markdoc article is purely declarative... We had a similar situation when we used ERB, and it resulted in markup which was easy to write but very difficult to read."
- 反論も存在: @dsmmcken「1600以上の md ページを MDX で運用しているドキュメントサイト」の実務者は "I haven't experienced the supposed concern of complexity with MDX" と反証。
- Chase McCoy のブログ(chsmc.org/2022/05/markdoc, 2022-05-15): "in every MDX project I've worked on there have eventually been scaling and maintenance issues with closely marrying content/data and code... If MDX is 'docs as code' then Markdoc is 'docs as data.'"
- 批判的な声も: @dragonsh 「Now people have plain markdown, gitbook and now markdoc with its own set of non standard extensions.」— Markdoc 自体も独自の非標準拡張の一つに過ぎない、という指摘。

**ディレクティブ/コールアウト構文の分断**
これが最も証拠が厚かった論点で、5件の独立した実名 GitHub issue が見つかった:
- PGijsbers/admonitions issue #7: "Since alerts/admonitions syntax are quite heterogeneous, it would be fantastic to support additional from the most used: markdown-it ... myst, widely used in Sphinx ecosystem..." — 互換性のない構文を実名で列挙。
- huggingface/hub-docs issue #1370: @ZhiyuanChen "I looked into the syntax, and it's really nice. However, as I'm trying to write one md for both model card and in documentation, while it's possible for me to extend mkdocs, it is still less convenience. Also, the GitHub-style notes lacks capabilities for i18n." — 同一ソースファイルを GitHub 記法と MkDocs `!!!` 記法の両方に対応させようとして詰まった、i18n 面での具体的な差異込みの一次証言。
- just-the-docs/just-the-docs issue #1483(タイトル自体が分断を体現): OP "We're using [GitHub's alert syntax] in our .md files. Now when trying to use just-the-docs, we'll need a different syntax, so it doesn't work on both github.com and github pages." メンテナ @mattxwang は GitHub のアラート構文自体が GFM 仕様に含まれていない独自拡張であることを確認。OP は最終的に "It would also be waaay easier for me to just accept that it won't look good in github markdown anymore and exclusively use jtd's style." — クロスツール互換性を諦めるという実名の決断。
- elixir-europe/ds-handbook issue #132: メンテナが独自の Liquid include ベースのコールアウトを MkDocs の `!!!` 構文に置き換えることを、「広く知られていて読みやすいから」という理由で提案。
- TanStack/tanstack.com #1140(上記): Obsidian の折り畳みコールアウト構文がパイプライン変更で失われた実例。

### 3. 測定方向

npm registry API から実測(2026-08-23〜2026-09-21の直近30日ダウンロード数、`curl https://api.npmjs.org/downloads/point/last-month/<pkg>` の実際の応答値):

| パッケージ | 直近30日ダウンロード数 |
|---|---|
| @mdx-js/mdx | 39,601,460 |
| remark-directive | 14,239,427(直近1週間 2,904,950) |
| markdownlint | 11,033,070 |
| @astrojs/mdx | 7,570,332 |
| @docusaurus/core | 5,430,056 |
| @markdoc/markdoc | 1,857,378 |
| remark-lint | 1,194,288 |
| textlint | 742,489 |

注意点:
- これは npm の**インストール数**であり「採用サイト数」ではない。CI の再インストールやモノレポのホイスティング、推移的依存で大きく水増しされる。remark-directive の月1420万は GitHub スター数わずか424・open issue 3件という規模に対して不自然に大きく、ほぼ確実に何か広く使われるパッケージの推移的依存として引っ張られている数字であり、「1420万プロジェクトが能動的にディレクティブ構文を選んだ」という意味ではない([inference]、明示的に注記)。
- @markdoc/markdoc の月185万は @mdx-js/mdx の約1/21、@docusaurus/core の約1/3 — 「2022年の派手なローンチ、その後は地味な継続成長」というリリース履歴・HN反応から見た像と整合する。
- **これらのツール間のビルド時間/レンダリング速度を比較した公開ベンチマークは見つからなかった**(依頼文が予期した通り不在を確認)。唯一見つかった性能主張(HN の @saltymimir "markdown-it outperforming remark by a factor of 20")は完全に一人称の逸話でスレッド内で誰も検証しておらず、[unverified] として扱う。

### 4. 実態方向(保守状態の実数、`gh api` から直接取得)

| リポジトリ | stars | 最終 push | open issues | 備考 |
|---|---|---|---|---|
| jackyzha0/quartz | 13,279 | 2026-09-20 | 76 | リリースタグは2023-08-21で停止、コミットは活発 |
| withastro/astro | 62,747 | 2026-09-22(当日) | 75 | 非常に活発 |
| facebook/docusaurus | 66,314 | 2026-09-22(当日) | 395 | 非常に活発 |
| squidfunk/mkdocs-material | 27,478 | 2026-09-15 | 1 | issue が極端に少ない(サポート導線が別の可能性、未検証) |
| markdoc/markdoc | 8,484 | 2026-09-16 | 29 | 「停滞」仮説は覆された、直近1週間で5PRマージ |
| remarkjs/remark-directive | 424 | 2025-02-27(約7ヶ月停滞) | 3 | この中で最も活動が鈍い |
| Mintlify | N/A(非公開リポジトリ、クローズドソース SaaS) | — | — | 評価不能 |

- MkDocs Material の実運用: `gh search code` で `mkdocs.yml` 内の `pymdownx.superfences` 使用リポジトリ(webonyx/graphql-php, smarty-php/smarty, LukeMathWalker/pavex 等)を確認、公式ドキュメント以外の実採用を裏付け。
- remark-directive の実運用: `package.json` に `remark-directive` を持つ実プロダクション約30件を確認(quran/quran.com-frontend-next, axelarnetwork/axelar-docs, hirosystems/docs, delta-io/website, unraid/docs 等)。派生の「シュガー」パッケージも複数存在。

### Q2 比較表

| ツール | 呼び出し構文(コンポーネント/コールアウト) | 素の Markdown として lintable か | 図表(Mermaid等) | モバイル記述 | 保守状態(stars/最終push) |
|---|---|---|---|---|---|
| Quartz | `> [!info] Title`(コールアウトのみ、他コンポーネントはサイト設定側) | 高(CommonMark 引用ブロックとして解釈可能) | Mermaid、クライアントサイド | Mobile/DesktopOnly ラッパーあり | 13,279 / 2026-09-20(タグは2023年で停止) |
| Astro(.md) | **不可**(コンポーネント埋め込み自体ができない) | 最高(構造的に壊れようがない) | 文書上未確認 | 未確認 | 62,747 / 2026-09-22 |
| Astro(.mdx) | JSX タグをそのまま地の文に混在 | 低(remark-mdx 前提) | 未確認 | 未確認 | 同上 |
| Docusaurus | `:::note ... :::` | 中(非 CommonMark だがクラッシュしない) | Mermaid(別パッケージ、クライアントサイド) | ページ取得不能で未確認 | 66,314 / 2026-09-22 |
| MkDocs Material | `!!! note` / `=== "Tab"` | 中〜低(インデント本文がコードブロックと誤認されうる) | Mermaid(superfences 経由、クライアントサイド) | 未確認 | 27,478 / 2026-09-15 |
| Markdoc | `{% tag %} ... {% /tag %}` | 低〜中(タグ区切りが地の文中に出現) | 文書上未確認 | 未確認 | 8,484 / 2026-09-16(活発) |
| remark-directive | `:::name{...}` / `::leaf` / `:text` | 中(未対応パーサーでは地の文として素通し) | 該当なし(構文プリミティブ) | 該当なし | 424 / 2025-02-27(停滞) |
| Mintlify | `<Note>`, `<Steps>`, `<Columns>`+`<Card>` 等の JSX | **最低**(HTML ブロックとして中身がリント対象から漏れる恐れ) | 未確認 | 未確認 | 非公開(評価不能) |

### Q2 の結論(証拠が支持すること)

- 「Markdown が素の Markdown のまま読み書き・lint 可能」という要件を最も強く満たすのは、**CommonMark の構文範囲に収まる記法(Quartz のコールアウト `> [!info]`、remark-directive の `:::name`)**であり、これらは未対応のパーサーでも壊れず、地の文として扱われる。逆に**最も相性が悪いのは MDX/Mintlify の JSX 埋め込み**であり、remark ベースの textlint 実装は HTML/JSX ブロックの中身を不透明ノードとしてリント対象から外すのが一般的な挙動である(ベンダー文書には明記されていないが、複数の MDX 関連 issue が「MDX ファイルの地の文リンティングは未解決」と証言しており、間接的に裏付けられる)。
- **Astro の plain `.md` はコンポーネントを一切埋め込めない**ことが公式文書で確認された。デザインシステムのコンポーネントを Markdown から呼び出したいなら Astro は MDX 化が必須になり、そこで MDX 特有のリンティング問題を引き継ぐ。
- **Markdoc は「停滞している」という仮説は誤りで、直近まで活発に保守されている**が、2022年のローンチ時ほどの勢い・言及量は続いていない。「宣言的で審査可能な Markdown 拡張」という設計思想は Stripe 社員自身の言葉で裏付けられるが、"MDX に明示的に対抗している" という記述は現行ドキュメントからは確認できなかった。
- **コールアウト/アドモニション構文の分断は、5件の独立した実名 GitHub issue によって具体的に裏付けられた実在の問題**である。GitHub 自身のアラート構文(`> [!NOTE]`)、Docusaurus の `:::note`、MkDocs Material の `!!! note`、Quartz/Obsidian の `> [!info]` は概念としては同じでも構文が異なり、複数のツール間でコンテンツを共有しようとした実践者が実際に詰まっている。textlint/natural-japanese の観点では、**構文自体が CommonMark の枠内に収まる方式(ブロッククォート派生のコールアウト、ディレクティブの未対応時フォールバック)を選ぶことがリスクを最小化する**という結論を支持する材料が揃った。
- Mintlify については、Anthropic 自身のドキュメントの実配線を確認した結果、**依頼文の前提(docs.claude.com が Mintlify)は現状もはや成立しない**ことが判明した。claude.com/docs は Mintlify(CDN フィンガープリントで確認)、platform.claude.com/docs(docs.claude.com のリダイレクト先)はセルフホストの Next.js — Anthropic 自身が単一ツールに依存していない実例として、この比較全体への含意がある(単一のツールに全面依存しなくても運用は成立する)。

---

## 前例が見つからなかったもの(no precedent found)

- Quartz(またはその他の SSG)と Cloudflare Access を組み合わせて「非公開デジタルガーデン」を運用していることを一人称のエッセイ形式で書いた、実名かつ検証可能な個人ブログ記事(GitHub issue やリファレンス的な設定ページは見つかったが、運用の感想を綴った記事そのものは見つからなかった)。
- 「Obsidian Publish / Notion / Cloudflare Access / セルフホストを試して、別の方式に乗り換えた」という一人称の移行談(Q1)。
- HTML オーサリングから Markdown+コンポーネントへ移行した(またはその逆をした)という実名の記録(Q2)。
- Cloudflare Access / Zero Trust の無料枠ユーザー数上限をベンダー一次資料で明記したページ(コミュニティの伝聞「50ユーザー」のみ確認、ベンダー一次未確認)。
- Cloudflare Access/Zero Trust の稼働率 SLA を明記した現行ページ。
- Quartz や他 SSG の静的サイトについてのページ読み込み速度・Lighthouse パフォーマンスの測定値。
- Obsidian Publish のユーザー数・サイト数などの規模を示す数字。
- claude.ai Artifact の「link rot」(unpublish 後にリンクが機能しなくなる)を実際に踏んだという外部からの苦情報告(ベンダー文書自身にはリスクの明記があるが、外部での報告事例は見つからなかった)。
- Tailscale Funnel 機能(選択的な公開インターネット露出)についてのドキュメント — Q1 の「あとで1件だけ公開」を Tailscale 単体でどう実現するかへの直接的な答えとして重要だが、本セッションでは未取得。
- コールアウト/アドモニション構文の分断そのものを主題にした、長文のブログ記事・エッセイ(GitHub issue レベルの証言は複数あるが、論考としてまとめた記事は見つからなかった)。
- Markdoc の「MDX に明示的に対抗する」という位置づけを裏付ける、現行ドキュメント上の一次記述。
