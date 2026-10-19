# ATOM 状態・記憶ビューアー

管理者がログインID（`user1`など）を指定して、Firestoreの状態・記憶を閲覧するWebページです。

## 起動・配置

Node.js 22以上とFirebase CLIが必要です。コマンドはこのリポジトリのルートで実行します。

```sh
npm ci
npm start
```

[http://localhost:5002](http://localhost:5002)を開きます。ローカル起動でも認証・取得APIは本番Firebase (`challenge-atom-1c763`) に接続します。

Web画面だけを公開する場合:

```sh
npm run deploy
```

Firebase CLIへのログインと対象プロジェクトへのHosting配置権限が必要です。既存のデフォルトHostingサイトを更新するため、公開先を変更する場合は `firebase.json` の `hosting.site` を設定してください。

## リポジトリの役割

このリポジトリは管理用Web画面専用です。実装は `admin-web/`、画面・グラフのテストは `tests/` にあります。以前のNext.jsアプリとそのAPI・Prisma実装は置き換えています。

Firebase Authentication、Firestore、取得API `adminConversationViewer` は既存のFirebaseプロジェクトを共用します。Functions、Firestoreルール、管理者アカウントの管理は [challenge_atom](https://github.com/chocolate-kuma/challenge_atom) 側に残します。サーバーの秘密鍵・サービスアカウントはこのWebリポジトリには配置しません。

APIの変更・配置が必要な場合は、`challenge_atom` のルートで実行します:

```sh
firebase deploy --only functions:conversation:adminConversationViewer --project challenge-atom-1c763
```

## 使い方

1. アプリと同じ管理者ログインID（例: `admin1`）またはメールアドレスでログイン。
2. 対象のログインID（例: `user1`）を入力して「データを表示」。表示名は登録があれば表示し、UIDは「ユーザー詳細」で確認できます。
3. 「状態」で推移グラフ・発話ごとの推定値・身体情報、「記憶」で興味関心・保存済みの記憶を確認。
4. 会話の選択で状態の参照先を変更。「最新の記録を取得」で再取得。

## 権限・データ

管理者APIは認証と`admin: true`のcustom claimを確認した後、`{ログインID}@internal.local`からUIDを特定して読み取ります。検索はログインIDのみです。UIDをキーにした既存の保存先は変更せず、移行も不要です。同じ管理者の認証更新では閲覧状態を維持し、ログアウト・アカウント変更・権限取消時はデータを消去します。記憶の変更・削除機能はありません。Firestoreルールとアプリの表示設定も変更していません。

取得範囲:

- 会話一覧: 最新30件。選択中の会話が一覧から外れた場合は、その会話も追加します。初期表示は終了済みを含む最新の会話。
- 状態推移: 選択した会話の直近500メッセージに含まれるユーザー発話の`emotionScores`。点の吹き出し用にユーザーの発言本文も取得します。アシスタントの本文は返しません。未推定値では線を途切れさせ、前回値維持は三角で区別します。
- 記憶: 有効な記憶を最大300件。趣向は確認済み・有効な保存元を最大300件参照。
- 今日の記録・身体情報: 日本時間の日付で`conversation_daily`と`health_daily`を参照。

グラフの点をクリックすると、軸名・値・日時・発話本文・推定状態をPC向けの吹き出しで表示します。別の点で切り替え、外側のクリック・閉じるボタン・Escで閉じます。キーボードでは点を選択してEnter／Spaceで開けます。前回値を維持した点は現在の発言と元の推定発言を分け、保存された`previousMessageId`を取得済み履歴の範囲でたどります。元の記録が取得範囲外・欠損の場合は確認できない旨を表示します。未保存のAIの判断理由は生成しません。ユーザー・会話・タブの切り替えやログアウト時には吹き出しを閉じます。

本文表示に必要なAPIが未反映の場合は、このリポジトリからHostingを、`challenge_atom`から`adminConversationViewer`をそれぞれ更新してください。Hostingだけ更新した場合も画面は動きますが、本文は取得できない旨の表示になります。

グラフの横軸は発話順の等間隔で、最初は直近30発話を表示します。スライダーは取得済みの全履歴を対象とし、「前へ・次へ」や点のクリックでも発話を選択できます。選択が表示範囲を外れると、最大30発話の範囲が追従します。発話日時と表示中の発話番号も確認できます。

状態グラフは肯定的感情・関心と興味・不安・孤独感・快と不快・活性度・元気さ・行動への意欲の8軸を表示します。縦軸は−1〜＋1、0を中央にした共通スケールで、V2の9段階（0.25刻み）に対応します。各カードに両端の意味を表示し、正負による良し悪しの色分けは行いません。

旧キーワード推定と`context-v1`の4軸、および`context-v2`の各軸は、0〜1から`2 * 値 - 1`で換算し、最も近い0.25刻みに丸めます（`context-v2`の`valence`は元から符号付きのため換算しません）。`context-v3` / `context-v4`は元の符号付き値を表示します。未推定の初期値0は中程度と区別し、値も点も表示しません。旧記録にない追加軸も未推定です。換算は表示時だけで、保存データや推定APIは変更しません。現在の推定APIが4軸を保存している場合、追加4軸はV2形式の記録が保存されるまで未推定になります。

Firebase設定はHostingの`/__/firebase/init.json`から取得します。SDKはFirebase公式CDNの12.0.0です。[Firebase公式の説明](https://firebase.google.com/docs/hosting/reserved-urls)

## 開発・検証

```sh
npm run build
npm test
```

グラフの編集元は `admin-web/src/state-trend.ts` です。生成物 `admin-web/state-trend.js` はGit管理せず、起動・テスト・デプロイ前に自動ビルドします。`challenge_atom/functions/node_modules` への依存はありません。

テストでは画面の権限拒否、ユーザー・会話切り替え、ログアウト時のデータ消去、グラフの欠損値・前回値維持・吹き出し表示を確認します。Firebase SDK・DOMはモックのため、本番のログインとデータ取得は起動後に確認してください。取得APIの認証・ユーザー分離のテストは `challenge_atom` 側で管理します。
