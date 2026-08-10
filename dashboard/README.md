# GovSpark Task Dashboard

Cloudflare Workers、D1、Reactで動作するDiscord連携タスク管理画面です。管理画面は対象Guildの「統括」ロールだけが利用でき、担当者はDiscord DMから進捗を報告します。

## Cloudflareの準備

Node.js 22以上を用意し、`dashboard`ディレクトリで以下を実行します。

```sh
npm install
npx wrangler login
npx wrangler d1 create govspark-tasks
```

表示された`database_id`を`wrangler.toml`へ設定します。同じファイルのGuild ID、各ロールID、通知チャンネルID、公開URLも実際の値へ変更してください。ロールIDはDiscordの「開発者モード」を有効化し、各ロールを右クリックして取得できます。

次の値は平文の`[vars]`には置かず、Workers Secretsとして登録します。

```sh
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TASK_API_SHARED_SECRET
```

`SESSION_SECRET`と`TASK_API_SHARED_SECRET`には、それぞれ十分に長い別のランダム値を使用します。`DISCORD_BOT_TOKEN`はRenderで使っているBot Tokenと同じ値です。

D1マイグレーションとデプロイを実行します。

```sh
npm run db:migrate:remote
npm run deploy
```

ローカル確認では`.dev.vars.example`を`.dev.vars`へコピーし、`npm run db:migrate:local && npm run dev`を実行します。

## Discord Developer Portal

対象Applicationで以下を設定します。

1. OAuth2のRedirect URIへ`https://<ダッシュボードURL>/api/auth/callback`を追加する。
2. Bot設定の「Server Members Intent」を有効にする。
3. Botへ通知チャンネルの「チャンネルを見る」「メッセージを送信」「埋め込みリンク」権限を付ける。

OAuthでは`identify`だけを要求します。Guild所属と統括ロールは、OAuthで特定したユーザーIDをBot APIで照合します。

## Render Botとの接続

Renderへ以下を追加して再デプロイします。

```dotenv
TASK_API_BASE_URL=https://<ダッシュボードURL>
TASK_API_SHARED_SECRET=<Workers Secretと同じ値>
```

未設定の場合も録音Botは従来どおり起動し、タスク報告Interactionだけが無効になります。

## 定期処理

Cron Triggerは毎分実行されます。

- 期限到達後、未報告担当者へ報告ボタン付きDMを送信します。
- 00:00 UTC（09:00 JST）に未報告者へ1日1回再通知します。
- 6時間ごとに担当者候補のDiscordロールを同期します。
- Discord通知に失敗した場合、最大5回再試行します。

Cloudflare DashboardのWorkers LogsとD1の`notification_outbox`で失敗を確認できます。
