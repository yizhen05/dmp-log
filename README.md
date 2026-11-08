# dmp-log

デュエル・マスターズの **DMPランキング** 用の戦績ノート。
大会ごとの勝敗・順位・獲得ptを記録して、公式ルール（週ごとに公認CS上位2大会のみ加算）で集計します。

- 大会名（DMPランキングの表記）を貼ると「主催＠会場」に自動で分ける
- 参加人数・順位・認定ジャッジからptを自動計算（2026年下期以降のポイント表）
- 主催別・会場別・デッキ別の勝率と入賞回数（PP-「P」配布ライン）
- シーズン（上期・下期）ごとの管理、メモ形式での書き出し
- ログイン：メール＋パスワード / Google / X

構成：Next.js（App Router）＋ Supabase（PostgreSQL・Auth）。Vercel にデプロイする想定です。

## セットアップ

### 1. Supabase

1. [Supabase](https://supabase.com/) でプロジェクトを作る
2. **SQL Editor** で `supabase/migrations/0001_init.sql` の中身を貼り付けて実行
3. **Authentication → URL Configuration**
   - Site URL：本番のURL（例：`https://dmp-log.vercel.app`）
   - Redirect URLs：`http://localhost:3000/auth/callback` と `https://<本番のURL>/auth/callback`
4. **Authentication → Providers**
   - Email：最初から有効
   - Google：Google Cloud で OAuth クライアントを作り、承認済みリダイレクトURIに `https://<project-ref>.supabase.co/auth/v1/callback` を登録 → Client ID / Secret を入力
   - X / Twitter (OAuth 2.0)：X Developer Portal で OAuth 2.0 アプリを作り、Callback URL に同じ `.../auth/v1/callback` を登録 → Client ID / Secret を入力

### 2. ローカルで動かす

```bash
cp .env.example .env.local   # Supabase の URL とキーを入れる
npm install
npm run dev
```

### 3. Vercel にデプロイ

GitHub のこのリポジトリを Vercel に Import して、環境変数 `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY`（または `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`）を設定するだけです。

## 前のツールからのデータ移行

Claude で作った「DMP戦績ノート」の **書き出し・設定 → バックアップ** の文字列をコピーし、
dmp-log にログイン後、最初の画面（または「書き出し・設定 → 前のツールから取り込む」）に貼り付けると、
シーズン・記録・呼び名をまとめて取り込めます。

## データの持ち方

| テーブル | 中身 |
|---|---|
| `seasons` | シーズン（名前、週ごとに加算する大会数） |
| `entries` | 大会の記録（日付・集計週・種類・大会名・主催・会場・勝敗・人数・順位・pt…） |
| `aliases` | 大会名から自動で使う呼び名（例：ブックオフイオン橋本店 → 橋本） |

どのテーブルも Row Level Security で「自分のデータだけ読み書きできる」ようにしています。

## ディレクトリ

```
app/            画面（/ が戦績ノート、/login がログイン、/auth/* が認証の受け口）
components/     Notebook.tsx（戦績ノートの画面本体）
lib/dmp.ts      週の集計・pt計算・入賞判定・大会名の分解などのロジック
lib/supabase/   Supabase クライアント
supabase/       DB スキーマ（SQL）
```
