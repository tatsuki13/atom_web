import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineTimestamp,normalizePhysicalTimeline,renderPhysicalTimeline,convertHealthTimeline} from '../admin-web/physical-timeline.js';

class TimelineElement {
  children=[];attributes={};listeners={};textContent='';
  constructor(tag){this.tagName=tag;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(key,fn){this.listeners[key]=fn;}
}
const all=node=>[node,...node.children.flatMap(all)];
const at=time=>({toMillis:()=>Date.parse(time)});
const entry=(from,to,value,extra={})=>({startAt:at(from),endAt:at(to),value,...extra});
const record=(key,points)=>({timeline:{version:1,[key]:points}});
function render(data,key) {
  globalThis.document={createElement:tag=>new TimelineElement(tag),createElementNS:(_ns,tag)=>new TimelineElement(tag)};
  const container=new TimelineElement('div');
  renderPhysicalTimeline(container,data,'2026-11-09',key);
  return container;
}

test('timeline reads Firestore timestamps safely and never synthesizes detail from daily totals',()=>{
  assert.equal(timelineTimestamp({toDate:()=>new Date('2026-11-09T00:00:00Z')}),Date.parse('2026-11-09T00:00:00Z'));
  assert.ok(Number.isNaN(timelineTimestamp(null)));
  assert.ok(Number.isNaN(timelineTimestamp({toMillis:()=>{throw new Error('bad');}})));
  assert.deepEqual(normalizePhysicalTimeline({steps:1000,heartRate:80},'2026-11-09','steps'),[]);
  assert.ok(all(render({steps:1000},'steps')).some(node=>node.textContent.includes('復元することはできません')));
});

test('hourly steps show interval counts at Tokyo times including measured zero',()=>{
  const container=render(record('steps',[
    entry('2026-11-09T00:00:00Z','2026-11-09T01:00:00Z',321),
    entry('2026-11-09T01:00:00Z','2026-11-09T02:00:00Z',0),
    entry('2026-11-09T15:00:00Z','2026-11-09T16:00:00Z',900),
    entry('2026-11-09T02:00:00Z','2026-11-09T03:00:00Z',-1),
  ]),'steps');
  const bars=all(container).filter(node=>node.tagName==='rect');
  assert.equal(bars.length,2);
  assert.match(bars[0].attributes['aria-label'],/09:00.*10:00.*321歩/);
  assert.match(bars[1].attributes['aria-label'],/0歩/);
  bars[0].listeners.click();
  assert.ok(all(container).some(node=>node.className==='physical-timeline-selection' && /09:00.*321歩/.test(node.textContent)));
});

test('heart rate windows plot extrema and leave missing intervals disconnected',()=>{
  const container=render(record('heartRate',[
    entry('2026-11-09T00:00:00Z','2026-11-09T00:05:00Z',80,{min:60,max:100,count:2}),
    entry('2026-11-09T00:10:00Z','2026-11-09T00:15:00Z',75),
    entry('2026-11-09T00:15:00Z','2026-11-09T00:20:00Z',85),
  ]),'heartRate');
  const path=all(container).find(node=>node.tagName==='path').attributes.d;
  assert.equal((path.match(/M/g)??[]).length,2);
  assert.equal((path.match(/L/g)??[]).length,1);
  const first=all(container).find(node=>node.tagName==='circle');
  first.listeners.keydown({key:'Enter',preventDefault(){}});
  assert.ok(all(container).some(node=>node.className==='physical-timeline-selection' && /平均 80.*最小 60.*最大 100.*2回測定/.test(node.textContent)));
});

test('sleep keeps previous-night stages, unknown stages and wake-up day context',()=>{
  const data=record('sleepStages',[
    entry('2026-11-08T14:00:00Z','2026-11-08T15:00:00Z',null,{stage:'rem'}),
    entry('2026-11-08T15:00:00Z','2026-11-08T17:00:00Z',null,{stage:'deep'}),
    entry('2026-11-08T17:00:00Z','2026-11-08T18:00:00Z',null,{stage:'unrecognized'}),
  ]);
  const container=render(data,'sleepStages');
  const bars=all(container).filter(node=>node.tagName==='rect');
  assert.equal(bars.length,3);
  assert.match(bars[0].attributes['aria-label'],/11\/8.*23:00.*11\/9.*00:00.*レム睡眠/);
  assert.match(bars[2].attributes['aria-label'],/不明/);
  assert.ok(all(render(record('sleepStages',[]),'sleepStages')).some(node=>node.textContent.includes('Health Connectへ共有')));
});

const day='2026-11-09',meta={endAt:at('2026-11-09T15:00:00Z')};
const raw=(type,from,to,value,extra={})=>({...entry(from,to,value),type,...extra});
test('Android step intervals are summed hourly without filling missing hours',()=>{
  const timeline=convertHealthTimeline([
    raw('steps','2026-11-09T00:00:00Z','2026-11-09T00:15:00Z',100),
    raw('steps','2026-11-09T00:15:00Z','2026-11-09T00:30:00Z',250),
    raw('steps','2026-11-09T02:00:00Z','2026-11-09T02:15:00Z',0),
    raw('steps','2026-11-09T15:00:00Z','2026-11-09T15:15:00Z',999),
  ],day,meta);
  const points=normalizePhysicalTimeline({timeline},day,'steps');
  assert.deepEqual(points.map(p=>p.value),[350,0]);
  assert.equal(points[0].end-points[0].start,3600000);
  assert.equal(points[1].start-points[0].start,7200000);
});
test('Android instantaneous heart samples keep every sample within a five minute bucket',()=>{
  const sample=(time,value,extra={})=>raw('heartRate',time,time,value,{recordId:'parent',sourceName:'watch',...extra});
  const one=sample('2026-11-09T00:00:00Z',60);
  const timeline=convertHealthTimeline([one,one,
    sample('2026-11-09T00:01:00Z',100),
    sample('2026-11-09T00:10:00Z',75),
    sample('2026-11-09T15:00:00Z',999),
    sample('2026-11-09T00:01:00Z',200,{sourceName:'phone'}),
  ],day,meta);
  const points=normalizePhysicalTimeline({timeline},day,'heartRate');
  assert.equal(points.length,2);
  assert.deepEqual([points[0].value,points[0].min,points[0].max,points[0].count],[80,60,100,2]);
  assert.equal(timeline.sources.heartRate,'watch');
  assert.equal(points[1].value,75);
});
test('Android sleep preserves prior-night stages and never turns a session into REM',()=>{
  const timeline=convertHealthTimeline([
    raw('sleepSession','2026-11-08T14:00:00Z','2026-11-08T22:00:00Z',null),
    raw('sleepStage','2026-11-08T14:00:00Z','2026-11-08T15:00:00Z',null,{stage:'rem'}),
    raw('sleepStage','2026-11-08T15:00:00Z','2026-11-08T16:00:00Z',null,{stage:'awakeInBed'}),
  ],day,meta);
  assert.deepEqual(normalizePhysicalTimeline({timeline},day,'sleepStages').map(p=>p.stage),['rem','awakeInBed']);
  assert.equal(convertHealthTimeline([raw('sleepSession','2026-11-08T14:00:00Z','2026-11-08T22:00:00Z',null)],day,meta).sleepStages.length,0);
});
test('Android today buckets stop at the acquisition time and invalid values stay absent',()=>{
  const timeline=convertHealthTimeline([
    raw('steps','2026-11-09T00:00:00Z','2026-11-09T00:02:00Z',7),
    raw('heartRate','2026-11-09T00:01:00Z','2026-11-09T00:01:00Z',80),
    raw('heartRate','2026-11-09T00:02:00Z','2026-11-09T00:02:00Z',0),
    raw('restingHeartRate','2026-11-09T00:01:00Z','2026-11-09T00:01:00Z',60),
  ],day,{endAt:at('2026-11-09T00:02:00Z')});
  assert.equal(timeline.steps[0].value,7);
  assert.equal(timeline.steps[0].endAt.toISOString(),'2026-11-09T00:02:00.000Z');
  assert.equal(timeline.heartRate[0].count,1);
  assert.equal(timeline.restingHeartRate[0].value,60);
});
