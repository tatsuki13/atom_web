import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const trendSource = (await readFile(new URL('../admin-web/state-trend.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const topicSource = (await readFile(new URL('../admin-web/topic-genres.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const interestSource = (await readFile(new URL('../admin-web/interest-registry.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const memorySource = (await readFile(new URL('../admin-web/memory-list.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const source = trendSource + '\n' + topicSource + '\n' + interestSource + '\n' + memorySource + '\n' + (await readFile(new URL('../admin-web/app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
class Element {
  hidden = false; inert = false; disabled = false; value = ''; textContent = ''; children = []; attributes = {}; listeners = {};
  style = {values:{},setProperty(key,value){this.values[key]=value;}}; classList = {toggle(){}};
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
const descendants = node => [node,...node.children.flatMap(descendants)];


const findNode = (root,tag,text) => descendants(root).find(node=>node.tagName===tag && (text===undefined || node.textContent===text));
async function withEditing(data={}) {
 const s=await setup();s.el('target-login-id').value='target';s.submit();
 s.requests[0].resolve({data:{...sample('target'),capabilities:{topicGenreEditing:true,recordEditing:true},memories:[{id:'m',content:'料理が好き'}],...data}});await tick();return s;
}
test('review: interest rename sends its normalized key and refreshes renamed result',async()=>{
 const s=await withEditing({interestKeywords:[{keyword:'料理',normalizedKey:'cook',confirmationState:'confirmed'}]});
 const root=s.el('keywords');findNode(root,'button','訂正').listeners.click();findNode(root,'textarea').value='園芸';
 const pending=findNode(root,'button','保存').listeners.click();
 assert.deepEqual(JSON.parse(JSON.stringify(s.requests[1].data)),{loginId:'target',action:'editRecord',kind:'interest',key:'cook',expectedContent:'料理',content:'園芸'});
 s.requests[1].resolve({data:{saved:true,uid:'target',action:'editRecord',key:'cook'}});await tick();
 s.requests[2].resolve({data:{...sample('target'),interestKeywords:[{keyword:'園芸',normalizedKey:'garden',confirmationState:'confirmed'}]}});await pending;
 assert.ok(descendants(s.el('keywords')).some(n=>n.textContent==='園芸'));
});
test('review: conflicting correction shows feedback and permits retry',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();
 findNode(root,'textarea').value='園芸';const button=findNode(root,'button','保存');const pending=button.listeners.click();
 s.requests[1].reject({code:'functions/failed-precondition'});await pending;
 assert.ok(descendants(root).some(n=>String(n.textContent).includes('内容が変更されています')));
 assert.equal(button.disabled,false);assert.equal(s.requests.length,2);
});
test('review: late correction response cannot refresh the previously selected user',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();findNode(root,'textarea').value='園芸';
 const pending=findNode(root,'button','保存').listeners.click();
 s.el('target-login-id').value='other';s.el('target-login-id').listeners.input();s.submit();s.requests[2].resolve({data:sample('other')});await tick();
 s.requests[1].resolve({data:{saved:true,uid:'target',action:'editRecord',key:'m'}});await pending;
 assert.equal(s.el('target-uid').textContent,'other');assert.equal(s.requests.length,3);
});
test('review: blank corrections never write',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();findNode(root,'textarea').value='   ';
 await findNode(root,'button','保存').listeners.click();assert.equal(s.requests.length,1);
});
test('review: recordEditing capability alone should expose record actions',async()=>{
 const s=await withEditing({capabilities:{recordEditing:true}});
 assert.ok(findNode(s.el('memories'),'button','訂正'),'recordEditing=true should expose correction independently of topicGenreEditing');
});

for (const code of ['functions/already-exists','functions/unavailable']) test('review: failed write restores controls: '+code,async()=>{
 const s=await withEditing({capabilities:{recordEditing:true}});const root=s.el('memories');findNode(root,'button','訂正').listeners.click();
 const input=findNode(root,'textarea');input.value='園芸';const button=findNode(root,'button','保存');const cancel=findNode(root,'button','キャンセル');
 const pending=button.listeners.click();assert.equal(button.disabled,true);assert.equal(cancel.disabled,true);assert.equal(input.disabled,true);
 s.requests[1].reject({code});await pending;assert.equal(button.disabled,false);assert.equal(cancel.disabled,false);assert.equal(input.disabled,false);assert.equal(input.value,'園芸');assert.equal(s.requests.length,2);
 assert.ok(descendants(root).some(n=>String(n.textContent).includes(code.endsWith('already-exists')?'同じ項目名':'処理できません')));
});
test('review: deletion failure preserves list and retry can succeed',async()=>{
 const s=await withEditing({capabilities:{recordEditing:true}});const root=s.el('memories');findNode(root,'button','削除').listeners.click();
 const b=findNode(root,'button','削除する');let pending=b.listeners.click();s.requests[1].reject({code:'functions/unavailable'});await pending;
 assert.ok(findNode(root,'p','料理が好き'));assert.equal(b.disabled,false);
 pending=b.listeners.click();s.requests[2].resolve({data:{saved:true,uid:'target',action:'deleteRecord',key:'m'}});await tick();
 s.requests[3].resolve({data:{...sample('target'),memories:[]}});await pending;assert.ok(findNode(root,'p','記憶がありません。'));
});
test('review: logout during correction prevents stale refresh',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();findNode(root,'textarea').value='園芸';
 const pending=findNode(root,'button','保存').listeners.click();await s.el('logout').listeners.click();
 s.requests[1].resolve({data:{saved:true,uid:'target',action:'editRecord',key:'m'}});await pending;
 assert.equal(s.requests.length,2);assert.equal(s.el('viewer').hidden,true);assert.equal(s.el('memories').children.length,0);
});
for (const target of ['keywords','interest-chart']) test('review: interest deletion works without genre capability: '+target,async()=>{
 const s=await withEditing({capabilities:{recordEditing:true},interestKeywords:[{keyword:'料理',normalizedKey:'cook',confirmationState:'confirmed'}]});
 if(target==='interest-chart') descendants(s.el(target)).find(n=>n.attributes['data-interest-keyword']==='0').listeners.click();
 const root=s.el(target);findNode(root,'button','削除').listeners.click();const pending=findNode(root,'button','削除する').listeners.click();
 assert.deepEqual(JSON.parse(JSON.stringify(s.requests[1].data)),{loginId:'target',action:'deleteRecord',kind:'interest',key:'cook',expectedContent:'料理'});
 s.requests[1].resolve({data:{saved:true,uid:'target',action:'deleteRecord',key:'cook'}});await tick();s.requests[2].resolve({data:{...sample('target'),interestKeywords:[]}});await pending;
 assert.ok(!findNode(s.el('keywords'),'h4','料理'));
});
test('review: missing memory ID hides unsafe edit menu',async()=>{
 const s=await withEditing({memories:[{content:'料理'}]});const menu=descendants(s.el('memories')).find(n=>n.className==='genre-editor');assert.equal(menu.hidden,true);assert.equal(s.requests.length,1);
});
for (const success of [true,false]) test('review: genre write blocks new drafts in every view and unlocks: '+success,async()=>{
 const s=await withEditing();const root=s.el('memories');const select=findNode(root,'select');
 select.value='person';const pending=select.listeners.change();
 for(const id of ['memories','keywords','interest-chart']) assert.equal(s.el(id).inert,true,id);
 assert.equal(s.el('memory-sort').disabled,true);
 // The browser's inert attribute blocks pointer, focus and keyboard events in these views.
 if(success) s.requests[1].resolve({data:{saved:true,uid:'target',topicGenre:'person'}});
 else s.requests[1].reject({code:'functions/unavailable'});
 await pending;
 for(const id of ['memories','keywords','interest-chart']) assert.equal(s.el(id).inert,false,id);
 assert.equal(s.el('memory-sort').disabled,false);
 const menu=descendants(root).find(n=>n.className==='genre-editor');menu.open=true;
 findNode(root,'button','訂正').listeners.click();findNode(root,'textarea').value='未保存の訂正内容';
 await tick();assert.equal(findNode(root,'textarea').value,'未保存の訂正内容');
});
test('review: switching user during write preserves new sorting state and unlocks panels',async()=>{
 const s=await withEditing();const select=findNode(s.el('memories'),'select');select.value='person';const pending=select.listeners.change();
 s.el('target-login-id').value='other';s.el('target-login-id').listeners.input();s.submit();
 s.requests[2].resolve({data:{...sample('other'),memories:[],interestKeywords:[]}});await tick();
 s.requests[1].resolve({data:{saved:true,uid:'target',topicGenre:'person'}});await pending;
 assert.equal(s.el('target-uid').textContent,'other');assert.equal(s.el('memory-sort').disabled,true);
 for(const id of ['memories','keywords','interest-chart']) assert.equal(s.el(id).inert,false);
 assert.equal(s.requests.length,3);
});

const typeDraft = (root,value) => {
 const input=findNode(root,'textarea');input.value=value;input.listeners.input?.();return input;
};
const assertDraft = (root,value) => {
 assert.equal(findNode(root,'textarea').value,value);
 const menu=descendants(root).find(n=>n.className==='genre-editor');
 assert.equal(menu.open,true);
 assert.equal(descendants(menu).find(n=>n.className==='record-edit-panel').hidden,false);
};
test('drafts: memory correction survives another interest genre save',async()=>{
 const s=await withEditing({interestKeywords:[{keyword:'料理',normalizedKey:'cook',confirmationState:'confirmed'}]});
 const root=s.el('memories');findNode(root,'button','訂正').listeners.click();typeDraft(root,'未保存の文章');
 const select=findNode(s.el('keywords'),'select');select.value='person';const p=select.listeners.change();
 s.requests[1].resolve({data:{saved:true,uid:'target',topicGenre:'person'}});await p;
 assertDraft(root,'未保存の文章');
 const pending=findNode(root,'button','保存').listeners.click();
 assert.equal(s.requests[2].data.content,'未保存の文章');assert.equal(s.requests[2].data.expectedContent,'料理が好き');
 s.requests[2].reject({code:'functions/unavailable'});await pending;assertDraft(root,'未保存の文章');
});
for(const order of ['oldest','newest','category','frequency']) test('drafts: correction survives sorting: '+order,async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();typeDraft(root,'訂正文');
 s.el('memory-sort').value=order;s.el('memory-sort').listeners.change();assertDraft(root,'訂正文');
 assert.equal(s.requests.length,1,'sorting drafts must not write');
});
test('drafts: interest correction survives a memory genre save and sorting',async()=>{
 const s=await withEditing({interestKeywords:[{keyword:'料理',normalizedKey:'cook',confirmationState:'confirmed'}]});
 const root=s.el('keywords');findNode(root,'button','訂正').listeners.click();typeDraft(root,'園芸');
 const select=findNode(s.el('memories'),'select');select.value='person';const p=select.listeners.change();
 s.requests[1].resolve({data:{saved:true,uid:'target',topicGenre:'person'}});await p;assertDraft(root,'園芸');
 s.el('memory-sort').value='frequency';s.el('memory-sort').listeners.change();assertDraft(root,'園芸');
});
test('drafts: cancellation prevents an old draft from returning on sort',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();typeDraft(root,'破棄する文章');
 findNode(root,'button','キャンセル').listeners.click();s.el('memory-sort').listeners.change();
 assert.equal(findNode(root,'textarea').value,'');assert.equal(descendants(root).find(n=>n.className==='record-edit-panel').hidden,true);
 findNode(root,'button','訂正').listeners.click();assert.equal(findNode(root,'textarea').value,'料理が好き');
});
test('drafts: switching users clears drafts even when their record IDs match',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();typeDraft(root,'秘密の文章');
 s.el('target-login-id').value='other';s.el('target-login-id').listeners.input();s.submit();
 s.requests[1].resolve({data:{...sample('other'),capabilities:{recordEditing:true},memories:[{id:'m',content:'別の利用者'}]}});await tick();
 assert.equal(findNode(root,'textarea').value,'');assert.equal(descendants(root).find(n=>n.className==='record-edit-panel').hidden,true);
});
test('drafts: empty input stays empty across redraw and cannot be saved',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();typeDraft(root,'');
 s.el('memory-sort').listeners.change();assertDraft(root,'');await findNode(root,'button','保存').listeners.click();assert.equal(s.requests.length,1);
});
test('drafts: saved correction is not resurrected by subsequent sorting',async()=>{
 const s=await withEditing();const root=s.el('memories');findNode(root,'button','訂正').listeners.click();typeDraft(root,'園芸');
 const p=findNode(root,'button','保存').listeners.click();s.requests[1].resolve({data:{saved:true,uid:'target',action:'editRecord',key:'m'}});await tick();
 s.requests[2].resolve({data:{...sample('target'),capabilities:{recordEditing:true},memories:[{id:'m',content:'園芸'}]}});await p;
 s.el('memory-sort').listeners.change();assert.equal(descendants(root).find(n=>n.className==='record-edit-panel').hidden,true);
});
