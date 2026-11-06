# Herdrのmodを自作するときの制約

調査日 2026-11-06。対象はherdr-app 0.1.13。参考のmod、アプリのソース、LiteLLM v1.103.0のソースを読み、実動作は未確認である。自作のmodは`esh2n/herdr-mods`に置く。

## 結論

- modの描画は約50ミリ秒で打ち切られる。色の連続ごとに要素を作ると、ロボット7体で打ち切られた報告があり、355要素では動いた（herdr-sit-and-watch）。
- アプリの画像読み込みはアプリのフォルダに閉じ、外へ出るシンボリックリンクを拒否する（gpui-kit `assets.rs`、ディレクトリのリンクで試験）。ファイル単位のリンクは未確認なので、絵はJavaScriptの四角形で描く。
- 動きは`transition`、`spring`、`loop`、`frames`で作る。`frames`は文字だけを切り替え、画像の連番の機能はない。modの再描画はウィンドウ全体に及ぶ。
- `agents()`は変更時に描き直しを起こすので問い合わせが要らない。マシン名を持たないので`spaces()`と突き合わせる。`terminals()`の描画中の呼び出しは遠隔マシンで遅くなりうる。
- modは別のmodのフォルダを読み込めない。
- サイドバーへの配置には`main`レイアウトの複製が要る（#520で要望中）。`place: "none"`と`tab.new`の組み合わせなら要らない。
- `herdr-pixel-office`は端末版Herdrのプラグインで、herdr-appのmodではない。
- `exec`には標準入力の指定がない。既定の時間制限は30秒、上限は600秒。`hc send`は貼り付けてEnterを押すので、シェルへ送ると中身が実行される。
- 仮想リストの行内の`on_click`は描画を壊すので`on_item_click`を使う。

## LiteLLMの記録

- 通信ごとの記録は`GET /spend/logs/v2`で読める。`start_date`と`end_date`が必須で、データベースがないと401を返す。
- ハーネスは`request_tags`の`User-Agent: <name>`か`metadata.user_agent`で見分ける。全ハーネスが同じ鍵を使うので、鍵では見分けられない。
- 最終的な失敗は記録に残るが、内部の再試行で成功した失敗は残らない。
- 記録の書き込みは約2秒ごとで、通信がないと最大30秒まで間隔が延びる。これは10〜15秒とした`2026-09-30-agent-cost-method.md`の記述の、1行ごとの記録についての訂正である。実測はしていない。
- 実行中の通信を一覧する手段はない。`litellm_in_flight_requests`はラベルなしの件数で、全HTTPを数える。
- Claude CodeとCodexの通信はLiteLLMを通らないので、どの記録にも現れない。

## AIによる変更の分類

- `pulls.review`は、ファイルごとの一覧と20万文字までの差分をモデルに渡し、全ファイルが1回ずつ分類されたかを検査し、足りなければ1回再試行する。分類結果はHEADごとに保存し、自動ではやり直さない。
- 分類の品質を測った資料はなかった。コミット分割の論文は別の課題で、根拠にならない。

## 出典

- https://github.com/herdrdev/herdr-app
- https://github.com/herdrdev/herdr-app/issues/520
- https://github.com/herdrdev/herdr-app/issues/212
- https://github.com/funny-it-worked-last-time-gsv/herdr-sit-and-watch
- https://github.com/devangchhajed/herdr-pixel-office
- https://github.com/mukiwu/herdr-crew-rpg
- https://github.com/pilmokim/herdr-pixel-spaces
- https://github.com/Aryan1092raj/Herdr-pets
- https://github.com/JinJieBeWater/herdr-pulls-review
- https://github.com/antfu/pulls.review
- https://github.com/iampedii/herdr-redline
- https://github.com/vytasgavelis/herdr-reviewer
- https://github.com/Mantiq-com/herdr-commit-review
- https://github.com/BerriAI/litellm
