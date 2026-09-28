# Kawanabe Notion Blog

公開用Notionデータベースの記事をAstroで静的HTMLに変換し、GitHub Pagesに公開します。下書きDBは読みません。URLはNotionのページIDを使うため、タイトルや公開日を変更しても変わりません。

## Notionの準備

1. [Notion Integrations](https://www.notion.so/profile/integrations) で内部インテグレーションを作り、「Read content」を許可する。
2. **公開用データベースだけ**を接続（共有）する。下書きDBは接続しない。
3. 公開DBのURLからデータベースIDを控える。記事にはタイトル、`タグ`（複数選択）、`公開日`（日付）を設定する。`AIカスタム自動...` は参照しない。
4. 公開対象の記事を下書きDBから公開DBへ移す。公開DBへの移動だけでは即時反映されず、次回ビルド時に反映される。

公開DB内の記事はすべて公開対象です。非公開にしたい記事は、先に公開DBから移してください。公開日に時刻は入力せず、日付だけ設定してください。本文の段落、見出し、リスト、画像、コードなどを表示します。一部の埋め込みや特殊なブロックはNotionへのリンクになります。

## ローカルで実行

Node.js 22以降を推奨します。

```bash
npm ci
cp .env.example .env
# .env に自分のNOTION_API_KEYとNOTION_DATABASE_IDを設定
set -a; source .env; set +a
npm run build
npm run preview
```

`.env` はGit管理から除外されています。APIキーをリポジトリや公開HTMLに書かないでください。API取得エラー時はビルドが失敗し、空の記事一覧を公開しません。

## GitHub Pagesへ切り替える

1. リポジトリの Settings → Secrets and variables → Actions に `NOTION_API_KEY` と `NOTION_DATABASE_ID` を Repository secrets として登録する。
2. Settings → Pages → Build and deployment → Source を **GitHub Actions** にする。
3. この変更を `main` に反映する。Actions の `Deploy blog` を手動実行し、成功を確認する。

毎日12:17 JSTにNotionを読み直して自動更新します。即時反映したいときは Actions → Deploy blog → Run workflow を実行してください。Google Search Consoleで `https://rkaw0619.github.io/rkaw_blog/sitemap.xml` を送信できます。インデックス登録自体は検索エンジンの判断で、保証されません。

GitHub PagesはGitHubの公開サイトです。Notion上で後から記事を非公開にしても、次の成功したデプロイまで静的HTMLは残ります。また、検索エンジンのキャッシュやアーカイブは別途残る場合があります。
