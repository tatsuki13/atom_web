import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut, onIdTokenChanged } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js';
import { renderStateTrend, closeStateTrendPopup } from './state-trend.js';
import { renderInterestRegistry, renderInterestChart } from './interest-registry.js';

const $ = id => document.getElementById(id);
let auth, load, authorized = false, revision = 0, selectedLoginId = '', selectedConversation = null;
let verifiedAdminUid = null, authRevision = 0;
const date = value => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'});
};
function status(message = '', error = false) { $('status').textContent = message; $('status').hidden = !message; $('status').classList.toggle('error', error); }
function resetData() {
  closeStateTrendPopup($('state-trend'));
  revision++; selectedLoginId = ''; selectedConversation = null;
  $('results').hidden = true;
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
  const physical = data.physicalSignals ?? {};
  metrics('physical',[['歩数',physical.steps,'歩'],['睡眠時間',physical.sleepMinutes == null ? null : (physical.sleepMinutes / 60).toFixed(1),'時間'],['安静時心拍数',physical.restingHeartRate,'bpm']]);
  $('physical-note').textContent = data.physicalSignals ? `更新: ${date(physical.recordedAt)}` : '記録がありません。';
  renderInterestChart($('interest-chart'), data.interestKeywords ?? []);
  renderInterestRegistry($('keywords'), data.interestKeywords ?? [], data.memories ?? []);
  const memories = data.memories ?? [];
  $('memory-count').textContent = `${memories.length}件`;
  $('memories').replaceChildren(...(memories.length ? memories.map(memory => {
    const node = element('article',null,'memory');
    node.append(element('p',memory.content),element('small',`保存: ${date(memory.createdAt)}`));
    return node;
  }) : [element('p','記憶がありません。','muted')]));
  $('memory-note').textContent = data.limits?.memories ? '300件を表示' : '';
  $('memory-note').hidden = !data.limits?.memories;
  $('results').hidden = false;
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
$('conversation').addEventListener('change',event => fetchData(selectedLoginId,event.target.value));
function tab(name) {
  closeStateTrendPopup($('state-trend'));
  for (const key of ['state','memory']) { const active = key === name; $(`${key}-tab`).setAttribute('aria-selected',String(active)); $(`${key}-tab`).tabIndex = active ? 0 : -1; $(`${key}-panel`).hidden = !active; }
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
