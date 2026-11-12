const sleepStageStyle = {
  awake:{label:'覚醒',color:'#bc8b46',level:0},
  awakeInBed:{label:'覚醒（就床中）',color:'#bc8b46',level:0},
  outOfBed:{label:'離床',color:'#bc8b46',level:0},
  rem:{label:'レム睡眠',color:'#8b73b5',level:1},
  light:{label:'浅い睡眠',color:'#5c9fbb',level:2},
  deep:{label:'深い睡眠',color:'#405d9d',level:3},
  asleep:{label:'睡眠（段階不明）',color:'#8d9ba6',level:4},
  unknown:{label:'不明',color:'#b7bfc4',level:4},
};
export function timelineTimestamp(value) {
  if (value == null) return NaN;
  try {
    const time = typeof value?.toMillis === 'function' ? value.toMillis()
      : typeof value?.toDate === 'function' ? value.toDate().getTime()
        : typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : NaN;
    return Number.isFinite(time) ? time : NaN;
  } catch { return NaN; }
}
export function normalizePhysicalTimeline(record, day, key) {
  const timeline=record?.timeline;
  if (timeline?.version !== 1 || !Array.isArray(timeline[key])) return [];
  const start=Date.parse(`${day}T00:00:00+09:00`),end=start+86400000;
  const sleep=key === 'sleepStages';
  return timeline[key].flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const from=timelineTimestamp(item.startAt),to=timelineTimestamp(item.endAt);
    // Sleep belongs to the wake-up day and can begin on the preceding evening.
    if (!Number.isFinite(from) || !Number.isFinite(to) || to<=from || to>end || from<(sleep ? start-86400000 : start)) return [];
    if (!sleep && from>=end) return [];
    if (sleep) return [{start:from,end:to,stage:Object.hasOwn(sleepStageStyle,item.stage) ? item.stage : 'unknown'}];
    if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value<0 || (key!=='steps' && item.value===0)) return [];
    const low=typeof item.min === 'number' && Number.isFinite(item.min) && item.min>0 && item.min<=item.value ? item.min : item.value;
    const high=typeof item.max === 'number' && Number.isFinite(item.max) && item.max>=item.value ? item.max : item.value;
    return [{start:from,end:to,value:item.value,min:low,max:high,count:Number.isInteger(item.count) && item.count>0 ? item.count : null}];
  }).sort((a,b)=>a.start-b.start || a.end-b.end);
}
// Convert Android schema v1/v2 records into the graph's interval model.
export function convertHealthTimeline(records, day, metadata) {
  const start=Date.parse(`${day}T00:00:00+09:00`),dayEnd=start+86400000;
  const reportedEnd=timelineTimestamp(metadata.endAt);
  if (!Number.isFinite(reportedEnd) || reportedEnd<start || reportedEnd>dayEnd) throw new Error('Invalid timeline range');
  const end=reportedEnd;
  const result={version:1,steps:[],heartRate:[],restingHeartRate:[],sleepStages:[],sources:{}};
  // Keep a single source per series to avoid overlapping phone/watch measurements.
  const byType=new Map();
  for (const item of records) {
    if (!item || typeof item!=='object') continue;
    const from=timelineTimestamp(item.startAt),to=timelineTimestamp(item.endAt);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to<from) continue;
    const sleep=item.type==='sleepStage';
    if (sleep ? from<start-86400000 || to>dayEnd || to<=from : from<start || from>=dayEnd || from>end) continue;
    if (!sleep && (!['steps','heartRate','restingHeartRate'].includes(item.type) || typeof item.value!=='number' || !Number.isFinite(item.value) || item.value<0 || (item.type!=='steps' && item.value===0))) continue;
    if (item.type==='steps' && (to<=from || to>end)) continue;
    const source=item.type==='steps' ? '' : JSON.stringify([item.sourceName??'',item.sourceId??'']);
    if (!byType.has(item.type)) byType.set(item.type,new Map());
    const sources=byType.get(item.type);
    if (!sleep) {
      const width=item.type==='steps' ? 3600000 : 300000;
      const bucketStart=start+Math.floor((from-start)/width)*width;
      const bucketEnd=Math.min(bucketStart+width,end,dayEnd);
      if (bucketEnd<=bucketStart || (item.type==='steps' && to>bucketEnd)) continue;
    }
    if (!sources.has(source)) sources.set(source,new Map());
    const identity=JSON.stringify([item.recordId??'',from,to,sleep ? item.stage : item.value]);
    sources.get(source).set(identity,{...item,from,to});
  }
  for (const [type,sources] of byType) {
    const ranked=[...sources.entries()].sort((a,b)=>b[1].size-a[1].size || a[0].localeCompare(b[0]));
    if (!ranked.length) continue;
    const [source,measurements]=ranked[0],items=[...measurements.values()];
    if (source) result.sources[type]=items[0].sourceName || items[0].sourceId || '記録元不明';
    if (type==='sleepStage') {
      result.sleepStages=items.map(item=>({startAt:item.startAt,endAt:item.endAt,stage:Object.hasOwn(sleepStageStyle,item.stage) ? item.stage : 'unknown'}));
      continue;
    }
    const width=type==='steps' ? 3600000 : 300000,buckets=new Map();
    for (const item of items) {
      const bucketStart=start+Math.floor((item.from-start)/width)*width;
      const bucketEnd=Math.min(bucketStart+width,end,dayEnd);
      if(bucketEnd<=bucketStart) continue;
      // Step intervals are aggregated by Health Connect; don't invent a split across hours.
      if(type==='steps' && item.to>bucketEnd) continue;
      const bucket=buckets.get(bucketStart) ?? {sum:0,count:0,min:Infinity,max:-Infinity,end:bucketEnd};
      bucket.sum+=item.value;bucket.count++;bucket.min=Math.min(bucket.min,item.value);bucket.max=Math.max(bucket.max,item.value);
      buckets.set(bucketStart,bucket);
    }
    result[type]=[...buckets.entries()].sort((a,b)=>a[0]-b[0]).map(([from,bucket])=>({
      startAt:new Date(from),endAt:new Date(bucket.end),value:type==='steps' ? bucket.sum : bucket.sum/bucket.count,
      ...(type==='steps' ? {} : {min:bucket.min,max:bucket.max,count:bucket.count}),
    }));
  }
  return result;
}

function timelineClock(time,withDay=false) {
  return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',...(withDay ? {month:'numeric',day:'numeric'} : {}),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(time));
}
const timelineNumber = number => number.toLocaleString('ja-JP',{maximumFractionDigits:1});

export function renderPhysicalTimeline(container,record,day,key='steps') {
  const html=(tag,text,className) => {
    const item=document.createElement(tag);
    if (text!=null) item.textContent=text;
    if (className) item.className=className;
    return item;
  };
  const svgElement=(tag,attrs,text) => {
    const item=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [name,value] of Object.entries(attrs)) item.setAttribute(name,String(value));
    if (text!=null) item.textContent=text;
    return item;
  };
  container.replaceChildren();
  const sleep=key==='sleepStages',steps=key==='steps';
  const label=sleep ? '睡眠段階' : steps ? '歩数' : key==='restingHeartRate' ? '安静時心拍数' : '心拍数';
  const points=normalizePhysicalTimeline(record,day,key);
  const explanation=html('p',sleep
    ? `${day}に終了した睡眠の段階です。前夜を含め、ウォッチから共有された区間を表示します。`
    : steps ? '1時間ごとに歩いた歩数です。1日の累計ではありません。現在の時間帯は最終同期時刻までの値で、未取得の時間帯は空白です。'
      : '5分ごとの平均心拍数です。縦線はその時間帯の最小〜最大、空白は未取得です。','muted small');
  if(key==='heartRate') {
    const resting=record?.restingHeartRate;
    const value=typeof resting==='number' && Number.isFinite(resting) && resting>0
      ? `${timelineNumber(resting)} bpm` : '未取得';
    const summary=html('p',null,'physical-timeline-resting');
    summary.append(html('strong',`安静時心拍数：${value}`),html('small','（選択日の平均）','muted'));
    container.append(summary);
  }
  container.append(explanation);
  const source=record?.timeline?.sources?.[sleep ? 'sleepStage' : key];
  if(source) container.append(html('p',`記録元: ${source}（複数ある場合は記録件数が最も多い記録元を表示）`,'muted small'));
  if (!points.length) {
    container.append(html('p',record?.timeline?.version===1
      ? `${label}の時刻別データは未取得です。${sleep ? 'ウォッチの睡眠段階がHealth Connectへ共有されているか確認してください。' : 'Health Connectへの共有とアプリの同期を確認してください。'}`
      : 'この日の時刻別データは保存されていません。Androidアプリを更新し、Health Connectと再同期してください。日次の合計・平均から時刻別データを復元することはできません。','physical-timeline-empty'));
    return;
  }
  const dayStart=Date.parse(`${day}T00:00:00+09:00`);
  const from=sleep ? Math.floor(points[0].start/3600000)*3600000 : dayStart;
  const to=sleep ? Math.max(from+3600000,Math.ceil(Math.max(...points.map(point=>point.end))/3600000)*3600000) : dayStart+86400000;
  const x=time=>100+(time-from)/(to-from)*588;
  const maximum=sleep ? 1 : Math.max(1,...points.map(point=>point.max));
  const ceiling=Math.ceil(maximum*1.12);
  const y=value=>210-value/ceiling*164;
  const svg=svgElement('svg',{viewBox:'0 0 740 270',role:'group','aria-label':`${day} ${label}の時刻別グラフ。横軸は日本時間。各記録を選ぶと時刻と値を表示します。`});
  if (sleep) {
    for (const [name,level] of [['覚醒',0],['レム睡眠',1],['浅い睡眠',2],['深い睡眠',3],['段階不明',4]]) {
      const levelY=44+level*36;
      svg.append(svgElement('line',{x1:100,x2:688,y1:levelY+13,y2:levelY+13,stroke:'#e3eae5'}));
      svg.append(svgElement('text',{x:90,y:levelY+18,'text-anchor':'end',fill:'#64736c','font-size':12},name));
    }
  } else {
    for (let i=0;i<=4;i++) {
      const value=ceiling*i/4;
      svg.append(svgElement('line',{x1:100,x2:688,y1:y(value),y2:y(value),stroke:'#e3eae5'}));
      svg.append(svgElement('text',{x:90,y:y(value)+4,'text-anchor':'end',fill:'#64736c','font-size':12},timelineNumber(value)));
    }
    svg.append(svgElement('text',{x:100,y:25,fill:'#64736c','font-size':12},steps ? '歩 / 時間帯' : 'bpm'));
  }
  for (let i=0;i<=6;i++) {
    const time=from+(to-from)*i/6;
    const text=!sleep && i===6 ? '24:00' : timelineClock(time,sleep);
    svg.append(svgElement('text',{x:x(time),y:250,'text-anchor':'middle',fill:'#64736c','font-size':11},text));
  }
  if (!sleep && !steps) {
    let path='',previous=null;
    for (const point of points) {
      const consecutive=previous && point.start===previous.end;
      path+=`${consecutive ? ' L' : ' M'}${x((point.start+point.end)/2)},${y(point.value)}`;
      previous=point;
    }
    svg.append(svgElement('path',{d:path,fill:'none',stroke:'#246b55','stroke-width':2}));
  }
  const selection=html('p','グラフの記録を選ぶと、時刻と値を確認できます。','physical-timeline-selection');
  selection.setAttribute('role','status');selection.setAttribute('aria-live','polite');
  for (const point of points) {
    const time=`${timelineClock(point.start,sleep)} 〜 ${timelineClock(point.end,sleep)}`;
    const text=sleep ? sleepStageStyle[point.stage].label : steps ? `${timelineNumber(point.value)}歩`
      : `平均 ${timelineNumber(point.value)} bpm（最小 ${timelineNumber(point.min)} / 最大 ${timelineNumber(point.max)}${point.count ? ` / ${point.count}回測定` : ''}）`;
    let mark;
    if (sleep) {
      const style=sleepStageStyle[point.stage];
      mark=svgElement('rect',{x:x(point.start),y:44+style.level*36,width:Math.max(1,x(point.end)-x(point.start)),height:26,rx:3,fill:style.color});
    } else if (steps) {
      mark=svgElement('rect',{x:x(point.start)+1,y:y(point.value),width:Math.max(1,x(point.end)-x(point.start)-2),height:Math.max(2,210-y(point.value)),rx:2,fill:'#57957b'});
    } else {
      const middle=x((point.start+point.end)/2);
      svg.append(svgElement('line',{x1:middle,x2:middle,y1:y(point.min),y2:y(point.max),stroke:'#73a98e','stroke-width':2}));
      mark=svgElement('circle',{cx:middle,cy:y(point.value),r:4,fill:'#246b55'});
    }
    const select=()=>{selection.textContent=`${time}：${text}`;};
    mark.append(svgElement('title',{},`${time}：${text}`));
    mark.setAttribute('role','button');mark.setAttribute('tabindex','0');mark.setAttribute('aria-label',`${time}：${text}`);
    mark.addEventListener('click',select);
    mark.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();select();}});
    svg.append(mark);

  }
  const plot=html('div',null,'physical-timeline-plot');plot.append(svg);
  container.append(plot,selection);

}
