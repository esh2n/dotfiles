---
name: human-interface-guidelines
description: Design intuitive, user-centered interfaces based on cognitive psychology and HCI principles. Use this skill when designing interaction patterns, information architecture, or evaluating UX decisions. Ensures interfaces match mental models and respect user cognition.
---

This skill guides the design of intuitive human interfaces that feel natural and effortless. Apply these principles when making UX decisions, designing flows, or evaluating existing interfaces.

**CRITICAL**: The best interface is invisible. Users should accomplish goals without thinking about the tool itself.

---

## Design Thinking

Before designing any interface, understand the cognitive context:

- **Mental Model**: How do users imagine this system works? Match their expectations, not your implementation.
- **Task Flow**: What are users trying to accomplish? Optimize for their goals, not your features.
- **Cognitive Budget**: Users have limited attention and energy. Every element costs mental effort.
- **Context**: Where, when, and how will this be used? Design for real conditions.

---

## UX Psychology

Leverage cognitive biases and effects to create better experiences:

**Perception & Trust**: Beautiful interfaces feel easier to use (aesthetic-usability effect). Familiar patterns reduce friction (familiarity bias). First impressions anchor all later judgments (anchor effect). End experiences on a high note (peak-end rule).

**Motivation & Engagement**: Show what others do (social proof). Display progress toward goals—effort increases as completion approaches (goal gradient). Incomplete tasks stick in memory (Zeigarnik effect). Let users invest and customize—they'll value it more (endowment effect).

**Framing Matters**: How you present information shapes decisions. "90% success" feels different than "10% failure." Defaults are powerful—most users never change them. Use these effects ethically to guide users toward good outcomes.

**Attention is Precious**: Users ignore anything that looks like an ad (banner blindness). They focus only on what seems relevant (selective attention). Respect their cognitive limits—chunk information, create clear hierarchy, eliminate noise.

---

## SHIG Checklist (Sociomedia Human Interface Guidelines)

100項目のUI/UXチェックリスト。設計時・レビュー時に参照。

### 1. 基本原則 (Fundamental Principles)

- [ ] **シンプルにする**: 機能や情報を厳選し、できるだけ要素を少なくする
- [ ] **簡単にする**: 目的達成までの手順と労力をできるだけ減らす
- [ ] **単純なものは単純なままに**: 簡単なタスクを複雑にしない
- [ ] **デザインは意味の提案**: 問題解決を超えて新しい視点を提供する
- [ ] **人間にポジティブな影響を与える**: 人間の成長と日常生活を豊かにする

### 2. メンタルモデル・オブジェクト指向 (Mental Model & OOUI)

- [ ] **メンタルモデル**: ユーザーが想像する利用モデルに合った構成と動きにする
- [ ] **オブジェクトベースにする**: 要件からオブジェクトを抽出しUIに反映する（OOUI）
- [ ] **ビューはオブジェクトを表象する**: 同じオブジェクトを複数のビューで表現する
- [ ] **オブジェクトは自身の状態を体現する**: オブジェクトが自分の状態を視覚的に示す
- [ ] **名詞→動詞の操作順序**: まず対象を選び、次に操作を選ぶ
- [ ] **ナビゲーション項目は名詞にする**: メニューやナビは名詞で表現
- [ ] **アイコンは名詞または形容詞を表す**: 動詞でなく名詞・形容詞をモチーフに
- [ ] **ユーザーイリュージョン**: システムの複雑さを隠す仮想環境を作る

### 3. シグニファイア・マッピング (Signifiers & Mapping)

- [ ] **シグニファイア**: 操作対象が見えており、その意味が一目でわかるようにする
- [ ] **マッピング**: 操作する所と結果が反映される所の対応を把握できるようにする
- [ ] **すべての操作可能な要素は意味を持つ**: 無意味な操作要素を置かない

### 4. 一貫性・ビジュアル (Consistency & Visual)

- [ ] **一貫性**: 配色・形状・配置・振る舞いに一貫したルールを適用する
- [ ] **視覚ゲシュタルト**: 近接・類似・閉合を活用し要素のグループ関係を示す
- [ ] **グラフィックのトーン＆マナーを揃える**: 視覚的な統一感を保つ
- [ ] **メニュー項目の位置を維持する**: メニューの位置を固定し予測可能にする
- [ ] **ハイライト表示は単一の要素を変更する**: 状態変化は1つの視覚要素で表現
- [ ] **錯視を考慮する**: 視覚的な錯覚に配慮したデザインにする
- [ ] **色やフォントを使いすぎない**: 視覚的なノイズを減らす
- [ ] **整理されたレイアウト構成**: 論理的で整然としたレイアウトにする

### 5. ユーザーコントロール・モードレス (User Control & Modeless)

- [ ] **ユーザーの主導権**: システムでなくユーザーがコントロールできるようにする
- [ ] **直接操作**: 画面上のオブジェクトに直接触れて操作している感覚を与える
- [ ] **モードレス**: できるだけモードをなくし、自由な順序でタスクを実行可能にする
- [ ] **ユーザーのためのツールにする**: 運営者でなくユーザーの利益を優先する
- [ ] **柔軟な作業方法を可能にする**: ユーザー独自のワークフローを許容する
- [ ] **操作に時間制限を設けない**: ユーザーのペースを尊重する

### 6. 言語・コミュニケーション (Language & Communication)

- [ ] **ユーザーの言葉を使う**: 技術用語でなくユーザーが普段使っている表現を用いる
- [ ] **データよりも情報を伝える**: 生データでなく意味のある情報として提示する
- [ ] **視覚的に何であるかを示し文字で説明する**: ビジュアルとテキストを組み合わせる
- [ ] **選択肢の文言は肯定文にする**: 否定形を避け肯定的な表現を使う
- [ ] **デフォルトボタンには具体的な動詞を用いる**: 「OK」でなく「保存」「送信」など

### 7. 認知負荷・記憶 (Cognitive Load & Memory)

- [ ] **ユーザーの記憶に頼らない**: 参照すべき情報は必要となるその場で参照できるようにする
- [ ] **空間記憶をサポートする**: レイアウトで情報の位置を覚えられるようにする
- [ ] **展望記憶**: 将来のタスクを思い出せるようサポートする
- [ ] **学習をサポートし、トレーニングは不要に**: 使いながら学べる設計にする

### 8. 制約・エラー防止 (Constraints & Error Prevention)

- [ ] **コンストレイント**: 行動を部分的に制限することで誤操作を減らす
- [ ] **エラーを回避する**: エラーメッセージより先にエラーが起きないよう工夫する
- [ ] **制限コントロールを活用する**: スライダー、ドロップダウン等で入力を制限
- [ ] **フリップフロップ問題を避ける**: トグルの状態が曖昧にならないようにする
- [ ] **ユーザーに厳密さを求めない**: 曖昧な入力も許容する
- [ ] **フールプルーフよりフェールセーフ**: 失敗を防ぐより失敗しても安全に
- [ ] **エラー表示は建設的にする**: 何が問題でどう解決するか示す
- [ ] **整合性を損なう操作をユーザーに求めない**: 矛盾する操作を強制しない

### 9. デフォルト・自動化 (Defaults & Automation)

- [ ] **プリコンピュテーション**: 先人が見つけている最適値をプリセットにする
- [ ] **操作がひとつしかないなら自動化する**: 選択肢が1つなら自動実行
- [ ] **よいデフォルト**: 最も使われる値をデフォルトに設定する
- [ ] **入力サジェスチョンを提示する**: 入力候補を提案する

### 10. 効率・法則 (Efficiency & Laws)

- [ ] **フィッツの法則**: 近くて大きいものほどポイントしやすい
- [ ] **ヒックの法則**: 選択肢の数に比例して判断時間がかかる（選択肢を減らす）
- [ ] **複雑性保存の法則**: 複雑性は減らせず移動できるのみ（ユーザーからシステムへ）
- [ ] **タスクコヒーレンス**: 過去の行動パターンから次の行動を予測する
- [ ] **メジャーなタスクに最適化**: 大多数のユーザーが行うタスクを前面に出す
- [ ] **ショートカットを用意する**: 経験あるユーザー向けに短縮操作を提供
- [ ] **ペンは紙の近くに置く**: 関連する要素は近くに配置する
- [ ] **クリック領域を拡大する**: ターゲット領域を視覚的サイズより大きくする

### 11. 説得・エンゲージメント (Persuasion & Engagement)

- [ ] **パースエージョン**: 説得的な仕掛け（推薦、報酬、シミュレーション等）で行動を促す
- [ ] **ガッツを見せる**: システムの内部動作を適度に見せて信頼を築く
- [ ] **即座の喜びを与える**: 即時的な満足感を提供する
- [ ] **ゲーム的要素を排除する**: 不要なゲーミフィケーションを避ける

### 12. フォーム・入力 (Forms & Input)

- [ ] **前提条件は先に提示する**: 必要な情報は入力前に伝える
- [ ] **データをバインドする**: 入力と表示を連動させる
- [ ] **ゼロ・ワン・インフィニティ**: 0個、1個、無制限の3パターンで設計
- [ ] **ユーザーが入力したものはユーザーのもの**: 入力データの所有権を尊重
- [ ] **入力フォームにはストーリー性を持たせる**: 論理的な流れで質問する
- [ ] **操作の流れを作る**: 自然なフローで操作を導く
- [ ] **値を入力させるのではなく結果を選ばせる**: 計算結果から選択させる
- [ ] **入力欄を構造化する**: 入力フィールドを論理的にグループ化
- [ ] **ラジオボタンは単数選択、チェックボックスはオンオフ**: 正しいコントロールを使う
- [ ] **回答の先送り**: 必須でない入力は後回しにできるようにする

### 13. フィードバック・レスポンス (Feedback & Response)

- [ ] **スクロール画面では続きがありそうに見せる**: コンテンツの継続を示唆する
- [ ] **プロパティの選択肢でプレビューを見せる**: 選択結果を事前に見せる
- [ ] **可能性と確率を区別する**: 起こりうることと起こりやすさを区別して伝える
- [ ] **黙って実行する**: 確認不要な操作は黙って実行する
- [ ] **画面の変化をアニメーションで表す**: 状態変化をアニメーションで示す
- [ ] **トランジションは両方向につける**: 進む・戻るの両方向にアニメーション
- [ ] **操作に対して0.1秒以内に反応を返す**: 即座のフィードバックを提供
- [ ] **操作の近くでフィードバックする**: 操作した場所の近くで結果を表示
- [ ] **プログレッシブ・ディスクロージャ**: 基本を先に、詳細は必要に応じて
- [ ] **UIロックを避ける**: 処理中も他の操作を許可する
- [ ] **反応の良い直感的な動き**: スムーズで自然なインタラクション

### 14. ナビゲーション (Navigation)

- [ ] **ウェイファインディング**: 現在地と目的地への道筋を明確にする
- [ ] **エスケープハッチ**: いつでも脱出・キャンセルできる手段を用意
- [ ] **直観的より慣用的に**: 独自の直感より慣習的なパターンを優先
- [ ] **ドリルダウンナビゲーションの方向**: 階層を下る方向を一貫させる
- [ ] **左＝戻る、右＝進む**: 水平方向の慣習に従う
- [ ] **モバイルは階層的レイアウト**: モバイルでは階層構造を活用

### 15. タッチ・ジェスチャー (Touch & Gesture)

- [ ] **タッチターゲットは7mm以上**: 最小タッチサイズを確保する
- [ ] **直接操作のジェスチャー**: スワイプ、ピンチなど直感的なジェスチャーを活用

### 16. アクセシビリティ (Accessibility)

- [ ] **スクリーンリーダー対応**: 支援技術との互換性を確保する
- [ ] **テキスト拡大を可能にする**: フォントサイズの変更に対応する
- [ ] **色だけに依存しない**: 色以外の手段でも情報を伝える

### 17. 国際化・プラットフォーム (i18n & Platform)

- [ ] **アイコンのモチーフは特定の文化に依存させない**: 普遍的なシンボルを使う
- [ ] **多言語化を想定したUIではラベル長さを考慮する**: テキスト拡張に対応
- [ ] **◯✕△等の記号を安易に使わない**: 文化によって意味が異なる記号に注意
- [ ] **肯定/否定ボタンの順序はプラットフォームに従う**: OS慣習を尊重
- [ ] **カスタマイズ機能に頼らない**: デフォルトで使いやすく設計する

---

## Never Do

NEVER design interfaces that:

- Force rigid sequences when flexibility is possible
- Hide undo or make actions irreversible without warning
- Rely on user memory for information you could display
- Use jargon instead of user language
- Make users wait without feedback
- Trick users with dark patterns (fake scarcity, hidden costs, shame tactics)
- Ignore accessibility—everyone should be able to use the interface
- Assume you know users without testing with real people (empathy gap)

---

## Review Questions

When evaluating any interface decision, ask:

1. Does this match how users think about the problem?
2. Can users immediately tell what to do and what's clickable?
3. Are users in control, or is the system forcing them?
4. Could this cause errors? Could we prevent them instead?
5. Is this the simplest path to the goal?
6. Does this respect user attention and reduce cognitive load?
7. Would this work for users with different abilities and contexts?

---

## Quick Reference

| カテゴリ | 重要度 | キーポイント |
|---------|--------|-------------|
| 基本原則 | ★★★ | シンプル・簡単・意味のある設計 |
| OOUI | ★★★ | オブジェクト中心、名詞→動詞 |
| シグニファイア | ★★★ | 見てわかる、操作と結果の対応 |
| 一貫性 | ★★★ | 同じ意味=同じ表現 |
| ユーザーコントロール | ★★★ | ユーザーが主導権を持つ |
| 言語 | ★★☆ | ユーザーの言葉、肯定文 |
| 認知負荷 | ★★★ | 記憶に頼らない |
| エラー防止 | ★★★ | 予防 > メッセージ |
| 効率・法則 | ★★☆ | Fitts, Hick, 複雑性保存 |
| フォーム | ★★☆ | ストーリー性、適切なコントロール |
| フィードバック | ★★★ | 0.1秒以内、操作の近く |
| ナビゲーション | ★★☆ | 現在地明確、エスケープハッチ |
| アクセシビリティ | ★★★ | 全員が使える設計 |

---

Remember: Great UX feels like no UX at all. When users forget they're using software and just accomplish their goals, you've succeeded.

Source: [Sociomedia Human Interface Guidelines](https://www.sociomedia.co.jp/category/shig)
