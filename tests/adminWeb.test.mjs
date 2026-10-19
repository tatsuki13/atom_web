import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const trendSource = (await readFile(new URL('../admin-web/state-trend.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const source = trendSource + '\n' + (await readFile(new URL('../admin-web/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
class Element {
  hidden = false; disabled = false; value = ''; textContent = ''; children = []; attributes = {}; listeners = {};
  style = {setProperty(){}}; classList = {toggle(){}};
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children = nodes;}
  setAttribute(key,value){this.attributes[key] = value;}
  addEventListener(name,fn){this.listeners[name] = fn;}
  focus(){this.focused=true;}
  showPopover(){this.popoverOpen=true;}
  hidePopover(){this.popoverOpen=false;}
  getBoundingClientRect(){return {left:400,top:500,bottom:510,width:100,height:100};}
  querySelector(selector){return this.children.find(child=>child.className===selector.slice(1)) ?? this.children.map(child=>child.querySelector(selector)).find(Boolean);}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(admin = true) {
  const nodes = new Map(), requests = [];
  const el = id => {if (!nodes.has(id)) nodes.set(id,new Element());return nodes.get(id);};
  el('results').hidden = true; el('viewer').hidden = true;
  let tokenListener;
  const context = {
    innerWidth:1280,innerHeight:900,addEventListener(){},
    document:{getElementById:el,createElement:() => new Element(),createElementNS:() => new Element()},Date,Number,String,
    fetch:async () => ({ok:true,json:async () => ({projectId:'test',apiKey:'test'})}),
    initializeApp:() => ({}),getAuth:() => ({}),setPersistence:async () => {},browserSessionPersistence:{},
    getFunctions:() => ({}),httpsCallable:() => data => new Promise((resolve,reject) => requests.push({data,resolve,reject})),
    signInWithEmailAndPassword:async () => {},signOut:async () => tokenListener(null),
    onIdTokenChanged:(_auth,fn) => {tokenListener=fn;fn({uid:'admin-a',getIdTokenResult:async () => ({claims:{admin}})});},
  };
  vm.runInNewContext(source,context); await tick();
  return {el,requests,context,tokenListener,submit:() => el('search-form').listeners.submit({preventDefault(){}})};
}
const sample = uid => ({uid,loginId:uid,date:'2026-10-13',conversationId:'c1',conversations:[{id:'c1',title:'会話',messageCount:2}],
  memories:[{content:'<img src=x onerror=alert(1)>'}],interestKeywords:[],emotionState:{interest:.7,anxiety:null},physicalSignals:null});

test('non-admin browser session cannot request data',async () => {
  const {el,requests,submit} = await setup(false);
  assert.equal(el('viewer').hidden,true); assert.match(el('status').textContent,/管理者権限がありません/);
  el('target-login-id').value='target';submit();assert.equal(requests.length,0);
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
    {id:'a',conversationId:'c1',createdAt:'2026-10-13T00:00:00Z',emotionState:{interest:.2}},
    {id:'b',conversationId:'c1',createdAt:'2026-10-13T00:01:00Z',emotionState:{interest:.7}},
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
  requests[1].resolve({data:{...sample('target'),conversationId:'c2',conversations:[{id:'c2',title:'別の会話'}],emotionHistory:[{id:'new',conversationId:'c2',createdAt:'2026-10-13T01:00:00Z',emotionState:{interest:.9}}]}});await tick();
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

test('V2 history renders eight signed charts and omits unestimated zero markers',async()=>{
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
  assert.equal(cards.length,8);
  assert.deepEqual(cards.map(card=>card.children[0].children[0].textContent),['肯定的感情','関心・興味','不安','孤独感','快・不快','活性度','元気さ','行動への意欲']);
  assert.equal(cards[0].children[0].children[1].textContent,'+0.50');
  assert.equal(cards[3].children[0].children[1].textContent,'未推定');
  assert.equal(cards[6].children[0].children[1].textContent,'−0.75');
  assert.ok(!walk(cards[3]).some(node=>node.attributes.cx!==undefined || node.attributes.points!==undefined));
  assert.ok(walk(cards[6]).some(node=>node.attributes.points!==undefined),'held values use triangle markers');
  assert.ok(nodes.some(node=>node.textContent==='▲ 前回値を維持'));
  assert.equal(nodes.filter(node=>node.attributes.y1==='90' && node.attributes['stroke-width']==='2').length,8);
});
const loggedIn = (uid = 'admin-a', admin = true) => ({uid,getIdTokenResult:async () => ({claims:{admin}})});
test('long histories show only thirty equally spaced points and navigation follows selection',async()=>{
  const {el,requests,submit}=await setup();
  el('target-login-id').value='target';submit();
  requests[0].resolve({data:{...sample('target'),emotionHistory:Array.from({length:100},(_,i)=>({
    id:String(i),conversationId:'c1',createdAt:'2026-10-16T00:00:00Z',emotionState:{interest:i%2 ? .5 : 1},
  }))}});await tick();
  const walk=node=>[node,...node.children.flatMap(walk)];
  const nodes=()=>walk(el('state-trend'));
  const text=()=>nodes().map(node=>node.textContent).join(' ');
  const slider=nodes().find(node=>node.id==='trend-position');
  const interest=()=>nodes().find(node=>node.className==='trend-chart' && node.children[0].children[0].textContent==='関心・興味');
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
  const point=(id,status,content,previousMessageId=null)=>({id,conversationId:'c1',createdAt:'2026-10-16T00:00:00Z',content,emotionState:{interest:.75,_analysis:{version:'context-v4',axes:{interest:{status,reason:status==='held'?'insufficient_evidence':'estimated',previousMessageId}}}}});
  requests[0].resolve({data:{...sample('target'),emotionHistory:[
    point('origin','estimated','<img src=x onerror=alert(1)>'),point('held','held','相づち','origin'),
  ]}});await tick();
  const walk=node=>[node,...node.children.flatMap(walk)];
  const popup=el('state-trend').querySelector('.trend-popover');
  const text=()=>walk(popup).map(node=>node.textContent).join(' ');
  const marker=(tag)=>walk(el('state-trend')).find(node=>node.attributes[tag]!==undefined && node.attributes.role==='button');
  marker('points').listeners.click();
  assert.equal(popup.popoverOpen,true);
  assert.match(text(),/関心・興味　\+0.75/);
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
  requests[0].resolve({data:{...sample('target'),emotionHistory:[{id:'a',conversationId:'c1',createdAt:null,emotionState:{interest:.5}}]}});await tick();
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
    {id:'a',conversationId:'c1',createdAt:null,emotionState:{interest:.2}},
    {id:'b',conversationId:'c1',createdAt:null,emotionState:{interest:.7}},
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
