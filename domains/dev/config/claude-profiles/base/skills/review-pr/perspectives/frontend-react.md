# Frontend (React/TypeScript)

## 観点

| 観点 | チェック内容 |
|------|-------------|
| コンポーネント設計 | 単一責任、props制御（外部から全状態を制御できるか）、テスタビリティ |
| 状態管理 | 不要なuseState/useEffect、派生状態の計算、Suspense/Server Components活用 |
| 型安全性 | any回避、discriminated unions、型ガード、genericsの適切な使用 |
| レンダリング | 不要な再レンダリング、メモ化(useMemo/useCallback)の適切さ、key propの正確さ |
| アクセシビリティ | セマンティックHTML要素の選択、ARIA属性、キーボード操作、フォーカス管理 |
| HTML/CSS | 要素の意味的な適切さ、レスポンシブ対応、ブラウザ互換性 |
| データフェッチ | useEffectでのfetch回避、Server Components活用、ローディング/エラー状態の網羅 |
| テスト | 振る舞いテスト（実装詳細でなく）、モック最小化、ユーザー操作シナリオ |

## 参考文献

- [react.dev](https://react.dev) — コンポーネント設計、hooks、Server Components
- [Fluent React (Tejas Kumar)](https://www.oreilly.com/library/view/fluent-react/9781098138707/) — Reactの内部動作、レンダリング最適化
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/) — 型設計
- [Testing Library](https://testing-library.com/docs/) — 振る舞いテストの原則
- [MDN Web Docs](https://developer.mozilla.org/) — HTML/CSS/Web API
- [HTML Living Standard](https://html.spec.whatwg.org/) — HTML要素の仕様
- [WAI-ARIA Practices](https://www.w3.org/WAI/ARIA/apg/) — アクセシビリティパターン
- [Web Content Accessibility Guidelines (WCAG)](https://www.w3.org/WAI/standards-guidelines/wcag/) — アクセシビリティ基準
