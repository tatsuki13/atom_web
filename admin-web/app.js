import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut, onIdTokenChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js';
import { getFirestore, collection, query, where, orderBy, limit, getDocsFromServer } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import { renderStateTrend, closeStateTrendPopup } from './state-trend.js';
import { renderInterestRegistry, renderInterestChart } from './interest-registry.js?v=20261028-records';
import { renderMemoryList, fitMemoryList, fitInterestList } from './memory-list.js?v=20261028-records';

const $ = id => document.getElementById(id);
let auth, db, load, authorized = false, revision = 0, selectedLoginId = '', selectedConversation = null;
let verifiedAdminUid = null, authRevision = 0;
let visibleMemories = [];
let visibleInterests = [], genreEditingEnabled = false;
let recordEditingEnabled = false;
const date = value => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'});
};
function status(message = '', error = false) { $('status').textContent = message; $('status').hidden = !message; $('status').classList.toggle('error', error); }
function resetData() {
  closeStateTrendPopup($('state-trend'));
  visibleMemories = [];
  visibleInterests = []; genreEditingEnabled = false;
  recordEditingEnabled = false;
  $('memory-sort').disabled = true;
  $('memory-count').textContent = '';
  $('memory-scroll-hint').hidden = true;
  revision++; selectedLoginId = ''; selectedConversation = null;
  $('results').hidden = true;
  $('physical-note').textContent = '';
  $('physical-refresh').disabled = true;
  $('physical').setAttribute('aria-busy','false');
  for (const id of ['metrics','physical','interest-chart','keywords','memories','conversation','state-trend']) $(id).replaceChildren();
  for (const id of ['target-id','target-name','target-uid']) $(id).textContent = '';
  $('user-details').open = false;
  $('user-avatar').textContent = '';
}
function clearSession() {
  authorized = false; verifiedAdminUid = null;
  resetData(); busy(false);
  $('target-login-id').value = '';
  $('viewer').hidden = true; $('login-panel').hidden = false;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function metrics(target, rows) {
  $(target).replaceChildren(...rows.map(([label, value, unit]) => {
    const node = element('div', null, 'metric');
    node.append(element('small',label), element('strong',`${value ?? '—'} ${unit}`));
    return node;
  }));
}
function render(data) {
  $('target-id').textContent = data.loginId ?? selectedLoginId;
  $('target-name').textContent = data.displayName ?? '';
  $('target-name').hidden = !data.displayName;
  $('user-avatar').textContent = String(data.displayName || data.loginId || selectedLoginId).slice(0, 1).toUpperCase();
  $('target-uid').textContent = data.uid;
  $('fetched-at').textContent = `更新 ${new Date().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo'})}`;
  const m = data.metrics ?? {};
  metrics('metrics', [['会話',m.conversationCount ?? 0,'回'],['発話',m.userMessageCount ?? 0,'件'],['時間（目安）',Number(m.estimatedMinutes ?? 0).toFixed(1),'分']]);
  const sessions = data.conversations ?? [];
  $('conversation').replaceChildren(...sessions.map(s => {
    const option = element('option', `${date(s.updatedAt)} · ${s.title} (${s.messageCount}件)`);
    option.value = s.id; return option;
  }));
  $('conversation').disabled = sessions.length === 0;
  if (!sessions.length) $('conversation').append(element('option','会話の記録はありません'));
  $('conversation').value = data.conversationId ?? '';
  $('conversation-note').textContent = data.limits?.conversations ? (sessions.length > 30 ? '最新30件と選択中の会話を表示' : '最新30件を表示') : '';
  $('conversation-note').hidden = !data.limits?.conversations;
  renderStateTrend($('state-trend'), data.emotionHistory, data.limits?.emotionHistory === true);
  renderPhysical(null);
  visibleMemories = data.memories ?? [];
  visibleInterests = data.interestKeywords ?? [];
  genreEditingEnabled = data.capabilities?.topicGenreEditing === true;
  recordEditingEnabled = data.capabilities?.recordEditing === true;
  renderInterests();
  $('memory-count').textContent = `${visibleMemories.length}件`;
  $('memory-sort').disabled = visibleMemories.length === 0 && !visibleInterests.some(item =>
    (item.confirmationState === 'confirmed' || item.confirmationState == null) && item.explicitPolarity !== 'negative');
  renderMemories();
  $('memory-note').textContent = data.limits?.memories ? '取得した300件の範囲で並べ替えています。' : '';
  $('memory-note').hidden = !data.limits?.memories;
  $('results').hidden = false;
}
function renderMemories() {
  renderMemoryList($('memories'), visibleMemories, $('memory-sort').value || 'category', date, genreEditing('memory'));
  $('memory-scroll-hint').hidden = visibleMemories.length <= 9;
  fitMemoryPanels();
}
function genreEditing(kind) {
  return {kind,keyOf:item=>kind === 'memory' ? item.id : item.normalizedKey ?? item.keyword,
    save:genreEditingEnabled ? saveGenre : null,change:recordEditingEnabled ? changeRecord : null};
}
async function changeRecord(kind,key,action,expectedContent,content) {
  if (!authorized || !recordEditingEnabled) throw new Error('unauthorized');
  const current = revision,uid = $('target-uid').textContent,loginId = selectedLoginId;
  const response = (await load({loginId,action,kind,key,expectedContent,...(action === 'editRecord' ? {content} : {})})).data;
  if (!authorized || current !== revision || uid !== $('target-uid').textContent) return;
  if (response?.saved !== true || response.uid !== uid || response.action !== action || response.key !== key) throw new Error('save failed');
  await fetchData(loginId,selectedConversation);
}
function renderInterests() {
  renderInterestChart($('interest-chart'),visibleInterests,genreEditing('interest'),visibleMemories);
  renderInterestRegistry($('keywords'),visibleInterests,visibleMemories,genreEditing('interest'),$('memory-sort').value || 'category');
  fitMemoryPanels();
}
function fitMemoryPanels() {
  fitMemoryList($('memories'));
  fitInterestList($('memories'),$('keywords'));
}
async function saveGenre(kind, key, topicGenre) {
  if (!authorized || !genreEditingEnabled) throw new Error('unauthorized');
  const current = revision, uid = $('target-uid').textContent;
  const result = (await load({loginId:selectedLoginId,action:'setTopicGenre',kind,key,topicGenre})).data;
  if (!authorized || current !== revision || uid !== $('target-uid').textContent) return;
  if (result?.saved !== true || result.uid !== uid || result.topicGenre !== topicGenre) throw new Error('save failed');
  const rows = kind === 'memory' ? visibleMemories : visibleInterests;
  for (const item of rows) if (genreEditing(kind).keyOf(item) === key) item.topicGenre = topicGenre;
  renderMemories(); renderInterests();
  status('ジャンルを保存しました。');
}
$('memory-sort').addEventListener('change', () => {
  renderMemories();
  renderInterestRegistry($('keywords'),visibleInterests,visibleMemories,genreEditing('interest'),$('memory-sort').value || 'category');
  $('keywords').scrollTop = 0;
  fitMemoryPanels();
});
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(fitMemoryPanels);
  observer.observe($('memories')); observer.observe($('keywords'));
}
$('keywords').addEventListener('toggle',fitMemoryPanels,true);
function renderPhysical(data) {
  const physical = data?.physicalSignals;
  const value = (number, unit) => typeof number === 'number' && Number.isFinite(number) && number >= 0
    ? `${number.toLocaleString('ja-JP', {maximumFractionDigits:1})}${unit}` : 'データなし';
  const sleep = physical?.sleepMinutes;
  const rows = [
    ['歩数',value(physical?.steps,'歩')],
    ['睡眠時間',typeof sleep === 'number' && Number.isFinite(sleep) && sleep >= 0
      ? `${Math.floor(sleep / 60)}時間${Math.floor(sleep % 60)}分` : 'データなし'],
    ['通常心拍数（当日平均）',value(physical?.heartRate,' bpm')],
    ['安静時心拍数（当日平均）',value(physical?.restingHeartRate,' bpm')],
  ];
  $('physical').replaceChildren(...rows.map(([label,text])=>{
    const node=element('div',null,'metric');
    node.append(element('small',label),element('strong',text));return node;
  }));
  $('physical-note').textContent = physical
    ? `対象日: ${physical.date ?? '不明'}（${physical.date === data.today ? '今日' : '過去の保存データ'}）\n最終同期成功: ${date(physical.recordedAt)}${physical.date === data.today ? '' : '\n今日のデータはまだ同期されていません。'}`
    : '同期済みの身体データはありません。';
}
async function fetchPhysicalData(loginId, current = revision) {
  const uid = $('target-uid').textContent;
  if (!authorized || !loginId || !uid) return;
  $('physical-refresh').disabled = true;
  $('physical').setAttribute('aria-busy','true');
  $('physical-note').textContent = '保存済みの身体データを読み込み中…';
  try {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
    }).format(new Date());
    const tomorrow = new Date(`${today}T00:00:00+09:00`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    // 検索で解決済みのUIDを使用し、キャッシュではなくサーバーから最新1日分を取得する。
    const snapshot = await getDocsFromServer(query(
      collection(db,'users',uid,'health_daily'),
      where('date','<',tomorrow), orderBy('date','desc'), limit(1),
    ));
    if (current !== revision || !authorized || uid !== $('target-uid').textContent) return;
    const latest = snapshot.docs[0];
    const data = latest?.data();
    const recordedAt = data?.updatedAt?.toDate?.();
    renderPhysical({today, physicalSignals: latest ? {
      date:latest.id, steps:data.steps, sleepMinutes:data.sleepMinutes,
      heartRate:data.heartRate, restingHeartRate:data.restingHeartRate,
      recordedAt:recordedAt instanceof Date && Number.isFinite(recordedAt.getTime())
        ? recordedAt.toISOString() : null,
    } : null});
  } catch(error) {
    if (current !== revision || !authorized) return;
    renderPhysical(null);
    const code = error?.code?.replace(/^firestore\//,'');
    $('physical-note').textContent = code === 'permission-denied'
      ? '身体データの読み取り権限がありません。管理者アカウントとFirestoreルールの公開状況を確認してください。'
      : code === 'unauthenticated'
        ? 'ログインし直して身体データを再取得してください。'
        : '身体データを取得できませんでした。通信状態を確認して再取得してください。';
  } finally {
    if (current === revision && authorized) {
      $('physical-refresh').disabled = false;
      $('physical').setAttribute('aria-busy','false');
    }
  }
}
function busy(value) {
  for (const id of ['search-button','refresh','conversation']) $(id).disabled = value;
  $('search-button').textContent = value ? '検索中…' : '検索';
  $('refresh').textContent = value ? '更新中…' : '更新';
  $('viewer').setAttribute('aria-busy', String(value));
}
function errorMessage(error) {
  const code = error?.code?.replace(/^(auth|functions)\//,'');
  return {
    'invalid-credential':'ログインIDまたはパスワードが違います。',
    'wrong-password':'ログインIDまたはパスワードが違います。',
    'user-not-found':'ログインIDまたはパスワードが違います。',
    'invalid-email':'ログインIDを確認してください。',
    'too-many-requests':'時間をおいてからもう一度お試しください。',
    'network-request-failed':'認証サービスに接続できません。通信状態を確認してください。',
    'invalid-api-key':'FirebaseのWeb接続設定を確認してください。',
    'permission-denied':'管理者権限がありません。管理者アカウントでログインし直してください。',
    'unauthenticated':'ログインし直してください。',
    'not-found':'ユーザーまたは会話が見つかりません。ログインIDを確認してください。',
    'invalid-argument':'ログインIDまたは会話IDを確認してください。',
  }[code] ?? (error?.code?.startsWith('auth/') ? 'ログインできませんでした。認証設定と通信状態を確認してください。' : 'データを取得できませんでした。時間をおいて再試行してください。');
}
async function fetchData(loginId, conversationId) {
  if (!authorized) return;
  resetData(); const current = revision;
  busy(true); status('読み込み中…');
  try {
    const result = await load({loginId,...(conversationId ? {conversationId} : {})});
    if (current !== revision || !authorized) return;
    selectedLoginId = result.data.loginId ?? loginId; selectedConversation = result.data.conversationId;
    render(result.data); status();
    void fetchPhysicalData(selectedLoginId,current);
  } catch (error) { if (current === revision) status(errorMessage(error),true); }
  finally { if (current === revision) { busy(false); $('conversation').disabled = !$('conversation').value; } }
}
$('login-form').addEventListener('submit',async event => {
  event.preventDefault(); if (!auth) return;
  $('login-button').disabled = true; status('ログインしています…');
  const id = $('login-id').value.trim();
  try { await signInWithEmailAndPassword(auth,id.includes('@') ? id : `${id}@internal.local`,$('password').value); }
  catch(error) { status(errorMessage(error),true); }
  finally { $('password').value = ''; $('login-button').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  authRevision++; clearSession();
  try { await signOut(auth); } catch { status('ログアウトを完了できませんでした。もう一度お試しください。',true); }
});
$('search-form').addEventListener('submit',event => { event.preventDefault(); fetchData($('target-login-id').value.trim(),null); });
$('target-login-id').addEventListener('input',() => { resetData(); busy(false); status(); });
$('refresh').addEventListener('click',() => fetchData(selectedLoginId,selectedConversation));
$('physical-refresh').addEventListener('click',() => fetchPhysicalData(selectedLoginId));
$('conversation').addEventListener('change',event => fetchData(selectedLoginId,event.target.value));
function tab(name) {
  closeStateTrendPopup($('state-trend'));
  $('memory-sort-control').hidden = name !== 'memory';
  for (const key of ['state','memory']) { const active = key === name; $(`${key}-tab`).setAttribute('aria-selected',String(active)); $(`${key}-tab`).tabIndex = active ? 0 : -1; $(`${key}-panel`).hidden = !active; }
  if (name === 'memory') fitMemoryPanels();
}
globalThis.addEventListener('resize',()=>closeStateTrendPopup($('state-trend')));
globalThis.addEventListener('scroll',()=>closeStateTrendPopup($('state-trend')));
for (const name of ['state','memory']) {
  $(`${name}-tab`).addEventListener('click',() => tab(name));
  $(`${name}-tab`).addEventListener('keydown',event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'state' : event.key === 'End' ? 'memory' : name === 'state' ? 'memory' : 'state'; tab(next); $(`${next}-tab`).focus(); } });
}
async function initialize() {
  try {
    const response = await fetch('/__/firebase/init.json');
    if (!response.ok) throw new Error('configuration');
    const config = await response.json();
    if (!config.projectId || !config.apiKey) throw new Error('configuration');
    const app = initializeApp(config);
    db = getFirestore(app);
    auth = getAuth(app); await setPersistence(auth,browserSessionPersistence);
    const functions = getFunctions(app,'asia-northeast1');
    load = httpsCallable(functions,'adminConversationViewer');
    onIdTokenChanged(auth, async user => {
      const check = ++authRevision;
      const sameAdmin = authorized && user?.uid === verifiedAdminUid;
      if (!sameAdmin) clearSession();
      $('logout').hidden = !user;
      if (!user) { status(); return; }
      try {
        const token = await user.getIdTokenResult();
        if (check !== authRevision) return;
        if (token.claims.admin !== true) { clearSession(); status('管理者権限がありません。ログアウトして管理者アカウントでログインしてください。',true); return; }
        authorized = true; verifiedAdminUid = user.uid;
        $('viewer').hidden = false; $('login-panel').hidden = true;
        if (!sameAdmin) { busy(false); status(); }
      } catch {
        if (check === authRevision) { clearSession(); status('管理者権限を確認できませんでした。ログインし直してください。',true); }
      }
    });
  } catch { $('login-button').disabled = true; status('Firebase接続設定を取得できません。Firebase Hostingでこのページを起動してください。',true); }
}
initialize();
