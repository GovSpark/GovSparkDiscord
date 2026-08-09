# GovSpark Discord Recorder

Discord のボイスチャンネルを録音し、MP3 を Google Drive に保存する TypeScript 製 Bot です。

## 動作

- VC 参加者の `/start` で、その VC の録音を開始します。
- `/stop`、または全参加者の退出で録音を停止します。
- 音声を単一 MP3 にミックスして Google Drive へアップロードし、指定テキストチャンネルに共有 URL を投稿します。
- 同時録音は 1 件だけです。Bot が作成した録音は 90 日後に自動削除します。

## セットアップ

1. Node.js 20 以上と FFmpeg を用意します。
2. Google Cloud Console で Google Drive API を有効化し、OAuth 2.0 Client ID、Client Secret、Refresh Token を取得します。
3. Google Drive に録音専用フォルダを作り、その URL の `/folders/` より後ろにある ID を確認します。
4. `cp .env.example .env` を実行し、取得した値を設定します。
5. `npm install && npm run register-commands` を実行します。
6. `npm run dev`（開発）または `npm run build && npm start`（本番）を実行します。

Bot に VC の閲覧・接続、結果チャンネルへの送信権限を付与してください。この Bot が使う Gateway Intent に Privileged Intent の有効化は不要です。

## Render

`render.yaml` と `Dockerfile` を含めています。Render の Web Service（Free）としてデプロイし、`.env.example` の値を Render の環境変数として登録してください。Dockerfile が FFmpeg を導入し、Render が設定する `PORT` で HTTP サーバーを起動します。

- `GET /`: Bot の接続状態と録音状態を返します。
- `GET /healthz`: Discord 接続済みなら HTTP 200、未接続なら HTTP 503 を返します。

Render の無料 Web Service は受信アクセスが一定時間ないとスリープします。スリープ中は Discord から切断され、進行中の録音も中断されるため、常時稼働させる場合は外部の監視サービスから公開 URL の `/healthz` へ定期的にアクセスしてください。

Google OAuth の認証には `https://www.googleapis.com/auth/drive` スコープを使用し、Refresh Token を Render の Secret 環境変数として登録してください。保存先には録音専用フォルダを使用してください。アップロードしたファイルは「リンクを知っている全員が閲覧可」に変更されます。

録音中に Render の再起動またはデプロイが行われた場合、録音途中のデータは破棄され、中断通知を投稿します。共有 URL は転送可能なため、録音・公開・90 日保存について事前にサーバールールで周知してください。
