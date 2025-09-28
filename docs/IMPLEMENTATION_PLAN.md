# Obsidian MCP Implementation Plan

> このドキュメントはユーザー提供の仕様マークダウンをレポジトリ内で参照できるよう再構成したものです。範囲が広いため段階的に分割し、達成済みのフェーズにはチェックを入れて進捗を管理します。

## 目的 / スコープ
- **目的**: Obsidian の Vault を AI エージェントから安全に読み書き・検索できる MCP サーバーを構築する。
- **前提**: 自ホスト、読み書き両対応、タグやリンク、セマンティック検索、ドライラン→承認→適用フロー、Git 連携など。

（中略: 詳細仕様は `docs/spec/` 以下に分割予定）

## マイルストーン進捗

### M0 — ブートストラップ / 基盤
- [x] レポ構成作成（TS/Node20・ESM）
  - [x] `package.json` / `tsconfig.json` / `eslint` / `prettier`
  - [x] `.gitignore`（`/.mcp/**`除外）
  - [x] `src/` フォルダ構成の雛形
  - (O) 初期コミット
- [x] 設定ローダ（env > config.json > default）
  - [x] `config.schema.ts`（zod等）＋バリデーション
  - [x] `storage.vaultSubdir=".mcp"` / `markdown.profile="omp-default"`
  - (O) `config.example.json` / `.env.example`
- [~] 構造化ログ（JSON）
  - [ ] リクエストID / レベル / モジュール / 経過ms
  - [x] `log/logger.ts`
- [ ] ディレクトリ用意（起動時）
  - [ ] `/<Vault>/.mcp/{diff,logs,metrics}`
  - (A) 存在しなければ自動作成

### M1 — Read/Search（FS-only, stdio）
- [x] SQLite 初期化（WAL / incremental vacuum 相当の PRAGMA 設定）
- [x] スキーマ定義（`notes` / `chunks` / `fts_chunks` / `journal`）
- [x] インデクサ（初回フルスキャン + chokidar 監視）
- [x] Markdown パーサ（frontmatter / heading / block ID / リスト / コード対応）
- [x] `vault.search` ツール実装（FTS5 キーワード検索 + フィルタ）
- [x] `vault.get` ツール実装（heading / block range 対応）
- [x] MCP stdio トランスポート起動
- [ ] ユニットテスト / スモークテスト整備

- [ ] `/status` / `/healthz` エンドポイント（M1.5）

## 次のアクション
1. インデクサと検索周りのユニットテスト・スモークテストを追加し、CI フローを整備する。
2. Vault サブディレクトリ（`.mcp/{diff,logs,metrics}`）の自動作成と監査ログの詳細設計を行う。
3. `/healthz` `/status` など M1.5 の監視系インターフェースを追加し、実行時ステータスを確認できるようにする。

