# Obsidian MCP Server (Scaffolding)

このリポジトリは、Obsidian Vault を安全に読み書き・検索する MCP サーバーの TypeScript 実装に向けた土台です。詳細な機能要件やマイルストーンは `docs/IMPLEMENTATION_PLAN.md` に記載しています。

## セットアップ

```bash
npm install
npm run build
```

## 開発スクリプト

- `npm run build` – TypeScript のトランスパイル
- `npm start` – ビルド済みのエントリーポイントを起動
- `npm run dev` – ウォッチ付きビルド
- `npm run lint` – ESLint による静的解析
- `npm test` – Vitest によるテスト実行（未実装）

## 設定

- `config.example.json` を参考に `config.json` を作成してください。
- `.env.example` に環境変数の例を示しています。

## ライセンス

MIT License
