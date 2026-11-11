import test from 'node:test';
import assert from 'node:assert/strict';
import {chronologicalPoints,trendGeometry,trendWindow,score,axisLabel,estimateOrigin,withHeldScores} from '../admin-web/src/state-trend.ts';
const point = (id,value,conversationId='c') => ({id,conversationId,createdAt:`2026-10-13T00:0${id}:00Z`,emotionState:{interest:value}});
test('history sorts chronologically without mutating input or reordering tied and unknown dates',()=>{
  const points=[point('2',.5),{...point('missing',.5),createdAt:null},point('0',.5),{...point('invalid',.5),createdAt:'invalid'},point('1',.5),{...point('tie',.5),createdAt:point('1',.5).createdAt}];
  const original=[...points];
  assert.deepEqual(chronologicalPoints(points).map(p=>p.id),['0','1','tie','2','missing','invalid']);
  assert.deepEqual(points,original);
});
test('trend gaps are never connected or imputed as zero; zero is a valid estimate',()=>{
  const points=[point('0',0),point('1',null),point('2',.8),point('3',.9)];
  const graph=trendGeometry(points,'interest');
  assert.equal((graph.path.match(/M/g)??[]).length,2);
  assert.equal((graph.path.match(/L/g)??[]).length,1);
  assert.match(graph.path,/M46,150/);
  assert.equal(score(points[1],'interest'),null);
  assert.equal(score(point('0',2),'interest'),null);
});
test('separate conversations break trajectories; timestamps never collapse distinct utterances',()=>{
  const graph=trendGeometry([point('0',.2),point('1',.4,'other')],'interest');
  assert.equal((graph.path.match(/M/g)??[]).length,2);
  assert.equal(trendGeometry([point('0',.2)],'interest').xs[0],326);
  assert.deepEqual(trendGeometry([point('0',.2),point('0',.4)],'interest').xs,[46,606]);
  const missing=trendGeometry([{...point('0',.2),createdAt:null},point('1',.4)],'interest');
  assert.deepEqual(missing.xs,[46,606]);
});
test('utterances are equally spaced and held versus estimated states are preserved',()=>{
  const points=[point('0',.2),point('1',.3),point('5',.4)];
  assert.equal(trendGeometry(points,'interest').xs[1],326);
  const held={...points[0],emotionState:{interest:.2,_analysis:{axes:{interest:{status:'held',reason:'insufficient_evidence'}}}}};
  assert.match(axisLabel(held,'interest'),/^▲ .*前回値を維持/);
  assert.match(axisLabel({...held,emotionState:{interest:.2,_analysis:{axes:{interest:{status:'estimated'}}}}},'interest'),/^● 推定済み/);
});

test('legacy scales convert to nine signed levels without fabricating added axes',()=>{
  assert.equal(score(point('0',0),'interest'),-1);
  assert.equal(score(point('0',.5),'interest'),0);
  assert.equal(score(point('0',1),'interest'),1);
  assert.equal(score(point('0',.7),'interest'),.5);
  const legacy={...point('0',.2),emotionState:{energy:.8,_analysis:{version:'context-v1'}}};
  assert.equal(score(legacy,'energy'),null);
  const v2={...legacy,emotionState:{energy:.8,valence:-.5,_analysis:{version:'context-v2'}}};
  assert.equal(score(v2,'energy'),.5);
  assert.equal(score(v2,'valence'),-.5);
});

test('signed records preserve negative and neutral estimates but hide unestimated zero',()=>{
  const signed=(value,status='estimated',version='context-v4')=>({...point('0',value),emotionState:{interest:value,_analysis:{version,axes:{interest:{status}}}}});
  for(const value of [-1,-.75,-.5,-.25,0,.25,.5,.75,1]) assert.equal(score(signed(value),'interest'),value);
  assert.equal(score(signed(0,'unestimated'),'interest'),null);
  assert.match(axisLabel(signed(0,'unestimated'),'interest'),/^未推定/);
  assert.equal(score(signed(-.5,'held'),'interest'),-.5);
  assert.equal(score(signed(-1.25),'interest'),null);
  assert.equal(score(signed(.4,'estimated','context-v3'),'interest'),.4);
  assert.equal(score(signed(.5,'estimated','context-v5'),'interest'),null);
  const graph=trendGeometry([signed(-1),signed(0,'unestimated'),signed(1)],'interest');
  assert.equal((graph.path.match(/M/g)??[]).length,2);
  assert.match(graph.path,/M46,150/);
  assert.match(graph.path,/M606,30/);
  assert.match(trendGeometry([signed(0)],'interest').path,/M326,90/);
});

// Windows follow the selected utterance while retaining nearby context.
test('thirty-utterance windows start at the latest history and track boundary navigation',()=>{
  assert.deepEqual(trendWindow(100,99),{start:70,end:100});
  assert.deepEqual(trendWindow(100,85,70),{start:70,end:100});
  assert.deepEqual(trendWindow(100,69,70),{start:69,end:99});
  assert.deepEqual(trendWindow(100,0,70),{start:0,end:30});
  assert.deepEqual(trendWindow(100,30,0),{start:1,end:31});
  assert.deepEqual(trendWindow(100,99,0),{start:70,end:100});
  assert.deepEqual(trendWindow(5,0),{start:0,end:5});
  assert.deepEqual(trendWindow(1,0),{start:0,end:1});
});

test('held values trace stored links to an earlier estimate in the same conversation',()=>{
  const state=(id,status,previousMessageId=null,conversationId='c')=>({...point(id,.75,conversationId),content:`発言${id}`,emotionState:{interest:.75,_analysis:{version:'context-v4',axes:{interest:{status,previousMessageId}}}}});
  const points=[state('a','estimated'),state('b','held','a'),state('c','held','b')];
  assert.equal(estimateOrigin(points,0,'interest'),points[0]);
  assert.equal(estimateOrigin(points,2,'interest'),points[0]);
  assert.equal(estimateOrigin(points.slice(1),1,'interest'),null,'truncated origin must not be guessed');
  assert.equal(estimateOrigin([state('a','estimated','', 'other'),points[1]],1,'interest'),null);
  assert.equal(estimateOrigin([state('a','held','b'),state('b','held','a')],1,'interest'),null,'cycles cannot follow future messages');
  assert.equal(estimateOrigin([state('a','unestimated')],0,'interest'),null);
  assert.equal(estimateOrigin([state('a','held')],0,'interest'),null);
});

const evidencePoint=(id,minute,value,reason='insufficient_evidence',source='openai',conversationId='c')=>({
  id,conversationId,createdAt:new Date(Date.UTC(2026,10,10,0,minute)).toISOString(),
  emotionState:{energy:value,_analysis:{version:'context-v4',source,axes:{energy:{status:value===null?'unestimated':'estimated',reason:value===null?reason:'estimated',previousMessageId:null}}}},
});
test('display holds real estimates through insufficient evidence, preserving zero and original provenance',()=>{
  const raw=[evidencePoint('initial',0,null),evidencePoint('origin',1,0),evidencePoint('gap',2,null),evidencePoint('gap2',3,null),evidencePoint('changed',4,-.75)];
  const before=JSON.stringify(raw), points=withHeldScores(raw);
  assert.equal(score(points[0],'energy'),null);
  assert.equal(score(points[2],'energy'),0);
  assert.equal(score(points[3],'energy'),0);
  assert.deepEqual(points[2].displayHeldAxes,['energy']);
  assert.equal(estimateOrigin(points,3,'energy'),raw[1]);
  assert.equal(score(points[4],'energy'),-.75);
  assert.equal((trendGeometry(points,'energy').path.match(/L/g)??[]).length,3);
  assert.equal(JSON.stringify(raw),before,'display continuity must not mutate stored data');
});
test('display connects triangles beyond thirty minutes until a new estimate arrives',()=>{
  const points=withHeldScores([evidencePoint('origin',0,.5),evidencePoint('held',20,null),evidencePoint('later',31,null),evidencePoint('muchLater',180,null),evidencePoint('new',181,-.5),evidencePoint('afterNew',240,null)]);
  assert.equal(score(points[2],'energy'),.5);
  assert.equal(score(points[3],'energy'),.5);
  assert.equal(score(points[5],'energy'),-.5);
  assert.equal(estimateOrigin(points,1,'energy'),points[0]);
  assert.equal(estimateOrigin(points,3,'energy'),points[0]);
  assert.equal(estimateOrigin(points,5,'energy'),points[4]);
  const path=trendGeometry(points,'energy').path;
  assert.equal((path.match(/M/g)??[]).length,1);
  assert.equal((path.match(/L/g)??[]).length,5);
});
test('errors and pending analysis hold the last value while keeping the reason and original source',()=>{
  for(const [reason,source] of [['api_error','error'],['api_unavailable','unavailable']]) {
    const points=withHeldScores([evidencePoint('origin',0,.5),evidencePoint('gap',1,null,reason,source)]);
    assert.equal(score(points[1],'energy'),.5);
    assert.equal(points[1].emotionState._analysis.axes.energy.status,'held');
    assert.equal(points[1].emotionState._analysis.axes.energy.reason,reason);
    assert.equal(points[1].emotionState._analysis.source,source);
    assert.equal(estimateOrigin(points,1,'energy'),points[0]);
    assert.match(trendGeometry(points,'energy').path,/L/);
  }
});
test('display never fills before the first value, safety responses, unknown timestamps or another conversation',()=>{
  assert.equal(score(withHeldScores([evidencePoint('initial',0,null,'api_error','error')])[0],'energy'),null);
  const safety=withHeldScores([evidencePoint('origin',0,.5),evidencePoint('safety',1,null,'safety_skipped','skipped'),evidencePoint('after',2,null)]);
  assert.equal(score(safety[1],'energy'),null);
  assert.equal(score(safety[2],'energy'),null,'safety events clear earlier anchors');
  assert.equal(score(withHeldScores([evidencePoint('origin',0,.5),evidencePoint('other',1,null,'insufficient_evidence','openai','other')])[1],'energy'),null);
  assert.equal(score(withHeldScores([evidencePoint('origin',0,.5),{...evidencePoint('undated',1,null),createdAt:null}])[1],'energy'),null);
});
