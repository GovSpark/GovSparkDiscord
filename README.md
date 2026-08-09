# GovSpark Discord Recorder

Discord のボイスチャンネルを録音し、MP3 を Cloudflare R2 に保存する TypeScript 製 Bot です。

## 動作

- VC 参加者の `/start` で、その VC の録音を開始します。
- `/stop`、または全参加者の退出で録音を停止します。
- `/start`時に開始音、`/stop`時に停止音をVCで再生します。無人化による自動停止では停止音を再生しません。
- 音声を単一 MP3 にミックスして Cloudflare R2 へアップロードし、指定テキストチャンネルに公開 URL を投稿します。
- 録音開始者へDMを送り、会議の概要・決定事項・次の対応を結果Embedへ追記できます。
- 同時録音は 1 件だけです。R2のライフサイクルルールで録音を90日後に自動削除します。

## セットアップ

1. Node.js 20 以上と FFmpeg を用意します。
2. Cloudflare R2でバケットを作成し、Object Read & Write権限のR2 APIトークンを発行します。
3. バケットの公開アクセスを有効化し、`recordings/`を90日後に削除するライフサイクルルールを設定します。
4. `cp .env.example .env` を実行し、R2のEndpoint、Access Key ID、Secret Access Key、バケット名、公開URLを設定します。
5. `npm install && npm run register-commands` を実行します。
6. `npm run dev`（開発）または `npm run build && npm start`（本番）を実行します。

Bot に VC の閲覧・接続・発言、結果チャンネルへの送信・メッセージ履歴を読む権限を付与してください。この Bot が使う Gateway Intent に Privileged Intent の有効化は不要です。

## Render

`render.yaml` と `Dockerfile` を含めています。Render の Web Service（Free）としてデプロイし、`.env.example` の値を Render の環境変数として登録してください。Dockerfile が FFmpeg を導入し、Render が設定する `PORT` で HTTP サーバーを起動します。

- `GET /`: Bot の接続状態と録音状態を返します。
- `GET /healthz`: Discord 接続済みなら HTTP 200、未接続なら HTTP 503 を返します。

Render の無料 Web Service は受信アクセスが一定時間ないとスリープします。スリープ中は Discord から切断され、進行中の録音も中断されるため、常時稼働させる場合は外部の監視サービスから公開 URL の `/healthz` へ定期的にアクセスしてください。

R2のAccess Key IDとSecret Access KeyはRenderのSecret環境変数として登録してください。`R2_ENDPOINT`はS3 APIのEndpoint、`R2_PUBLIC_BASE_URL`は公開用の`r2.dev` URLまたは独自ドメインです。

録音中に Render の再起動またはデプロイが行われた場合、録音途中のデータは破棄され、中断通知を投稿します。共有 URL は転送可能なため、録音・公開・90 日保存について事前にサーバールールで周知してください。
