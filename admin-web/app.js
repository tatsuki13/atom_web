import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut, onIdTokenChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js';
import { getFirestore, collection, query, where, orderBy, limit, getDocsFromServer, doc, getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import { renderStateTrend, closeStateTrendPopup } from './state-trend.js';
import { renderInterestRegistry, renderInterestChart } from './interest-registry.js?v=20261030-drafts';
import { renderMemoryList, fitMemoryList, fitInterestList } from './memory-list.js?v=20261030-drafts';

import { physicalToday, physicalDayOffset, validPhysicalDay, physicalDays, physicalFields, physicalFormatted, renderPhysicalHistory } from './physical-history.js?v=20261109-physical';
import { renderPhysicalTimeline } from './physical-timeline.js?v=20261110-chart-only';
import { loadPhysicalTimeline } from './physical-timeline-loader.js?v=20261110-chart-only';

const $ = id => document.getElementById(id);
let auth, db, load, authorized = false, revision = 0, selectedLoginId = '', selectedConversation = null;
let verifiedAdminUid = null, authRevision = 0;
let visibleMemories = [];
let visibleInterests = [], genreEditingEnabled = false;
let recordEditingEnabled = false;
let recordWritePending = false;
const recordDrafts = new Map();
let physicalEnd = physicalToday(), physicalSelected = physicalEnd, physicalPeriod = 7;
let physicalRecords = [], physicalRequest = 0, physicalTimelineRequest = 0;
const physicalTimelines = new Map();
function syncPhysicalControls() {
  $('physical-date').value = physicalEnd;
  $('physical-date').max = physicalToday();
  $('physical-previous').disabled = physicalEnd <= '2000-01-01';
  $('physical-next').disabled = physicalEnd >= physicalToday();
  for (const [id,count] of [['today',1],['week',7],['month',30]]) {
    $(`physical-${id}`).setAttribute('aria-pressed',String(physicalPeriod === count && (id !== 'today' || physicalEnd === physicalToday())));
  }
}
function resetPhysicalHistory() {
  physicalRequest++;
  physicalTimelineRequest++;physicalTimelines.clear();
  physicalEnd = physicalToday(); physicalSelected = physicalEnd; physicalPeriod = 7; physicalRecords = [];
  syncPhysicalControls();
  $('physical-history').replaceChildren();
  $('physical-timeline').replaceChildren();
  $('physical-timeline').setAttribute('aria-busy','false');
  $('physical-timeline-heading').textContent = '時刻別データ';
  $('physical-history').setAttribute('aria-busy','false');
  $('physical-range').textContent = '';
}
function drawSelectedPhysical() {
  const request=++physicalTimelineRequest;
  const day=physicalSelected,uid=$('target-uid').textContent,current=revision,historyRequest=physicalRequest;
  const selected=physicalRecords.find(item=>item.date===day);
  const container=$('physical-timeline');
  renderPhysical({today:physicalToday(),selectedDate:day,physicalSignals:selected});
  $('physical-timeline-heading').textContent=`${day} の時刻別データ`;
  const cached=physicalTimelines.get(day);
  const render=timeline=>{
    container.setAttribute('aria-busy','false');
    renderPhysicalTimeline(container,{...selected,timeline},day,$('physical-timeline-field').value || 'steps');
  };
  if(physicalTimelines.has(day)) {
    if(cached.error) {
      container.setAttribute('aria-busy','false');
      container.replaceChildren(element('p',cached.error,'physical-timeline-empty'));
    } else render(cached.timeline);
    return;
  }
  container.setAttribute('aria-busy','true');
  container.replaceChildren(element('p','保存済みの時刻別データを読み込み中…','muted small'));
  const isCurrent=()=>authorized && revision===current && physicalRequest===historyRequest &&
    physicalTimelineRequest===request && physicalSelected===day && $('target-uid').textContent===uid;
  void loadPhysicalTimeline((...parts)=>getDocFromServer(doc(db,...parts)),uid,day,isCurrent).then(timeline=>{
    if(!isCurrent()) return;
    physicalTimelines.set(day,{timeline:timeline ?? selected?.timeline});
    drawSelectedPhysical();
  }).catch(error=>{
    if(!isCurrent()) return;
    const code=error?.code?.replace(/^firestore\//,'');
    const message=code==='permission-denied'
      ? '時刻別データの読み取り権限がありません。管理者アカウントとhealth_timeline・chunksのFirestoreルールを確認してください。'
      : code==='unauthenticated' ? 'ログインし直して時刻別データを再取得してください。'
        : code==='timeline-unsupported' ? 'この時刻別データの保存形式には対応していません。Webページを更新してください。'
          : code==='timeline-inconsistent' ? '時刻別データが同期中または一部未取得です。「身体データを更新」で再取得してください。'
            : '時刻別データを取得できませんでした。通信状態を確認し「身体データを更新」で再試行してください。';
    physicalTimelines.set(day,{error:message});
    drawSelectedPhysical();
  });
}
function drawPhysicalHistory() {
  const start = physicalDayOffset(physicalEnd,1-physicalPeriod);
  $('physical-range').textContent = `${start} 〜 ${physicalEnd}（日本時間）`;
  drawSelectedPhysical();
  renderPhysicalHistory($('physical-history'),physicalDays(physicalEnd,physicalPeriod,physicalRecords),
    $('physical-field').value || 'steps',physicalSelected,day => {
      physicalSelected = day;
      drawPhysicalHistory();
      // Keep keyboard focus on the selected date after rebuilding the table.
      const buttons = $('physical-history').querySelectorAll('button');
      for (const button of buttons) if (button.textContent === day) button.focus();
    });
}
function changePhysicalRange(end,period = physicalPeriod) {
  if (!validPhysicalDay(end) || end < '2000-01-01' || end > physicalToday()) {
    syncPhysicalControls(); return;
  }
  physicalEnd = end; physicalSelected = end; physicalPeriod = period;
  syncPhysicalControls();
  void fetchPhysicalData(selectedLoginId);
}

// A successful write redraws these views. Block edits in all of them until it
// finishes so that the redraw cannot discard a draft entered during the write.
async function withRecordWrite(write) {
  if (recordWritePending) throw new Error('write pending');
  recordWritePending = true;
  const current = revision;
  const panels = ['memories','keywords','interest-chart'].map($);
  const inertStates = panels.map(panel => panel.inert);
  const sortDisabled = $('memory-sort').disabled;
  for (const panel of panels) panel.inert = true;
  $('memory-sort').disabled = true;
  try {
    return await write();
  } finally {
    recordWritePending = false;
    panels.forEach((panel,index) => { panel.inert = inertStates[index]; });
    // A lookup or logout may have replaced the data and its sorting state.
    if (current === revision) $('memory-sort').disabled = sortDisabled;
  }
}
const date = value => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'});
};
function status(message = '', error = false) { $('status').textContent = message; $('status').hidden = !message; $('status').classList.toggle('error', error); }
function resetData() {
  recordDrafts.clear();
  resetPhysicalHistory();
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
  return {kind,drafts:recordDrafts,keyOf:item=>kind === 'memory' ? item.id : item.normalizedKey ?? item.keyword,
    save:genreEditingEnabled ? saveGenre : null,change:recordEditingEnabled ? changeRecord : null};
}
async function changeRecord(kind,key,action,expectedContent,content) {
  if (!authorized || !recordEditingEnabled) throw new Error('unauthorized');
  return withRecordWrite(async () => {
    const current = revision,uid = $('target-uid').textContent,loginId = selectedLoginId;
    const response = (await load({loginId,action,kind,key,expectedContent,...(action === 'editRecord' ? {content} : {})})).data;
    if (!authorized || current !== revision || uid !== $('target-uid').textContent) return;
    if (response?.saved !== true || response.uid !== uid || response.action !== action || response.key !== key) throw new Error('save failed');
    await fetchData(loginId,selectedConversation);
  });
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
  return withRecordWrite(async () => {
    const current = revision, uid = $('target-uid').textContent;
    const result = (await load({loginId:selectedLoginId,action:'setTopicGenre',kind,key,topicGenre})).data;
    if (!authorized || current !== revision || uid !== $('target-uid').textContent) return;
    if (result?.saved !== true || result.uid !== uid || result.topicGenre !== topicGenre) throw new Error('save failed');
    const rows = kind === 'memory' ? visibleMemories : visibleInterests;
    for (const item of rows) if (genreEditing(kind).keyOf(item) === key) item.topicGenre = topicGenre;
    renderMemories(); renderInterests();
    status('ジャンルを保存しました。');
  });
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
  $('physical').replaceChildren(...physicalFields.map(({key,label})=>{
    const node=element('div',null,'metric');
    node.append(element('small',label),element('strong',physicalFormatted(physical?.[key],key)));return node;
  }));
  $('physical-note').textContent = data?.selectedDate
    ? `対象日: ${data.selectedDate}（${data.selectedDate === data.today ? '今日' : '過去の保存データ'}）\n${physical ? `最終同期成功: ${date(physical.recordedAt)}` : 'この日の身体データは未取得です。'}`
    : '同期済みの身体データはありません。';
}
async function fetchPhysicalData(loginId, current = revision) {
  const uid = $('target-uid').textContent;
  if (!authorized || !loginId || !uid) return;
  const request = ++physicalRequest;
  const end = physicalEnd, count = physicalPeriod;
  const start = physicalDayOffset(end,1-count);
  const isCurrent = () => current === revision && authorized && request === physicalRequest && uid === $('target-uid').textContent;
  $('physical-refresh').disabled = true;
  $('physical').setAttribute('aria-busy','true');
  $('physical-history').setAttribute('aria-busy','true');
  $('physical-timeline').setAttribute('aria-busy','true');
  physicalRecords = [];
  physicalTimelineRequest++;physicalTimelines.clear();
  $('physical').replaceChildren();
  $('physical-history').replaceChildren();
  $('physical-timeline').replaceChildren();
  $('physical-range').textContent = `${start} 〜 ${end}（日本時間）`;
  $('physical-note').textContent = '保存済みの身体データを読み込み中…';
  try {
    // health_daily.date is a Firestore Timestamp. Use JST midnight boundaries.
    const snapshot = await getDocsFromServer(query(
      collection(db,'users',uid,'health_daily'),
      where('date','>=',new Date(`${start}T00:00:00+09:00`)),
      where('date','<',new Date(`${physicalDayOffset(end,1)}T00:00:00+09:00`)),
      orderBy('date','desc'), limit(count),
    ));
    if (!isCurrent()) return;
    physicalRecords = snapshot.docs.filter(doc => validPhysicalDay(doc.id)).map(doc => {
      const data = doc.data(), recordedAt = data.updatedAt?.toDate?.();
      return {date:doc.id, steps:data.steps, sleepMinutes:data.sleepMinutes, timeline:data.timeline,
        heartRate:data.heartRate, restingHeartRate:data.restingHeartRate,
        recordedAt:recordedAt instanceof Date && Number.isFinite(recordedAt.getTime()) ? recordedAt.toISOString() : null};
    });
    drawPhysicalHistory();
  } catch(error) {
    if (!isCurrent()) return;
    $('physical-timeline').setAttribute('aria-busy','false');
    renderPhysical(null);
    const code = error?.code?.replace(/^firestore\//,'');
    $('physical-note').textContent = code === 'permission-denied'
      ? '身体データの読み取り権限がありません。管理者アカウントとFirestoreルールの公開状況を確認してください。'
      : code === 'unauthenticated'
        ? 'ログインし直して身体データを再取得してください。'
        : '身体データを取得できませんでした。通信状態を確認して再取得してください。';
  } finally {
    if (isCurrent()) {
      $('physical-refresh').disabled = false;
      $('physical').setAttribute('aria-busy','false');
      $('physical-history').setAttribute('aria-busy','false');
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
$('physical-date').addEventListener('change',() => changePhysicalRange($('physical-date').value));
$('physical-previous').addEventListener('click',() => changePhysicalRange(physicalDayOffset(physicalEnd,-1)));
$('physical-next').addEventListener('click',() => changePhysicalRange(physicalDayOffset(physicalEnd,1)));
$('physical-today').addEventListener('click',() => changePhysicalRange(physicalToday(),1));
$('physical-week').addEventListener('click',() => changePhysicalRange(physicalEnd,7));
$('physical-month').addEventListener('click',() => changePhysicalRange(physicalEnd,30));
$('physical-field').addEventListener('change',() => {
  if ($('physical-history').getAttribute('aria-busy') !== 'true' && $('physical-history').children.length) drawPhysicalHistory();
});
$('physical-timeline-field').addEventListener('change',() => {
  if ($('physical-timeline').getAttribute('aria-busy') !== 'true' && $('physical-history').children.length) drawSelectedPhysical();
});
$('conversation').addEventListener('change',event => fetchData(selectedLoginId,event.target.value));
function tab(name) {
  closeStateTrendPopup($('state-trend'));
  $('memory-sort-control').hidden = name !== 'memory';
  for (const key of ['state','memory','body']) { const active = key === name; $(`${key}-tab`).setAttribute('aria-selected',String(active)); $(`${key}-tab`).tabIndex = active ? 0 : -1; $(`${key}-panel`).hidden = !active; }
  if (name === 'memory') fitMemoryPanels();
}
globalThis.addEventListener('resize',()=>closeStateTrendPopup($('state-trend')));
globalThis.addEventListener('scroll',()=>closeStateTrendPopup($('state-trend')));
for (const name of ['state','memory','body']) {
  $(`${name}-tab`).addEventListener('click',() => tab(name));
  $(`${name}-tab`).addEventListener('keydown',event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const names = ['state','memory','body']; const next = event.key === 'Home' ? names[0] : event.key === 'End' ? names[2] : names[(names.indexOf(name) + (event.key === 'ArrowRight' ? 1 : 2)) % names.length]; tab(next); $(`${next}-tab`).focus(); } });
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
