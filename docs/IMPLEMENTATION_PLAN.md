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

（M1 以降の詳細チェックリストは仕様ドキュメントを参照）

## 次のアクション
1. 設定ローダとバリデーションを実装する。
2. 構造化ロガーの雛形を追加し、起動時に利用する。
3. Vault 用ディレクトリの自動作成処理を追加する。

