import {convertHealthTimeline} from './physical-timeline.js?v=20261110-chart-only';

// readDocument is injected so tests never connect to real health records.
export async function loadPhysicalTimeline(readDocument,uid,day,isCurrent=()=>true) {
  const path=['users',uid,'health_timeline',day];
  for(let attempt=0;attempt<3;attempt++) {
    if(!isCurrent()) return undefined;
    const snapshot=await readDocument(...path);
    if(!isCurrent()) return undefined;
    if(!snapshot.exists()) return null;
    const meta=snapshot.data(),prefix=meta.chunkPrefix??'';
    if(![1,2].includes(meta.schemaVersion) || typeof meta.revision!=='string' || !meta.revision ||
      typeof prefix!=='string' || !/^[A-Za-z0-9_-]*$/.test(prefix) ||
      (meta.schemaVersion===2 && !prefix) ||
      !Number.isSafeInteger(meta.chunkCount) || meta.chunkCount<0 ||
      !Number.isSafeInteger(meta.recordCount) || meta.recordCount<0) {
      throw Object.assign(new Error('Unsupported timeline metadata'),{code:'timeline-unsupported'});
    }
    const records=[];
    let consistent=true;
    for(let offset=0;offset<meta.chunkCount;offset+=4) {
      if(!isCurrent()) return undefined;
      const indices=Array.from({length:Math.min(4,meta.chunkCount-offset)},(_,i)=>offset+i);
      const chunks=await Promise.all(indices.map(index=>readDocument(...path,'chunks',`${prefix}${String(index).padStart(4,'0')}`)));
      if(!isCurrent()) return undefined;
      for(let i=0;i<chunks.length;i++) {
        const chunk=chunks[i].exists() ? chunks[i].data() : null;
        if(!chunk || chunk.index!==indices[i] || chunk.revision!==meta.revision || !Array.isArray(chunk.records)) { consistent=false;break; }
        for(const record of chunk.records) records.push(record);
      }
      if(!consistent) break;
    }
    const latest=await readDocument(...path);
    if(!isCurrent()) return undefined;
    const current=latest.exists() ? latest.data() : null;
    if(consistent && records.length===meta.recordCount && current?.revision===meta.revision &&
      current.chunkCount===meta.chunkCount && current.recordCount===meta.recordCount &&
      (current.chunkPrefix??'')===prefix) return convertHealthTimeline(records,day,meta);
  }
  throw Object.assign(new Error('Timeline changed or is incomplete'),{code:'timeline-inconsistent'});
}
