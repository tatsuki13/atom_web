// Display-only topic inference. These genres never overwrite stored memory categories.
const topicGenreRules = [
  ['food','食べ物・料理', /料理|食事|食べ|飲食|お菓子|おかし|パン|ご飯|ごはん|米飯|おにぎり|おむすび|カレー|ハンバーグ|うどん|そば|蕎麦|パスタ|スパゲティ|ピザ|焼肉|焼き肉|焼き魚|刺身|天ぷら|てんぷら|味噌汁|みそ汁|納豆|豆腐|卵|玉子|野菜|果物|くだもの|りんご|リンゴ|林檎|みかん|ミカン|いちご|イチゴ|苺|バナナ|ぶどう|ブドウ|葡萄|桃|もも|トマト|きゅうり|キュウリ|人参|にんじん|じゃがいも|ジャガイモ|チョコ|アイス|プリン|お饅頭|まんじゅう|煎餅|せんべい|コーヒー|珈琲|紅茶|お茶|緑茶|牛乳|ジュース|カフェ|レストラン|グルメ|和食|洋食|お酒|日本酒|ワイン|ビール|ラーメン|寿司|お寿司|ケーキ|クッキング/gu],
  ['person','人名・人物', /人名|名前は|という(?:人|方)|(?:[一-龠々]{1,5}|[ァ-ヶー]{2,15})(?:さん|先生|氏|様|くん|君|ちゃん)|(?:田中|山田|佐藤|鈴木|高橋|渡辺|伊藤|中村|小林|加藤)[ 　]?[一-龠々]{1,4}|大谷翔平|藤井聡太|美空ひばり/gu],
  ['gardening','園芸・自然', /園芸|ガーデニング|家庭菜園|菜園|植物|花壇|鉢植え|盆栽|庭いじり|庭仕事|庭の手入れ|自然|野鳥|バードウォッチング|花を|花の(?:栽培|世話)|野菜を育|バラ|薔薇|観葉植物|^花$|^庭$/gu],
  ['exercise','運動・スポーツ', /運動|スポーツ|散歩|ウォーキング|歩く|体操|ヨガ|ジョギング|ランニング|水泳|泳ぐ|野球|サッカー|テニス|ゴルフ|登山|山登り|サイクリング|自転車|ダンス|筋トレ/gu],
  ['travel','旅行・外出', /旅行|旅先|旅館|温泉|観光|外出|お出かけ|出かけ|遠出|ドライブ|海外|国内旅行|ツアー|キャンプ|ハイキング|神社巡り|寺巡り|花火/gu],
  ['arts','音楽・映画・芸術', /音楽|映画|歌う|歌を|カラオケ|歌謡|演歌|ピアノ|ギター|楽器|コンサート|演奏|美術|芸術|絵画|絵を描|写真|撮影|書道|俳句|短歌|舞台|演劇|落語|テレビ|ドラマ|アニメ/gu],
  ['reading','読書・学び', /読書|本を読|小説|図書館|文学|読んで|歴史|勉強|学習|学ぶ|語学|英語|外国語|資格|講座|学び|研究|科学|数学/gu],
  ['craft','手芸・ものづくり', /手芸|編み物|編物|裁縫|刺繍|刺しゅう|陶芸|工作|ものづくり|物作り|折り紙|折紙|木工|プラモデル|手作り|\bDIY\b/giu],
  ['digital','IT・デジタル', /パソコン|スマートフォン|スマホ|コンピュータ|インターネット|プログラミング|人工知能|ゲーム|アプリ|動画配信|\b(?:AI|IT|PC|SNS|YouTube|LINE|Python|JavaScript)\b/giu],
  ['relationships','家族・人付き合い', /家族|友人|友達|知人|近所付き合い|人付き合い|交流|孫|息子|娘|夫婦|妻|夫|祖母|祖父|母|父|兄弟|姉妹|ペット|犬|猫/gu],
  ['work','仕事・社会', /仕事|職場|働く|勤務|会社|同僚|上司|退職|就職|職業|ボランティア|地域活動|自治会|社会活動/gu],
  ['communication','会話の好み', /口調|話し方|敬語|ため口|タメ口|返答|応答|説明|聞き役|話す速さ|お話しの速さ/gu],
  ['daily','暮らし・健康', /暮らし|生活|掃除|洗濯|片付け|買い物|買物|家事|住まい|健康|体調|睡眠|眠り|寝る|起床|病院|通院|治療|服薬|血圧|リハビリ|介護|福祉/gu],
];
const otherTopicGenre = {id:'other', label:'その他', rank:topicGenreRules.length};
export const topicGenres = [...topicGenreRules.map(([id,label],rank) => ({id,label,rank})), otherTopicGenre];

function matchTopicGenre(value) {
  const text = typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : '';
  if (!text.trim()) return null;
  let best = null, bestScore = 0;
  for (const [rank, [id, label, pattern]] of topicGenreRules.entries()) {
    // Unique clues avoid letting repeated words dominate a mixed-topic statement.
    const matches = [...new Set(text.match(pattern) ?? [])];
    const score = matches.reduce((sum, word) => sum + (word.length === 1 ? 1 : 3), 0);
    if (score > bestScore) { bestScore = score; best = {id, label, rank}; }
  }
  return best;
}

export function inferTopicGenre(text, context = '', category = null) {
  // A known interest keyword takes precedence over incidental topics in its episodes.
  if (category === 'person') return topicGenres.find(genre => genre.id === 'person');
  return matchTopicGenre(text) ?? matchTopicGenre(context) ?? otherTopicGenre;
}

export function resolveTopicGenre(item, text, context = '') {
  return topicGenres.find(genre => genre.id === item.topicGenre) ?? inferTopicGenre(text, context, item.category);
}

export function groupByTopicGenre(items, textOf, contextOf = () => '') {
  const groups = new Map();
  for (const item of items) {
    const genre = resolveTopicGenre(item, textOf(item), contextOf(item));
    if (!groups.has(genre.id)) groups.set(genre.id, {genre, items:[]});
    groups.get(genre.id).items.push(item);
  }
  return [...groups.values()].sort((a,b) => a.genre.rank - b.genre.rank);
}

export function createGenreEditor(item, genre, editing) {
  const label = document.createElement('details');
  label.className = 'genre-editor';
  if ((!editing?.save && !editing?.change) || !editing.keyOf(item)) {
    label.hidden = true;
    return label;
  }
  const toggle = document.createElement('summary');
  toggle.textContent = '⚙';
  toggle.title = '項目を編集';
  const availableActions = editing.save ? editing.change ? 'ジャンルを変更・訂正・削除' : 'ジャンルを変更' : '訂正・削除';
  toggle.setAttribute('aria-label', `${item.keyword ?? item.content ?? '項目'}の${availableActions}`);
  label.append(toggle);
  const feedback = document.createElement('span');
  feedback.setAttribute('role','status');
  feedback.className = 'genre-save-status';
  label.addEventListener('keydown', event => {
    if (event.key === 'Escape') { label.open = false; toggle.focus(); }
  });
  let select = null;
  if (editing.save) {
    select = document.createElement('select');
    select.setAttribute('aria-label', `${item.keyword ?? item.content ?? '項目'}のジャンル`);
    for (const entry of [{id:'',label:'自動分類に戻す'}, ...topicGenres]) {
      const option = document.createElement('option');
      option.value = entry.id; option.textContent = entry.label;
      select.append(option);
    }
    select.value = item.topicGenre ?? '';
    select.addEventListener('change', async () => {
      const value = select.value || null;
      select.disabled = true; feedback.textContent = '保存中…';
      try {
        await editing.save(editing.kind, editing.keyOf(item), value);
        feedback.textContent = '保存しました。';
      } catch {
        select.value = item.topicGenre ?? '';
        feedback.textContent = '保存できませんでした。もう一度変更してください。';
      } finally { select.disabled = false; }
    });
    label.append(select);
  }
  label.append(feedback);
  if (editing.change) {
    const actions = document.createElement('div');
    actions.className = 'record-actions';
    const panel = document.createElement('div');
    panel.className = 'record-edit-panel'; panel.hidden = true;
    const input = document.createElement('textarea');
    input.maxLength = editing.kind === 'memory' ? 240 : 60;
    input.rows = editing.kind === 'memory' ? 4 : 2;
    input.setAttribute('aria-label',editing.kind === 'memory' ? '訂正後の記憶' : '訂正後の項目名');
    const question = document.createElement('p');
    question.className = 'record-delete-question'; question.textContent = 'この項目を削除しますか？';
    const confirm = document.createElement('button');
    confirm.type = 'button'; confirm.className = 'record-confirm';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'キャンセル';
    let action = null;
    const draftKey = `${editing.kind}:${editing.keyOf(item)}`;
    let draft = editing.drafts?.get(draftKey);
    const discardDraft = () => {
      if (draft && editing.drafts?.get(draftKey) === draft) editing.drafts.delete(draftKey);
      draft = null;
    };
    const showDraft = () => {
      action = draft.action; label.open = true;
      actions.hidden = true; panel.hidden = false;
      if (select) select.disabled = true;
      input.value = draft.value;
      input.hidden = action !== 'editRecord'; question.hidden = action !== 'deleteRecord';
      confirm.textContent = action === 'editRecord' ? '保存' : '削除する';
    };
    input.addEventListener('input', () => { if (draft) draft.value = input.value; });
    const close = () => {discardDraft();panel.hidden = true;actions.hidden = false;if (select) select.disabled = false;feedback.textContent = '';};
    for (const [value,text] of [['editRecord','訂正'],['deleteRecord','削除']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = value === 'deleteRecord' ? 'record-delete secondary' : 'secondary'; button.textContent = text;
      button.addEventListener('click', () => {
        draft = {action:value,value:item.content ?? item.keyword ?? '',expectedContent:item.content ?? item.keyword};
        editing.drafts?.set(draftKey,draft);
        showDraft(); feedback.textContent = '';
        if (value === 'editRecord') input.focus();else cancel.focus();
      });
      actions.append(button);
    }
    if (draft) showDraft();
    cancel.addEventListener('click',close);
    confirm.addEventListener('click',async () => {
      if (action === 'editRecord' && !input.value.trim()) {feedback.textContent = '内容を入力してください。';input.focus();return;}
      confirm.disabled = true;cancel.disabled = true;input.disabled = true;feedback.textContent = '処理中…';
      try {
        await editing.change(editing.kind,editing.keyOf(item),action,draft?.expectedContent ?? item.content ?? item.keyword,input.value);
        discardDraft();
      } catch (error) {
        feedback.textContent = error?.code === 'functions/failed-precondition' ? '内容が変更されています。一覧を更新してください。' : error?.code === 'functions/already-exists' ? '同じ項目名がすでにあります。' : '処理できませんでした。一覧を更新して確認してください。';
      } finally {confirm.disabled = false;cancel.disabled = false;input.disabled = false;}
    });
    panel.append(input,question,confirm,cancel);
    label.append(actions,panel);
  }
  return label;
}
