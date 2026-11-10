export const physicalFields = [
  {key:'steps',label:'歩数',unit:'歩',bar:true},
  {key:'sleepMinutes',label:'睡眠時間',unit:'時間',bar:true},
  {key:'heartRate',label:'通常心拍数（当日平均）',unit:'bpm'},
  {key:'restingHeartRate',label:'安静時心拍数（当日平均）',unit:'bpm'},
];

export function physicalToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function physicalDayOffset(day, offset) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0,10);
}
export function validPhysicalDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day;
}
export function physicalValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function physicalDays(end, count, records) {
  const byDay = new Map(records.map(record => [record.date,record]));
  return Array.from({length:count}, (_,i) => {
    const day = physicalDayOffset(end,i-count+1);
    return {date:day,record:byDay.get(day) ?? null};
  });
}
export function physicalFormatted(value, key) {
  const number = physicalValue(value);
  if (number === null) return '未取得';
  if (key === 'sleepMinutes') return `${Math.floor(number/60)}時間${Math.floor(number%60)}分`;
  return `${number.toLocaleString('ja-JP',{maximumFractionDigits:1})}${key === 'steps' ? '歩' : ' bpm'}`;
}

export function renderPhysicalHistory(container, days, key, selected, onSelect) {
  const field = physicalFields.find(item => item.key === key) ?? physicalFields[0];
  const node = (tag,text) => {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    return item;
  };
  const svgNode = (tag,attributes,text) => {
    const item = document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [name,value] of Object.entries(attributes)) item.setAttribute(name,String(value));
    if (text != null) item.textContent = text;
    return item;
  };
  container.replaceChildren();
  if (!days.length) return;
  const values = days.map(day => {
    const raw = physicalValue(day.record?.[field.key]);
    return raw === null ? null : field.key === 'sleepMinutes' ? raw/60 : raw;
  });
  const max = Math.max(1,...values.filter(value => value !== null));
  const ceiling = Math.ceil(max * 1.15);
  const x = i => days.length === 1 ? 370 : 66 + i/(days.length-1)*608;
  const y = value => 208 - value/ceiling*168;
  const svg = svgNode('svg',{viewBox:'0 0 740 258',role:'group','aria-label':`${field.label}の推移。縦軸は${field.unit}、横軸は日付。日別一覧から各日の詳細を選択できます。`});
  for (let i=0;i<=4;i++) {
    const value=ceiling*i/4;
    svg.append(svgNode('line',{x1:54,y1:y(value),x2:690,y2:y(value),stroke:'#e3eae5'}));
    svg.append(svgNode('text',{x:46,y:y(value)+4,'text-anchor':'end',fill:'#64736c','font-size':12},value.toLocaleString('ja-JP',{maximumFractionDigits:1})));
  }
  svg.append(svgNode('text',{x:54,y:20,fill:'#64736c','font-size':12},field.unit));
  let path = '', drawing = false;
  values.forEach((value,i) => {
    if (value === null) { drawing=false; return; }
    if (!field.bar) { path += `${drawing ? ' L' : ' M'}${x(i)},${y(value)}`; drawing=true; }
  });
  if (!field.bar) svg.append(svgNode('path',{d:path,fill:'none',stroke:'#246b55','stroke-width':2.5}));
  days.forEach((day,i) => {
    const value=values[i], chosen=day.date === selected;
    if (chosen) svg.append(svgNode('line',{x1:x(i),x2:x(i),y1:32,y2:214,stroke:'#9bbcab','stroke-dasharray':'4 4'}));
    if (value !== null) {
      const mark=field.bar
        ? svgNode('rect',{x:x(i)-Math.min(18,180/days.length),y:y(value),width:Math.min(36,360/days.length),height:Math.max(2,208-y(value)),rx:3,fill:chosen ? '#174c3d' : '#57957b'})
        : svgNode('circle',{cx:x(i),cy:y(value),r:chosen ? 6 : 4,fill:'#246b55'});
      mark.append(svgNode('title',{},`${day.date}: ${physicalFormatted(day.record?.[key],key)}`));
      mark.setAttribute('role','button');
      mark.setAttribute('tabindex','0');
      mark.setAttribute('aria-label',`${day.date}: ${physicalFormatted(day.record?.[key],key)}。詳細を表示`);
      mark.addEventListener('click',()=>onSelect(day.date));
      mark.addEventListener('keydown',event=>{
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(day.date); }
      });
      svg.append(mark);
    }
    if (days.length<=7 || i===0 || i===days.length-1 || i%5===0) {
      svg.append(svgNode('text',{x:x(i),y:238,'text-anchor':'middle',fill:'#64736c','font-size':12},day.date.slice(5).replace('-','/')));
    }
  });
  container.append(svg);
  const hint=node('p',values.every(value=>value===null) ? 'この期間のデータは未取得です。' : '未取得の日は空白です。日別一覧の日付を選ぶと、その日の詳細を表示します。');
  hint.className='muted small';container.append(hint);
  const scroll=node('div');scroll.className='physical-table-scroll';
  const table=node('table');table.className='physical-table';
  const caption=node('caption','日別の身体データ');caption.className='sr-only';table.append(caption);
  const head=node('thead'),headRow=node('tr');
  for (const label of ['日付',...physicalFields.map(item=>item.label)]) {
    const th=node('th',label);th.setAttribute('scope','col');headRow.append(th);
  }
  head.append(headRow);table.append(head);
  const body=node('tbody');
  for (const day of [...days].reverse()) {
    const row=node('tr');
    if (day.date===selected) row.setAttribute('aria-selected','true');
    const cell=node('th');cell.setAttribute('scope','row');
    const button=node('button',day.date);button.className='secondary';button.setAttribute('type','button');
    button.setAttribute('aria-pressed',String(day.date===selected));
    button.addEventListener('click',()=>onSelect(day.date));cell.append(button);row.append(cell);
    for (const item of physicalFields) row.append(node('td',physicalFormatted(day.record?.[item.key],item.key)));
    body.append(row);
  }
  table.append(body);scroll.append(table);container.append(scroll);
}
