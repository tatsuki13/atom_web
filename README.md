# ATOM 状態・記憶ビューアー

管理者がログインID（`user1`など）を指定して、Firestoreの状態・記憶を閲覧するWebページです。

## 起動・配置

Node.js 22以上とFirebase CLIが必要です。コマンドはこのリポジトリのルートで実行します。

```sh
npm ci
npm start
```

[http://localhost:5002](http://localhost:5002)を開きます。ローカル起動でも認証・取得APIは本番Firebase (`challenge-atom-1c763`) に接続します。

Web画面の変更は作業ブランチで行い、次のコマンドでプレビュー環境を発行します。`codex-update-viewer`は作業ブランチ名に置き換えてください。

```sh
npm run build && firebase hosting:channel:deploy codex-update-viewer --project challenge-atom-1c763
```

発行されたURLで動作確認してからPull Request（PR）を作成します。コードとプレビュー環境をリポジトリ管理者が確認し、問題がなければ管理者が`main`へマージします。本番公開はマージ後に公開担当者が行います。

Firebase CLIへのログインと対象プロジェクトへのHosting配置権限が必要です。本番公開では既存のデフォルトHostingサイトを更新するため、公開先を変更する場合は `firebase.json` の `hosting.site` を設定してください。

## リポジトリの役割

このリポジトリは管理用Web画面専用です。実装は `admin-web/`、画面・グラフのテストは `tests/` にあります。以前のNext.jsアプリとそのAPI・Prisma実装は置き換えています。

Firebase Authentication、Firestore、取得API `adminConversationViewer` は既存のFirebaseプロジェクトを共用します。Functions、Firestoreルール、管理者アカウントの管理は [challenge_atom](https://github.com/chocolate-kuma/challenge_atom) 側に残します。サーバーの秘密鍵・サービスアカウントはこのWebリポジトリには配置しません。

APIの変更・配置が必要な場合は、`challenge_atom` のルートで実行します:

```sh
firebase deploy --only functions:conversation:conversationChat,functions:conversation:conversationState,functions:conversation:adminConversationViewer --project challenge-atom-1c763
```

## 使い方

1. アプリと同じ管理者ログインID（例: `admin1`）またはメールアドレスでログイン。
2. 対象のログインID（例: `user1`）を入力して「データを表示」。表示名は登録があれば表示し、UIDは「ユーザー詳細」で確認できます。
3. 「状態」で推移グラフ・発話ごとの推定値・身体情報、「記憶」で興味関心・保存済みの記憶を確認。
4. 会話の選択で状態の参照先を変更。「最新の記録を取得」で再取得。

## 権限・データ

管理者APIは認証と`admin: true`のcustom claimを確認した後、`{ログインID}@internal.local`からUIDを特定して読み取ります。検索はログインIDのみで指定します。UIDをキーにした既存の保存先は変更せず、移行も不要です。同じ管理者の認証更新では閲覧状態を維持し、ログアウト・アカウント変更・権限取消時はデータを消去します。保存済みの記憶本文の変更・削除機能はありません。Firestoreルールとアプリの表示設定も変更していません。

取得範囲:

- 会話一覧: 最新30件。選択中の会話が一覧から外れた場合は、その会話も追加します。初期表示は終了済みを含む最新の会話。
- 状態推移: 選択した会話の直近500メッセージに含まれるユーザー発話の`emotionScores`。点の吹き出し用にユーザーの発言本文も取得します。アシスタントの本文は返しません。未推定値では線を途切れさせ、前回値維持は三角で区別します。
- 記憶: 有効な記憶を最大300件。趣向は確認済み・有効な保存元を最大300件参照。
- 今日の記録・身体情報: 日本時間の日付で`conversation_daily`と`health_daily`を参照。

グラフの点をクリックすると、軸名・値・日時・発話本文・推定状態をPC向けの吹き出しで表示します。別の点で切り替え、外側のクリック・閉じるボタン・Escで閉じます。キーボードでは点を選択してEnter／Spaceで開けます。前回値を維持した点は現在の発言と元の推定発言を分け、保存された`previousMessageId`を取得済み履歴の範囲でたどります。元の記録が取得範囲外・欠損の場合は確認できない旨を表示します。未保存のAIの判断理由は生成しません。ユーザー・会話・タブの切り替えやログアウト時には吹き出しを閉じます。

本文表示に必要なAPIが未反映の場合は、このリポジトリからHostingを、`challenge_atom`から`adminConversationViewer`をそれぞれ更新してください。Hostingだけ更新した場合も画面は動きますが、本文は取得できない旨の表示になります。

グラフの横軸は発話順の等間隔で、最初は直近30発話を表示します。スライダーは取得済みの全履歴を対象とし、「前へ・次へ」や点のクリックでも発話を選択できます。選択が表示範囲を外れると、最大30発話の範囲が追従します。発話日時と表示中の発話番号も確認できます。

状態の時系列グラフは肯定的感情・不安・孤独感・快と不快・活性度・元気さ・行動への意欲の7軸を表示します。縦軸は−1〜＋1、0を中央にした共通スケールで、V2の9段階（0.25刻み）に対応します。各カードに両端の意味を表示し、正負による良し悪しの色分けは行いません。既存の発話ごとの`interest`値は変更せず、画面の時系列表示からのみ除外しています。

状態タブには全会話を通じた興味・関心を四象限グラフで表示します。縦軸は興味の方向、横軸は活動状況（既定）と本人の自発性を切り替えます。活動状況はactive＝右、paused＝左の分類で、頻度の数値を創作しません。自発性はサーバーの`spontaneityScore`（0〜1）を使います。座標が欠ける旧データは未判定の一覧に残し、0は有効な値として扱います。縦位置は最新の`explicitPolarity`の明言を優先（positiveは上側、negativeは下側）し、それ以外は`interestScore`を使います。確かさ`confidence`は点の濃さ、推定中は点の破線で示します。根拠量に基づく目安であり、校正された確率ではありません。重なる点のキーワードは引き出し線で配置し、下の一覧からもマウス・キーボードで詳細を選べます。記憶タブは確定済みかつ明示的否定でない項目だけを表示します。`details`の本人発言を「好きな点」「きっかけ」「経験」に分け、従来の`sourceMemoryIds`の記憶と併記します。Web側で確定状態や保存データを書き換えません。

興味・関心は会話AIが会話から自動で蓄積・更新します。このWeb画面は閲覧専用で、手動の登録・割合修正・確定・削除の操作や編集APIの呼び出しはありません。キーワードのブロックには最後に話題が出た日時と、活動状況がある場合に「活動中」「休止中」を表示します。休止中だけでは興味なしにせず、推定中から確定への変更もしません。状態タブの四象限グラフでも活動状況と「興味なしの明言あり」を区別します。古いAPIで追加フィールドがなくても従来表示を維持します。

「更新」で`adminConversationViewer`を再取得します。ユーザー切り替え・会話切り替え・ログアウト・権限取消後に遅れて届いた応答は画面へ反映しません。

Functionsの変更を伴う場合は、先に`challenge_atom`で上記3つのFunctionsをデプロイしてください。Web画面の変更は、このリポジトリで`npm test`を実行し、ブランチのプレビューURLで動作確認してからPRを作成します。本番Hostingへの公開は`main`へのマージ後に公開担当者が行います。

旧キーワード推定と`context-v1`の4軸、および`context-v2`の各軸は、0〜1から`2 * 値 - 1`で換算し、最も近い0.25刻みに丸めます（`context-v2`の`valence`は元から符号付きのため換算しません）。`context-v3` / `context-v4`は元の符号付き値を表示します。未推定の初期値0は中程度と区別し、値も点も表示しません。旧記録にない追加軸も未推定です。換算は表示時だけで、保存データや推定APIは変更しません。現在の推定APIが4軸を保存している場合、追加4軸はV2形式の記録が保存されるまで未推定になります。

Firebase設定はHostingの`/__/firebase/init.json`から取得します。SDKはFirebase公式CDNの12.0.0です。[Firebase公式の説明](https://firebase.google.com/docs/hosting/reserved-urls)

## 開発・検証

```sh
npm run build
npm test
```

グラフの編集元は `admin-web/src/state-trend.ts` です。生成物 `admin-web/state-trend.js` はGit管理せず、起動・テスト・デプロイ前に自動ビルドします。`challenge_atom/functions/node_modules` への依存はありません。

テストでは画面の権限拒否、ユーザー・会話切り替え、ログアウト時のデータ消去、グラフの欠損値・前回値維持・吹き出し表示を確認します。Firebase SDK・DOMはモックのため、本番のログインとデータ取得は起動後に確認してください。取得APIの認証・ユーザー分離のテストは `challenge_atom` 側で管理します。

## チーム向け：ブランチでの開発とGitHubへの反映

Web画面の編集は必ず作業ブランチで行います。編集後はテストとFirebase HostingのプレビューURLで動作確認を行い、PRを作成します。リポジトリ管理者がコードとプレビュー環境を確認し、問題がなければ管理者が`main`へマージします。以下はすべて `atom_web` フォルダ内で実行します。

### 1. 最新コードを取得し、作業ブランチを作る

`git status` で作業途中の変更がないことを確認します。変更がある場合は、先にその作業をコミットするなどして保存してください。ブランチ名の `codex-update-viewer` は今回の作業に合った名前に変えます。プレビューチャンネル名にも使うため、英数字とハイフンを使います。

```sh
git status
git switch main
git pull --ff-only origin main
git switch -c codex-update-viewer
npm ci
npm start
```

`npm ci` は初回、別フォルダにcloneしたとき、または取得した変更で依存関係・lockfileが更新されたときに実行します。毎回必須ではありません。

`npm start` はTypeScriptをビルドしてからローカルサーバーを起動します。[http://127.0.0.1:5002](http://127.0.0.1:5002) を開き、ターミナルは起動したままにします。終了は `Ctrl+C` です。追加のコマンドは、別のターミナルで同じフォルダを開いて実行できます。

ローカルで配信する画面から、本番Firebaseの認証・取得APIに接続します。

### 2. 編集したファイルに応じて反映する

| 編集したもの | 対象ファイルの例 | ローカルへの反映・確認 |
|---|---|---|
| HTML | `admin-web/index.html` | 保存してブラウザを再読み込み |
| CSS | `admin-web/styles.css` | 保存してブラウザを再読み込み |
| JavaScript | `admin-web/app.js` | 保存してブラウザを再読み込み |
| TypeScript（グラフ） | `admin-web/src/state-trend.ts` | 別ターミナルで `npm run build` → ブラウザを再読み込み |
| テスト | `tests/` 内 | `npm test` |
| Firebase設定 | `firebase.json`、`.firebaserc` | サーバーを `Ctrl+C` で終了 → `npm start` で再起動 |
| 依存パッケージ | `package.json` の依存関係 | `npm install` → サーバーを再起動 |
| 説明文 | `README.md` | 文章・コマンドの内容を確認。ビルド不要 |

グラフは `admin-web/src/state-trend.ts` を編集します。自動生成される `admin-web/state-trend.js` は直接編集せず、Gitにも追加しません。現在は自動監視による再ビルドはないため、TypeScriptの編集後はビルドが必要です。

開発用パッケージを追加する場合は、`パッケージ名` を実際の名前に置き換えて実行します。

```sh
npm install --save-dev パッケージ名
```

依存関係の変更では、`package.json` と `package-lock.json` の両方をコミットします。他のメンバーは変更取得後に `npm ci` を実行します。

### 3. GitHubへ上げる前に確認する

画面・コード・設定・テストを変更した場合は、次を実行します。

```sh
npm test
git status
git diff
```

`npm test` はビルドも自動実行するため、直前に別途 `npm run build` を実行する必要はありません。テスト成功後、ブラウザでも変更した部分の動作を確認します。READMEだけの変更であればテストは不要です。

### 4. プレビュー環境を発行して動作確認する

Web画面を変更した場合は、作業ブランチで次を実行します。`codex-update-viewer`は現在のブランチ名に置き換えてください。

```sh
npm run build && firebase hosting:channel:deploy codex-update-viewer --project challenge-atom-1c763
```

`npm run build`と`firebase hosting:channel:deploy`は別のコマンドです。`&&`でつなぎ、ビルドが成功した場合だけプレビューへ配置します。

コマンドの出力に表示されたプレビューURLをブラウザで開き、ログイン・データ取得と変更箇所の動作を確認します。修正した場合はテストと同じチャンネルへのデプロイを再実行し、プレビューURLで再確認してください。プレビュー環境も本番Firebaseの認証・取得APIに接続します。

READMEだけの変更であれば、プレビュー環境の発行と画面の動作確認は不要です。

### 5. コミットして作業ブランチをpushし、PRを作成する

編集内容によらず、GitHubへ送る手順は共通です。

```sh
git add .
git diff --cached
git commit -m "管理画面の表示を改善"
git push -u origin HEAD
```

`git diff --cached` で今回の作業に関係する変更だけが含まれていることを確認してからコミットします。コミットメッセージは変更内容に合わせます。`git add .` は現在のフォルダ以下の変更をまとめて追加するため、一部だけ上げる場合は `git add admin-web/styles.css` のようにファイルを指定してください。

プレビューURLで動作確認できたら、push後にGitHubで作業ブランチから`main`へのPull Request（PR）を作成します。PR本文には変更内容、テスト結果、プレビューURL、プレビューで確認した内容を記載してください。READMEだけの変更では、プレビュー確認を省略した旨を記載します。コードとプレビュー環境をリポジトリ管理者が確認し、問題がなければ管理者が`main`へマージします。作業者はマージせず、レビューを待ちます。

`node_modules/`、生成された `admin-web/state-trend.js`、`.env` などは `.gitignore` でGitの対象から除外しています。

同じブランチで追加修正するときも、確認 → `git add` → `git commit` → `git push` の手順です。pushすると既存のPRに追加の変更が反映されます。Web画面の追加修正では、プレビューも再デプロイして動作確認し、PRの確認結果を更新してください。

### 6. マージ後に公開担当者がデプロイする

GitHubへのpush・PRのマージと、Firebaseへの公開は別の操作です。このリポジトリには現時点で自動デプロイの設定はありません。

公開担当者は、作業途中の変更がない状態でマージ済みのコードを取得し、次を実行します。

```sh
git switch main
git pull --ff-only origin main
npm ci
npm test
npm run deploy
```

`npm run deploy` はビルドしてから、本番Firebaseプロジェクト `challenge-atom-1c763` の既存のHostingサイトを更新します。実行にはFirebase CLIへのログインと配置権限が必要です。各自のブランチをローカルで確認するときは`npm start`、レビュー用のプレビューを発行するときは手順4のコマンドを使用します。

このコマンドが公開するのはWeb画面だけです。Functions・Firestoreルール・認証アカウントの管理は `challenge_atom` 側で行います。READMEやテストだけの変更では、Web画面の再公開は不要です。

普段の流れは「ブランチ作成 → 編集 → `npm test` → プレビュー発行 → 発行されたURLで動作確認 → コミット・push → PR作成 → 管理者がコードとプレビューを確認 → 管理者が`main`へマージ」です。本番公開はマージ後に公開担当者が行います。
