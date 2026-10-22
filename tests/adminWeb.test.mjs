import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const trendSource = (await readFile(new URL('../admin-web/state-trend.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const interestSource = (await readFile(new URL('../admin-web/interest-registry.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const source = trendSource + '\n' + interestSource + '\n' + (await readFile(new URL('../admin-web/app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
class Element {
  hidden = false; disabled = false; value = ''; textContent = ''; children = []; attributes = {}; listeners = {};
  style = {setProperty(){}}; classList = {toggle(){}};
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children = nodes;}
  setAttribute(key,value){this.attributes[key] = value;}
  addEventListener(name,fn){this.listeners[name] = fn;}
  setCustomValidity(message){this.validationMessage=message;}
  reportValidity(){}
  focus(){this.focused=true;}
  showPopover(){this.popoverOpen=true;}
  hidePopover(){this.popoverOpen=false;}
  getBoundingClientRect(){return {left:400,top:500,bottom:510,width:100,height:100};}
  querySelector(selector){return this.children.find(child=>child.className===selector.slice(1)) ?? this.children.map(child=>child.querySelector(selector)).find(Boolean);}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(admin = true) {
  const nodes = new Map(), requests = [], healthRequests = [];
  const el = id => {if (!nodes.has(id)) nodes.set(id,new Element());return nodes.get(id);};
  el('results').hidden = true; el('viewer').hidden = true;
  let tokenListener;
  const context = {
    innerWidth:1280,innerHeight:900,addEventListener(){},
    document:{getElementById:el,createElement:tag => Object.assign(new Element(), {tagName:tag}),createElementNS:(_ns,tag) => Object.assign(new Element(), {tagName:tag})},Date,Number,String,
    fetch:async () => ({ok:true,json:async () => ({projectId:'test',apiKey:'test'})}),
    initializeApp:() => ({}),getAuth:() => ({}),setPersistence:async () => {},browserSessionPersistence:{},
    getFunctions:() => ({}),httpsCallable:(_functions,name) => {
      assert.equal(name,'adminConversationViewer');
      return data => new Promise((resolve,reject) => requests.push({name,data,resolve,reject}));
    },
    getFirestore:()=>({}),collection:(_db,...parts)=>({path:parts.join('/')}),
    where:(field,operator,value)=>({kind:'where',field,operator,value}),
    orderBy:(field,direction)=>({kind:'orderBy',field,direction}),limit:value=>({kind:'limit',value}),
    query:(target,...constraints)=>({target,constraints}),
    getDocsFromServer:query=>new Promise((resolve,reject)=>healthRequests.push({query,resolve,reject})),
    signInWithEmailAndPassword:async () => {},signOut:async () => tokenListener(null),
    onIdTokenChanged:(_auth,fn) => {tokenListener=fn;fn({uid:'admin-a',getIdTokenResult:async () => ({claims:{admin}})});},
  };
  vm.runInNewContext(source,context); await tick();
  return {el,requests,healthRequests,context,tokenListener,submit:() => el('search-form').listeners.submit({preventDefault(){}})};
}
const sample = uid => ({uid,loginId:uid,date:'2026-10-13',conversationId:'c1',conversations:[{id:'c1',title:'会話',messageCount:2}],
  memories:[{content:'<img src=x onerror=alert(1)>'}],interestKeywords:[],emotionState:{positive_affect:.7,anxiety:null},physicalSignals:null});
const healthSnapshot = (id,data) => ({docs:id ? [{id,data:()=>data}] : []});

test('non-admin browser session cannot request data',async () => {
  const {el,requests,healthRequests,submit} = await setup(false);
  assert.equal(el('viewer').hidden,true); assert.match(el('status').textContent,/管理者権限がありません/);
  el('target-login-id').value='target';submit();assert.equal(requests.length,0);
  assert.equal(healthRequests.length,0);
});
test('user switch discards a stale response and renders stored text without HTML injection',async () => {
  const {el,requests,submit} = await setup();
  el('target-login-id').value='user-a';submit();
  el('target-login-id').value='user-b';el('target-login-id').listeners.input();submit();
  requests[1].resolve({data:sample('user-b')});await tick();
  assert.equal(el('target-uid').textContent,'user-b');
  requests[0].resolve({data:sample('user-a')});await tick();
  assert.equal(el('target-uid').textContent,'user-b');
  assert.equal(el('memories').children[0].children[0].textContent,'<img src=x onerror=alert(1)>');
});
test('logout clears the visible records and invalidates outstanding requests',async () => {
  const {el,requests,submit,tokenListener} = await setup();
  el('target-login-id').value='target';submit();await tokenListener(null);
  requests[0].resolve({data:sample('target')});await tick();
  assert.equal(el('viewer').hidden,true);assert.equal(el('results').hidden,true);
  assert.equal(el('target-uid').textContent,'');assert.equal(el('memories').children.length,0);
});
test('history selection updates values and deltas; switching users clears the charts',async () => {
  const {el,requests,submit} = await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:{...sample('target'),emotionHistory:[
    {id:'a',conversationId:'c1',createdAt:'2026-10-13T00:00:00Z',emotionState:{positive_affect:.2}},
    {id:'b',conversationId:'c1',createdAt:'2026-10-13T00:01:00Z',emotionState:{positive_affect:.7}},
  ]}});await tick();
  const text = node => [node.textContent,...node.children.map(text)].join(' ');
  assert.match(text(el('state-trend')),/発話 2 \/ 2/);
  assert.match(text(el('state-trend')),/前回比 \+1.00/);
  const find = node => node.id === 'trend-position' ? node : node.children.map(find).find(Boolean);
  const slider = find(el('state-trend'));slider.value='0';slider.listeners.input();
  assert.match(text(el('state-trend')),/発話 1 \/ 2/);
  assert.match(text(el('state-trend')),/−0.50/);
  el('conversation').listeners.change({target:{value:'c2'}});
  assert.equal(requests[1].data.loginId,'target');
  assert.equal(requests[1].data.conversationId,'c2');
  assert.equal(el('state-trend').children.length,0,'previous conversation must clear while loading');
  requests[1].resolve({data:{...sample('target'),conversationId:'c2',conversations:[{id:'c2',title:'別の会話'}],emotionHistory:[{id:'new',conversationId:'c2',createdAt:'2026-10-13T01:00:00Z',emotionState:{positive_affect:.9}}]}});await tick();
  assert.match(text(el('state-trend')),/\+0.75/);
  assert.equal(el('conversation').value,'c2');
  el('target-login-id').listeners.input();assert.equal(el('state-trend').children.length,0);
});

test('search sends the login ID and refresh keeps the resolved account identity',async () => {
  const {el,requests,submit} = await setup();
  el('target-login-id').value=' User1 ';submit();
  assert.equal(requests[0].data.loginId,'User1');
  assert.equal(requests[0].data.uid,undefined);
  requests[0].resolve({data:{...sample('resolved-firebase-uid'),loginId:'user1',displayName:'山田 太郎'}});await tick();
  assert.equal(el('target-id').textContent,'user1');
  assert.equal(el('target-name').textContent,'山田 太郎');
  assert.equal(el('target-uid').textContent,'resolved-firebase-uid');
  el('refresh').listeners.click();
  assert.equal(requests[1].data.loginId,'user1');
  assert.equal(requests[1].data.conversationId,'c1');
});

test('V2 history renders seven signed charts and omits unestimated zero markers',async()=>{
  const {el,requests,submit}=await setup();
  el('target-login-id').value='target';submit();
  const keys=['positive_affect','interest','anxiety','loneliness','valence','arousal','energy','motivation'];
  requests[0].resolve({data:{...sample('target'),emotionHistory:[{
    id:'signed',conversationId:'c1',createdAt:'2026-10-16T00:00:00Z',emotionState:{
      ...Object.fromEntries(keys.map(key=>[key,.5])),energy:-.75,loneliness:0,
      _analysis:{version:'context-v4',axes:Object.fromEntries(keys.map(key=>[key,{
        status:key==='loneliness' ? 'unestimated' : key==='energy' ? 'held' : 'estimated',reason:'insufficient_evidence',
      }]))},
    },
  }]}});await tick();
  const walk=node=>[node,...node.children.flatMap(walk)];
  const nodes=walk(el('state-trend'));
  const cards=nodes.filter(node=>node.className==='trend-chart');
  assert.equal(cards.length,7);
  assert.deepEqual(cards.map(card=>card.children[0].children[0].textContent),['肯定的感情','不安','孤独感','快・不快','活性度','元気さ','行動への意欲']);
  assert.equal(cards[0].children[0].children[1].textContent,'+0.50');
  assert.equal(cards[2].children[0].children[1].textContent,'未推定');
  assert.equal(cards[5].children[0].children[1].textContent,'−0.75');
  assert.ok(!walk(cards[2]).some(node=>node.attributes.cx!==undefined || node.attributes.points!==undefined));
  assert.ok(walk(cards[5]).some(node=>node.attributes.points!==undefined),'held values use triangle markers');
  assert.ok(nodes.some(node=>node.textContent==='▲ 前回値を維持'));
  assert.equal(nodes.filter(node=>node.attributes.y1==='90' && node.attributes['stroke-width']==='2').length,7);
});
const loggedIn = (uid = 'admin-a', admin = true) => ({uid,getIdTokenResult:async () => ({claims:{admin}})});

test('health data reads Firestore by resolved UID and preserves zero, missing fields, date and Timestamp',async()=>{
  const {el,requests,healthRequests,submit}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:sample('target')});await tick();
  assert.equal(healthRequests[0].query.target.path,'users/target/health_daily');
  const constraints=Array.from(healthRequests[0].query.constraints,item=>({...item}));
  const today=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date());
  const tomorrow=new Date(`${today}T00:00:00+09:00`);
  tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  assert.deepEqual(constraints,[
    {kind:'where',field:'date',operator:'<',value:tomorrow},
    {kind:'orderBy',field:'date',direction:'desc'}, {kind:'limit',value:1},
  ]);
  assert.equal(el('physical').attributes['aria-busy'],'true');
  healthRequests[0].resolve(healthSnapshot('2000-01-01',{
    steps:0,sleepMinutes:0,heartRate:80.5,restingHeartRate:null,
    updatedAt:{toDate:()=>new Date('2000-01-01T01:00:00Z')},
  }));await tick();
  const rows=el('physical').children.map(node=>node.children.map(child=>child.textContent));
  assert.deepEqual(rows,[['歩数','0歩'],['睡眠時間','0時間0分'],['通常心拍数（当日平均）','80.5 bpm'],['安静時心拍数（当日平均）','データなし']]);
  assert.match(el('physical-note').textContent,/2000-01-01.*過去の保存データ/);
  assert.match(el('physical-note').textContent,/最終同期成功/);
  assert.ok(el('physical-note').textContent.includes(new Date('2000-01-01T01:00:00Z').toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})));
  assert.match(el('physical-note').textContent,/今日のデータはまだ同期/);
  assert.equal(el('physical-refresh').disabled,false);
  el('physical-refresh').listeners.click();
  assert.equal(healthRequests.length,2);
  healthRequests[1].resolve(healthSnapshot(null));await tick();
  assert.equal(el('physical').children[0].children[1].textContent,'データなし');
  assert.match(el('physical-note').textContent,/同期済みの身体データはありません/);
});

test('health responses cannot leak across user changes or logout',async()=>{
  const {el,requests,healthRequests,submit,tokenListener}=await setup();
  const response=()=>healthSnapshot('2026-10-21',{steps:123});
  el('target-login-id').value='user-a';submit();
  requests[0].resolve({data:sample('user-a')});await tick();
  el('target-login-id').value='user-b';el('target-login-id').listeners.input();submit();
  requests[1].resolve({data:sample('user-b')});await tick();
  healthRequests[0].resolve(response());await tick();
  assert.ok(!el('physical').children.some(row=>row.children[1].textContent==='123歩'));
  await tokenListener(null);
  healthRequests[1].resolve(response());await tick();
  assert.equal(el('physical').children.length,0);
  assert.equal(el('physical-note').textContent,'');
});

test('Firestore read failure leaves conversation data usable and exposes retry',async()=>{
  const {el,requests,healthRequests,submit}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:sample('target')});await tick();
  healthRequests[0].reject({code:'unavailable'});await tick();
  assert.equal(el('results').hidden,false);
  assert.equal(el('memories').children.length,1);
  assert.match(el('physical-note').textContent,/取得できませんでした/);
  assert.equal(el('physical-refresh').disabled,false);
  assert.equal(el('physical').attributes['aria-busy'],'false');
});

test('health reads use the Firebase UID instead of the login ID',async()=>{
  const {el,requests,healthRequests,submit}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:{...sample('resolved-uid'),loginId:'target'}});await tick();
  assert.equal(healthRequests[0].query.target.path,'users/resolved-uid/health_daily');
  healthRequests[0].resolve(healthSnapshot('2000-01-01',{heartRate:75}));await tick();
  assert.equal(el('physical').children[0].children[1].textContent,'データなし');
  assert.equal(el('physical').children[2].children[1].textContent,'75 bpm');
});

test('Firestore permission failures explain rules publishing and retry can recover',async()=>{
  const {el,requests,healthRequests,submit}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:sample('target')});await tick();
  healthRequests[0].reject({code:'permission-denied'});await tick();
  assert.match(el('physical-note').textContent,/読み取り権限がありません/);
  assert.match(el('physical-note').textContent,/Firestoreルールの公開状況/);
  el('physical-refresh').listeners.click();
  const today=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date());
  healthRequests[1].resolve(healthSnapshot(today,{steps:1234}));await tick();
  assert.equal(el('physical').children[0].children[1].textContent,'1,234歩');
  assert.match(el('physical-note').textContent,/（今日）/);
  assert.ok(!el('physical-note').textContent.includes('読み取り権限がありません'));
});

test('revoking admin rights discards an outstanding Firestore result',async()=>{
  const {el,requests,healthRequests,submit,tokenListener}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:sample('target')});await tick();
  await tokenListener({uid:'admin-a',getIdTokenResult:async()=>({claims:{admin:false}})});
  healthRequests[0].resolve(healthSnapshot('2000-01-01',{steps:999}));await tick();
  assert.equal(el('results').hidden,true);
  assert.equal(el('physical').children.length,0);
});

test('all axes share chronology, selection and window even with missing estimates',async()=>{
  const {el,requests,submit}=await setup();
  const keys=['positive_affect','interest','anxiety','loneliness','valence','arousal','energy','motivation'];
  const history=Array.from({length:35},(_,i)=>({
    id:String(i),conversationId:'c1',createdAt:new Date(Date.UTC(2026,9,16,0,i)).toISOString(),content:`発言本文${i}`,
    emotionState:{...Object.fromEntries(keys.map(key=>[key,i/40])),_analysis:{version:'context-v4',axes:{anxiety:{status:i%2===0?'unestimated':'estimated'},loneliness:{status:'unestimated'}}}},
  }));
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:{...sample('target'),emotionHistory:[...history].reverse()}});await tick();
  const walk=node=>[node,...node.children.flatMap(walk)];
  const nodes=()=>walk(el('state-trend'));
  const cards=()=>nodes().filter(node=>node.className==='trend-chart');
  const slider=nodes().find(node=>node.id==='trend-position');
  const check=(selected,start,end)=>{
    assert.equal(cards().length,7);
    assert.equal(nodes().find(node=>node.className==='trend-utterance').textContent,`発言本文${selected}`);
    const x=String(46+(selected-start)/(end-start-1)*560);
    cards().forEach(card=>{
      const descendants=walk(card);
      const cursor=descendants.find(node=>node.attributes['stroke-dasharray']==='4 4');
      assert.equal(cursor.attributes.x1,x);
      assert.ok(descendants.some(node=>node.textContent===`発話${start+1}`));
      assert.ok(descendants.some(node=>node.textContent===`発話${end}`));
      assert.ok(descendants.some(node=>node.attributes['aria-label']?.includes(`全グラフで発話${selected+1}を選択中`)));
    });
    const anxietyMarkers=walk(cards()[1]).filter(node=>node.attributes.role==='button');
    anxietyMarkers.forEach(marker=>{
      const utterance=Number(marker.attributes['aria-label'].match(/^発話(\d+)/)[1])-1;
      assert.equal(marker.attributes.cx,String(46+(utterance-start)/(end-start-1)*560));
    });
    assert.ok(!walk(cards()[2]).some(node=>node.attributes.role==='button'));
  };
  check(34,5,35);
  // Selecting a sparse axis updates every graph and the shared utterance.
  walk(cards()[1]).find(node=>node.attributes.role==='button').listeners.click();
  assert.equal(slider.value,'5');check(5,5,35);
  assert.match(walk(el('state-trend').querySelector('.trend-popover')).map(node=>node.textContent).join(' '),/発言本文5/);
  nodes().find(node=>node.textContent==='前へ').listeners.click();check(4,4,34);
  slider.value='0';slider.listeners.input();check(0,0,30);
  nodes().find(node=>node.textContent==='次へ').listeners.click();check(1,0,30);
  slider.value='34';slider.listeners.input();check(34,5,35);
  assert.equal(history[0].id,'0');
});
test('long histories show only thirty equally spaced points and navigation follows selection',async()=>{
  const {el,requests,submit}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:{...sample('target'),emotionHistory:Array.from({length:100},(_,i)=>({
    id:String(i),conversationId:'c1',createdAt:'2026-10-16T00:00:00Z',emotionState:{positive_affect:i%2 ? .5 : 1},
  }))}});await tick();
  const walk=node=>[node,...node.children.flatMap(walk)];
  const nodes=()=>walk(el('state-trend'));
  const text=()=>nodes().map(node=>node.textContent).join(' ');
  const slider=nodes().find(node=>node.id==='trend-position');
  const interest=()=>nodes().find(node=>node.className==='trend-chart' && node.children[0].children[0].textContent==='肯定的感情');
  const markers=()=>walk(interest()).filter(node=>node.attributes.cx!==undefined);
  assert.match(text(),/グラフ表示：発話 71〜100 \/ 100/);
  assert.equal(markers().length,30);
  assert.equal(markers()[0].attributes.cx,'46');
  assert.equal(markers()[29].attributes.cx,'606');
  markers()[0].listeners.click();
  assert.equal(slider.value,'70');
  assert.match(text(),/発話 71 \/ 100/);
  nodes().find(node=>node.textContent==='前へ').listeners.click();
  assert.match(text(),/グラフ表示：発話 70〜99 \/ 100/);
  slider.value='0';slider.listeners.input();
  assert.match(text(),/グラフ表示：発話 1〜30 \/ 100/);
  assert.equal(nodes().find(node=>node.textContent==='前へ').disabled,true);
  slider.value='99';slider.listeners.input();
  assert.match(text(),/グラフ表示：発話 71〜100 \/ 100/);
  assert.equal(nodes().find(node=>node.textContent==='次へ').disabled,true);
  assert.equal(markers().length,30);
});

test('point popup shows literal utterances, held origins, and closes on navigation or user changes',async()=>{
  const {el,requests,submit}=await setup();
  el('target-login-id').value='target';submit();
  const point=(id,status,content,previousMessageId=null)=>({id,conversationId:'c1',createdAt:'2026-10-16T00:00:00Z',content,emotionState:{positive_affect:.75,_analysis:{version:'context-v4',axes:{positive_affect:{status,reason:status==='held'?'insufficient_evidence':'estimated',previousMessageId}}}}});
  requests[0].resolve({data:{...sample('target'),emotionHistory:[
    point('origin','estimated','<img src=x onerror=alert(1)>'),point('held','held','相づち','origin'),
  ]}});await tick();
  const walk=node=>[node,...node.children.flatMap(walk)];
  const popup=el('state-trend').querySelector('.trend-popover');
  const text=()=>walk(popup).map(node=>node.textContent).join(' ');
  const marker=(tag)=>walk(el('state-trend')).find(node=>node.attributes[tag]!==undefined && node.attributes.role==='button');
  marker('points').listeners.click();
  assert.equal(popup.popoverOpen,true);
  assert.match(text(),/肯定的感情　\+0.75/);
  assert.match(text(),/この時の発言.*相づち/);
  assert.match(text(),/値の元になった発言/);
  assert.equal(walk(popup).filter(node=>node.className==='popover-utterance')[1].textContent,'<img src=x onerror=alert(1)>');
  popup.onkeydown({key:'Escape',preventDefault(){}});
  assert.equal(popup.popoverOpen,false);
  marker('cx').listeners.keydown({key:'Enter',preventDefault(){}});
  assert.equal(popup.popoverOpen,true);
  assert.match(text(),/推定時の発言/);
  assert.ok(!text().includes('値の元になった発言'));
  walk(popup).find(node=>node.attributes['aria-label']==='吹き出しを閉じる').listeners.click();
  assert.equal(popup.popoverOpen,false);
  marker('points').listeners.click();
  el('memory-tab').listeners.click();
  assert.equal(popup.popoverOpen,false);
  marker('points').listeners.click();
  const slider=walk(el('state-trend')).find(node=>node.id==='trend-position');
  slider.value='0';slider.listeners.input();
  assert.equal(popup.popoverOpen,false);
  marker('points').listeners.click();
  el('target-login-id').listeners.input();
  assert.equal(popup.popoverOpen,false);
  assert.equal(el('state-trend').children.length,0);
});

test('older API responses without text still allow opening point details',async()=>{
  const {el,requests,submit}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:{...sample('target'),emotionHistory:[{id:'a',conversationId:'c1',createdAt:null,emotionState:{positive_affect:.5}}]}});await tick();
  const walk=node=>[node,...node.children.flatMap(walk)];
  walk(el('state-trend')).find(node=>node.attributes.role==='button').listeners.click();
  const popup=el('state-trend').querySelector('.trend-popover');
  assert.equal(popup.popoverOpen,true);
  assert.match(walk(popup).map(node=>node.textContent).join(' '),/本文は取得できませんでした/);
});
test('same administrator token refresh preserves the selected point, tab, and data',async () => {
  const {el,requests,submit,tokenListener} = await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:{...sample('target'),emotionHistory:[
    {id:'a',conversationId:'c1',createdAt:null,emotionState:{positive_affect:.2}},
    {id:'b',conversationId:'c1',createdAt:null,emotionState:{positive_affect:.7}},
  ]}});await tick();
  const find = node => node.id === 'trend-position' ? node : node.children.map(find).find(Boolean);
  const slider=find(el('state-trend'));slider.value='0';slider.listeners.input();
  el('memory-tab').listeners.click();
  const graph=el('state-trend').children[0];
  await tokenListener(loggedIn());
  assert.equal(el('results').hidden,false);
  assert.equal(el('state-trend').children[0],graph);
  assert.equal(slider.value,'0');
  assert.equal(el('memory-tab').attributes['aria-selected'],'true');
  assert.equal(el('target-id').textContent,'target');
  assert.equal(requests.length,1);
  el('refresh').listeners.click();assert.equal(requests[1].data.conversationId,'c1');
});
test('same administrator token refresh does not invalidate an in-flight lookup',async () => {
  const {el,requests,submit,tokenListener} = await setup();
  el('target-login-id').value='target';submit();
  await tokenListener(loggedIn());
  assert.equal(el('search-button').disabled,true);
  requests[0].resolve({data:sample('target')});await tick();
  assert.equal(el('results').hidden,false);
  assert.equal(el('target-id').textContent,'target');
  assert.equal(el('search-button').disabled,false);
});
test('revoked admin rights or a changed account clears data and rejects old responses',async () => {
  for(const next of [loggedIn('admin-a',false),loggedIn('admin-b',true)]) {
    const {el,requests,submit,tokenListener} = await setup();
    el('target-login-id').value='target';submit();requests[0].resolve({data:sample('target')});await tick();
    el('refresh').listeners.click();
    await tokenListener(next);
    requests[1].resolve({data:sample('target')});await tick();
    assert.equal(el('results').hidden,true);
    assert.equal(el('target-id').textContent,'');
    assert.equal(el('memories').children.length,0);
    assert.equal(el('target-login-id').value,'');
    assert.equal(el('search-button').disabled,false);
  }
});
test('a delayed token verification cannot restore a signed-out session',async () => {
  const {el,tokenListener} = await setup();
  let complete;
  const pending=tokenListener({uid:'admin-a',getIdTokenResult:() => new Promise(resolve => complete=resolve)});
  await tokenListener(null);
  complete({claims:{admin:true}});await pending;
  assert.equal(el('viewer').hidden,true);
  assert.equal(el('login-panel').hidden,false);
});

const walkInterest = node => [node, ...node.children.flatMap(walkInterest)];
const interestText = node => walkInterest(node).map(item => item.textContent).join(' ');
const topicRows = container => walkInterest(container).filter(node => node.className === 'interest-topic');
const interestItem = overrides => ({keyword:'園芸',confirmationState:'inferred',interestScore:.6,interestPercent:60,...overrides});
async function interestSetup(items = [interestItem()]) {
  const state = await setup();state.el('target-login-id').value='target';state.submit();
  state.requests[0].resolve({data:{...sample('target'),interestKeywords:items}});await tick();return state;
}

test('state shows quadrants including zero and candidates, while memory retains confirmed blocks',async()=>{
 const {el}=await interestSetup([
  interestItem({interestScore:0,confidence:.99,activityStatus:'paused'}),
  interestItem({keyword:'未推定話題',interestScore:null,interestPercent:50,activityStatus:'active'}),
  interestItem({keyword:'読書',confirmationState:'confirmed',interestScore:.8,activityStatus:'active'}),
  {keyword:'旧データ'},
  interestItem({keyword:'高い未確定',interestScore:1,confidence:1,activityStatus:'active'}),
  interestItem({keyword:'苦手なもの',confirmationState:'confirmed',explicitPolarity:'negative',activityStatus:'paused'}),
 ]);
 const chart=el('interest-chart');
 const points=walkInterest(chart).filter(node=>node.tagName==='circle');
 assert.equal(points.length,4);
 assert.equal(points[0].attributes.cy,'410');
 assert.match(interestText(chart),/四象限|興味あり/);
 assert.match(interestText(chart),/位置が未判定 2件/);
 assert.match(interestText(chart),/未推定話題.*未推定/);
 const memory=interestText(el('keywords'));
 assert.match(memory,/読書.*旧データ/);
 assert.doesNotMatch(memory,/園芸|高い未確定|苦手なもの|80%/);
});

test('confirmed interests display only their linked stored memories as plain text',async()=>{
  const state=await setup();state.el('target-login-id').value='target';state.submit();
  state.requests[0].resolve({data:{...sample('target'),interestKeywords:[interestItem({confirmationState:'confirmed',sourceMemoryIds:['m1']})],memories:[
    {id:'m1',content:'<img src=x onerror=alert(1)>花の色が好き'},
    {id:'m2',content:'無関係な記憶'},
  ]}});await tick();
  const nodes=walkInterest(state.el('keywords'));
  assert.ok(nodes.some(node=>node.textContent==='<img src=x onerror=alert(1)>花の色が好き'));
  assert.doesNotMatch(interestText(state.el('keywords')),/無関係な記憶/);
  assert.ok(!nodes.some(node=>['input','form','button'].includes(node.tagName)));
});

test('refresh updates both displays and empty views explain automatic collection',async()=>{
  const {el,requests}=await interestSetup([]);
  assert.match(interestText(el('interest-chart')),/会話から見つかった興味・関心はまだありません/);
  assert.equal(walkInterest(el('interest-chart')).filter(node=>node.tagName==='line').length,2);
  assert.equal(walkInterest(el('interest-chart')).filter(node=>node.tagName==='circle').length,0);
  assert.match(interestText(el('keywords')),/確定した興味・関心はまだありません/);
  el('refresh').listeners.click();
  requests[1].resolve({data:{...sample('target'),interestKeywords:[interestItem({keyword:'読書',confirmationState:'confirmed',interestScore:.8})]}});await tick();
  assert.match(interestText(el('keywords')),/読書/);
  assert.match(interestText(el('interest-chart')),/読書/);
  assert.ok(requests.every(request=>request.name==='adminConversationViewer'));
});

test('late interest reads cannot overwrite a switched user or restore logged-out data',async()=>{
  for(const transition of ['switch','logout']) {
    const {el,requests,tokenListener,submit}=await setup();
    el('target-login-id').value='first';submit();
    if(transition==='switch') {
      el('target-login-id').value='second';el('target-login-id').listeners.input();submit();
      requests[1].resolve({data:{...sample('second'),interestKeywords:[interestItem({keyword:'読書',confirmationState:'confirmed'})]}});await tick();
    } else await tokenListener(null);
    requests[0].resolve({data:{...sample('first'),interestKeywords:[interestItem()]}});await tick();
    assert.doesNotMatch(interestText(el('keywords')),/園芸/);
    assert.doesNotMatch(interestText(el('interest-chart')),/園芸/);
    if(transition==='switch') assert.match(interestText(el('keywords')),/読書/);
    else assert.equal(el('keywords').children.length,0);
  }
});


test('interest details show grounded excerpts safely, preserve legacy memories and avoid a false empty message',async()=>{
 const content='<img src=x onerror=alert(1)>花の色が好き';
 const state=await setup();state.el('target-login-id').value='target';state.submit();
 state.requests[0].resolve({data:{...sample('target'),interestKeywords:[interestItem({confirmationState:'confirmed',activityStatus:'paused',lastObservedAt:'2026-10-21T00:00:00Z',sourceMemoryIds:['m1','m2'],details:[
  {kind:'appeal',content,conversationId:'private-conversation-id',messageId:'private-message-id'},
  {kind:'origin',content:'祖母と始めました'},
  {kind:'experience',content:'庭で花を育てました'},
  {kind:'appeal',content},
  {kind:'invalid',content:'表示しない不明な項目'},
  {kind:'experience',content:'  '},null,
 ]})],memories:[{id:'m1',content},{id:'m2',content:'昔から花が好きです'},{id:'m3',content:'無関係な記憶'}]}});await tick();
 const registry=state.el('keywords'),text=interestText(registry),nodes=walkInterest(registry);
 assert.match(text,/好きな点.*きっかけ.*経験/);
 assert.match(text,/祖母と始めました.*庭で花を育てました.*昔から花が好きです/);
 assert.match(text,/休止中.*興味の有無とは別/);
 assert.match(text,/最後に話題に出た日時/);
 assert.equal(nodes.filter(node=>node.textContent===content).length,1);
 assert.doesNotMatch(text,/詳しいエピソードはまだありません|無関係な記憶|表示しない不明な項目|private-conversation-id|private-message-id/);
 assert.ok(!nodes.some(node=>node.tagName==='img'));
});
test('activity state does not confirm a candidate or hide a paused confirmed interest',async()=>{
 const {el}=await interestSetup([
  interestItem({keyword:'釣り',activityStatus:'paused'}),
  interestItem({keyword:'読書',confirmationState:'confirmed',activityStatus:'paused'}),
  interestItem({keyword:'料理',confirmationState:'confirmed',activityStatus:'active'}),
  interestItem({keyword:'映画',confirmationState:'confirmed',explicitPolarity:'negative',activityStatus:'paused'}),
 ]);
 const chart=interestText(el('interest-chart')),registry=interestText(el('keywords'));
 assert.match(chart,/釣り.*休止中.*推定中/);
 assert.match(chart,/興味なしの明言あり/);
 assert.match(registry,/読書.*休止中.*料理.*活動中/);
 assert.doesNotMatch(registry,/釣り|映画/);
});
test('old or malformed interest details keep the honest empty state and never invent activity',async()=>{
 const {el}=await interestSetup([interestItem({confirmationState:'confirmed',activityStatus:'constructor',lastObservedAt:'invalid',details:[{kind:'appeal',content:4},{kind:'invalid',content:'架空の理由'},null]})]);
 const text=interestText(el('keywords'));
 assert.match(text,/詳しいエピソードはまだありません/);
 assert.doesNotMatch(text,/活動中|休止中|最後に話題に出た日時|架空の理由/);
});

test('quadrant axis switch changes coordinates and keeps unknown data outside the plot',async()=>{
 const {el}=await interestSetup([
  interestItem({keyword:'釣り',activityStatus:'paused',spontaneityScore:1,confidence:0}),
  interestItem({keyword:'読書',activityStatus:'active',spontaneityScore:0,confidence:1}),
  interestItem({keyword:'旧データ',activityStatus:'unknown',spontaneityScore:null}),
 ]);
 const points=()=>walkInterest(el('interest-chart')).filter(node=>node.tagName==='circle');
 assert.ok(Number(points()[0].attributes.cx)<426);assert.ok(Number(points()[1].attributes.cx)>426);
 assert.equal(points()[0].attributes['fill-opacity'],'0.28');assert.equal(points()[1].attributes['fill-opacity'],'1');
 const switchButton=walkInterest(el('interest-chart')).find(node=>node.tagName==='button' && node.textContent==='本人の自発性');
 switchButton.listeners.click();
 assert.ok(Number(points()[0].attributes.cx)>426);assert.ok(Number(points()[1].attributes.cx)<426);
 assert.equal(points().length,2);assert.match(interestText(el('interest-chart')),/旧データ.*自発性が未判定/);
 const keyword=walkInterest(el('interest-chart')).find(node=>node.attributes['data-interest-keyword']==='2');
 keyword.listeners.click();
 assert.match(interestText(el('interest-chart')),/活動状況：未判定.*本人の自発性：未判定/);
});
test('overlapping keywords remain selectable by mouse and keyboard without exposing IDs or HTML',async()=>{
 const content='<img src=x onerror=alert(1)>花が好き';
 const {el}=await interestSetup(Array.from({length:12},(_,index)=>interestItem({keyword:`話題${index}`,activityStatus:'active',details:[{kind:'appeal',content,conversationId:'private-id'}]})));
 let group=walkInterest(el('interest-chart')).find(node=>node.attributes['data-interest-point']==='11');
 let prevented=false;group.listeners.keydown({key:'Enter',preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 const detail=walkInterest(el('interest-chart')).find(node=>node.attributes['aria-label']==='選択した興味の詳細');
 assert.match(interestText(detail),/話題11/);assert.match(interestText(detail),/花が好き/);
 assert.doesNotMatch(interestText(detail),/private-id/);assert.ok(!walkInterest(detail).some(node=>node.tagName==='img'));
 const buttons=walkInterest(el('interest-chart')).filter(node=>node.attributes['data-interest-keyword']!=null);
 assert.equal(buttons.length,12);
 assert.equal(walkInterest(el('interest-chart')).find(node=>node.attributes['data-interest-point']==='11').focused,true);
});

test('quadrant coordinates honor explicit preferences and leave invalid or missing values unknown',async()=>{
 const {context}=await setup();
 const position=context.interestChartPosition;
 assert.equal(position({interestScore:.95,explicitPolarity:'negative',activityStatus:'paused'}).y,.25);
 assert.equal(position({interestScore:.1,explicitPolarity:'positive',activityStatus:'active'}).y,.75);
 assert.equal(position({interestScore:0,activityStatus:'paused'}).y,0);
 assert.equal(position({interestScore:null,activityStatus:'unknown'}).y,null);
 assert.equal(position({interestScore:.6,activityStatus:'unknown'}).x,null);
 assert.equal(position({interestScore:.6,spontaneityScore:0},'spontaneity').x,0);
 assert.equal(position({interestScore:.6,spontaneityScore:NaN},'spontaneity').x,null);
 assert.equal(position({interestScore:.6,spontaneityScore:2},'spontaneity').x,null);
});
