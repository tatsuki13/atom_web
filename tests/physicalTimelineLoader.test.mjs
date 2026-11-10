import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhysicalTimeline} from '../admin-web/physical-timeline-loader.js';
const path='users/alice/health_timeline/2026-11-09';
const at=time=>({toMillis:()=>Date.parse(time)});
const record={type:'heartRate',startAt:at('2026-11-09T00:00:00Z'),endAt:at('2026-11-09T00:00:00Z'),value:80};
const metadata={schemaVersion:2,revision:'a',chunkPrefix:'a_',chunkCount:1,recordCount:1,endAt:at('2026-11-09T15:00:00Z')};
const snapshot=data=>({exists:()=>data!=null,data:()=>data});
function reader(docs) {
  const calls=[];
  const read=async(...parts)=>{const key=parts.join('/');calls.push(key);return snapshot(docs[key]);};
  return {read,calls};
}
test('reads schema v2 with chunkPrefix and checks the published revision again',async()=>{
  const {read,calls}=reader({[path]:metadata,[`${path}/chunks/a_0000`]:{index:0,revision:'a',records:[record]}});
  const result=await loadPhysicalTimeline(read,'alice','2026-11-09');
  assert.equal(result.heartRate[0].value,80);
  assert.deepEqual(calls,[path,`${path}/chunks/a_0000`,path]);
});
test('reads schema v1 fixed IDs and distinguishes an empty snapshot from a missing day',async()=>{
  const {read}=reader({[path]:{...metadata,schemaVersion:1,chunkPrefix:undefined},[`${path}/chunks/0000`]:{index:0,revision:'a',records:[record]}});
  assert.equal((await loadPhysicalTimeline(read,'alice','2026-11-09')).heartRate.length,1);
  const empty=reader({[path]:{...metadata,chunkCount:0,recordCount:0}});
  assert.equal((await loadPhysicalTimeline(empty.read,'alice','2026-11-09')).version,1);
  assert.equal(await loadPhysicalTimeline(reader({}).read,'alice','2026-11-09'),null);
});
test('rejects wrong-revision chunks, missing chunks and wrong record counts instead of reporting no data',async()=>{
  for(const chunk of [undefined,{index:0,revision:'old',records:[record]},{index:0,revision:'a',records:[]}]) {
    const {read}=reader({[path]:metadata,[`${path}/chunks/a_0000`]:chunk});
    await assert.rejects(loadPhysicalTimeline(read,'alice','2026-11-09'),{code:'timeline-inconsistent'});
  }
});
test('retries when a new revision is published during reading and ignores unpublished chunks',async()=>{
  let manifestReads=0;
  const read=async(...parts)=>{
    const key=parts.join('/');
    if(key===path) return snapshot(++manifestReads===1 ? metadata : {...metadata,revision:'b',chunkPrefix:'b_'});
    if(key===`${path}/chunks/a_0000`) return snapshot({index:0,revision:'a',records:[{...record,value:10}]});
    if(key===`${path}/chunks/b_0000`) return snapshot({index:0,revision:'b',records:[record]});
    throw new Error('Unpublished data must not be queried');
  };
  assert.equal((await loadPhysicalTimeline(read,'alice','2026-11-09')).heartRate[0].value,80);
  assert.equal(manifestReads,4);
});
test('permission failures propagate and logout stops follow-up reads',async()=>{
  await assert.rejects(loadPhysicalTimeline(async()=>{throw {code:'permission-denied'};},'alice','2026-11-09'),{code:'permission-denied'});
  let current=true,reads=0;
  const result=await loadPhysicalTimeline(async()=>{reads++;current=false;return snapshot(metadata);},'alice','2026-11-09',()=>current);
  assert.equal(result,undefined);assert.equal(reads,1);
});
test('does not impose the old 400-chunk limit and bounds concurrent reads',async()=>{
  let active=0,maximum=0;
  const read=async(...parts)=>{
    const key=parts.join('/');
    if(key===path) return snapshot({...metadata,chunkCount:402,recordCount:402});
    active++;maximum=Math.max(maximum,active);
    await new Promise(resolve=>setImmediate(resolve));active--;
    const index=Number(parts.at(-1).slice(2));
    return snapshot({index,revision:'a',records:[{...record,recordId:String(index)}]});
  };
  assert.equal((await loadPhysicalTimeline(read,'alice','2026-11-09')).heartRate[0].count,402);
  assert.ok(maximum<=4);
});
test('unsupported metadata is not mislabeled as an unsaved day',async()=>{
  for(const data of [{...metadata,schemaVersion:9},{...metadata,chunkPrefix:'../other'},{...metadata,chunkCount:-1}]) {
    await assert.rejects(loadPhysicalTimeline(reader({[path]:data}).read,'alice','2026-11-09'),{code:'timeline-unsupported'});
  }
});
