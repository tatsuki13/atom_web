export const dimensions = [
  {key:'positive_affect',label:'肯定的感情',color:'#39876a',low:'感じていない',high:'非常に強い'},
  {key:'interest',label:'関心・興味',color:'#527ba5',low:'なし',high:'非常に強い'},
  {key:'anxiety',label:'不安',color:'#b58c56',low:'なし',high:'非常に強い'},
  {key:'loneliness',label:'孤独感',color:'#9585b2',low:'なし',high:'非常に強い'},
  {key:'valence',label:'快・不快',color:'#b57487',low:'非常に不快',high:'非常に快'},
  {key:'arousal',label:'活性度',color:'#a27b53',low:'落ち着いた低活性',high:'興奮した高活性'},
  {key:'energy',label:'元気さ',color:'#438a92',low:'非常に疲れている',high:'非常に元気'},
  {key:'motivation',label:'行動への意欲',color:'#777fb0',low:'全くしたくない',high:'非常にしたい'},
] as const;
type AxisKey = typeof dimensions[number]['key'];
export type TrendPoint = {id:string; conversationId:string; createdAt:string|null; emotionState: Record<string,unknown>|null;content?:string|null};
type Analysis = {version?:string;axes?:Record<string,{status?:string;reason?:string;previousMessageId?:string|null}>};
const analysis = (point:TrendPoint|undefined) => point?.emotionState?._analysis as Analysis | undefined;
const originalAxes = new Set<string>(['loneliness','anxiety','positive_affect','interest']);
export function score(point: TrendPoint | undefined, key: AxisKey): number | null {
  const value = point?.emotionState?.[key];
  const metadata = analysis(point), version = metadata?.version;
  if(metadata?.axes?.[key]?.status === 'unestimated') return null;
  if(typeof value !== 'number' || !Number.isFinite(value)) return null;
  if(version === 'context-v3' || version === 'context-v4') {
    return value >= -1 && value <= 1 ? value : null;
  }
  // Unversioned keyword scores and context-v1 contain only the original four axes.
  if(version !== undefined && version !== 'context-v1' && version !== 'context-v2') return null;
  if(version !== 'context-v2' && !originalAxes.has(key)) return null;
  if(value < (key === 'valence' ? -1 : 0) || value > 1) return null;
  const signed = key === 'valence' ? value : value * 2 - 1;
  return Math.floor(signed * 4 + 0.5) / 4;
}
export function axisLabel(point: TrendPoint, key: AxisKey): string {
  const metadata = analysis(point);
  const axis = metadata?.axes?.[key];
  const reason = ({insufficient_evidence:'判断材料不足',api_unavailable:'API未設定・推定未実行',api_error:'APIエラー',safety_skipped:'安全応答を優先'} as Record<string,string>)[axis?.reason ?? ''] ?? '判断材料不足';
  if (score(point,key) === null) return `未推定（${reason}）`;
  return axis?.status === 'held' ? `▲ ${reason}のため前回値を維持` : axis?.status === 'estimated' ? '● 推定済み' : '● 従来のキーワード推定';
}
export function chronologicalPoints(points:TrendPoint[]):TrendPoint[] {
  const timestamp=(point:TrendPoint) => {
    const time=point.createdAt ? Date.parse(point.createdAt) : NaN;
    return Number.isFinite(time) ? time : Infinity;
  };
  // Stable sort preserves API order for equal or unavailable timestamps.
  return [...points].sort((a,b)=>(timestamp(a)-timestamp(b)) || 0);
}
function trendPositions(total:number) {
  return Array.from({length:total},(_,i)=>total>1 ? 46+i/(total-1)*560 : 326);
}
export function trendGeometry(points: TrendPoint[], key: AxisKey, xs=trendPositions(points.length)) {
  let drawing = false;
  const path = points.map((point,i) => {
    const value = score(point,key);
    if (value === null) {drawing = false;return '';}
    if (i > 0 && point.conversationId !== points[i-1].conversationId) drawing = false;
    const part = `${drawing ? 'L' : 'M'}${xs[i]},${90-value*60}`;
    drawing = true;return part;
  }).filter(Boolean).join(' ');
  return {xs,path};
}
export function trendWindow(total:number, selected:number, start=Math.max(0,total-30)) {
  start=Math.max(0,Math.min(start,Math.max(0,total-30)));
  if(selected<start) start=selected;
  else if(selected>=start+30) start=selected-29;
  return {start,end:Math.min(total,start+30)};
}
// Follow stored links only; a held value is not evidence from the current text.
export function estimateOrigin(points:TrendPoint[], index:number, key:AxisKey):TrendPoint|null {
  const selected=points[index];
  if(!selected || score(selected,key)===null) return null;
  let cursor=index;
  while(cursor>=0) {
    const point=points[cursor], axis=analysis(point)?.axes?.[key];
    if(point.conversationId!==selected.conversationId || score(point,key)===null) return null;
    if(axis?.status!=='held') return axis?.status==='estimated' || !analysis(point) ? point : null;
    const previous=axis.previousMessageId;
    if(!previous) return null;
    const prior=points.findIndex((candidate,i)=>i<cursor && candidate.id===previous && candidate.conversationId===selected.conversationId);
    if(prior<0) return null;
    cursor=prior;
  }
  return null;
}
export function closeStateTrendPopup(container:HTMLElement) {
  container.querySelector<HTMLElement>('.trend-popover')?.hidePopover();
}
const formatDate = (value:string|null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) : '日時未記録';
const shortDate = (value:string|null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '日時未記録';
const displayScore = (value:number|null) => value === null ? '未推定' : `${value>0 ? '+' : value<0 ? '−' : ''}${Math.abs(value).toFixed(2)}`;
function html<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string):HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);if (text !== undefined) node.textContent = text;if(className) node.className = className;return node;
}
function svg<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>,text?:string):SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
  if(text !== undefined) node.textContent = text;return node;
}
export function renderStateTrend(container:HTMLElement, input:TrendPoint[]|undefined, truncated:boolean) {
  container.replaceChildren();
  const title = html('div',undefined,'section-heading');
  title.append(html('h2','状態の推移'));
  container.append(title);
  if(input === undefined) {container.append(html('p','履歴を取得できませんでした。','muted small'));return;}
  const points = chronologicalPoints(input);
  if(!points.length){container.append(html('p','この会話には状態の記録がありません。','muted small'));return;}
  if(truncated) container.append(html('p','直近500メッセージの履歴を表示','muted small'));
  title.append(html('span',`${points.length}発話 · 発話順`,'trend-meta'));
  let index = points.length - 1;
  let windowStart = Math.max(0,points.length-30);
  let activeAxis:AxisKey|null=null;
  const popup=html('div',undefined,'trend-popover');
  popup.setAttribute('popover','auto');popup.setAttribute('role','dialog');
  popup.setAttribute('aria-label','状態の推定と発言');
  const charts = html('div',undefined,'trend-charts');
  const detail = html('div',undefined,'trend-detail');
  const heading = html('div',undefined,'section-heading'), selectedHeading = html('h3');
  const controls = html('div',undefined,'trend-controls');
  const previousButton = html('button','前へ','secondary'), nextButton = html('button','次へ','secondary');
  previousButton.type = nextButton.type = 'button';controls.append(previousButton,nextButton);heading.append(selectedHeading,controls);
  const rangeLabel = html('label','発話をたどる','sr-only');rangeLabel.htmlFor = 'trend-position';
  const slider = html('input');slider.id = 'trend-position';slider.type = 'range';slider.min='0';slider.max=String(points.length-1);slider.disabled=points.length===1;
  const selectedDate = html('p',undefined,'muted small');
  const selectedContent = html('blockquote',undefined,'trend-utterance');
  selectedContent.setAttribute('aria-label','全グラフで選択中の発言');
  const visibleRange = html('p',undefined,'muted small');
  visibleRange.setAttribute('aria-live','polite');
  selectedHeading.setAttribute('aria-live','polite');
  detail.append(heading,rangeLabel,slider,selectedDate,selectedContent,visibleRange);
  const select = (next:number,key:AxisKey|null=null) => {index = Math.max(0,Math.min(points.length-1,next));activeAxis=key;update();};
  previousButton.addEventListener('click',()=>select(index-1));nextButton.addEventListener('click',()=>select(index+1));slider.addEventListener('input',()=>select(Number(slider.value)));
  function update() {
    popup.hidePopover();popup.replaceChildren();
    let popupAnchor:SVGElement|null=null;
    const selected = points[index], previous = points[index-1];
    const window = trendWindow(points.length,index,windowStart);
    windowStart=window.start;
    const visiblePoints=points.slice(window.start,window.end), selectedIndex=index-window.start;
    // Every axis uses the same utterance slots, including unestimated values.
    const xs=trendPositions(visiblePoints.length);
    const tickIndices=[...new Set([0,Math.floor((visiblePoints.length-1)/2),visiblePoints.length-1])];
    visibleRange.textContent=`グラフ表示：発話 ${window.start+1}〜${window.end} / ${points.length}（最大30発話・等間隔）`;
    selectedHeading.textContent = `発話 ${index+1} / ${points.length}`;
    previousButton.disabled = index === 0;nextButton.disabled = index === points.length-1;slider.value=String(index);
    slider.setAttribute('aria-valuetext',`${index+1}番目の発話、${formatDate(selected.createdAt)}`);
    selectedDate.textContent = formatDate(selected.createdAt);charts.replaceChildren();
    selectedContent.textContent=selected.content || 'この発言の本文は取得できませんでした。';
    for(const {key,label,color,low,high} of dimensions) {
      if(key === 'interest') continue;
      const currentScore = score(selected,key), previousScore = score(previous,key);
      const delta = previous?.conversationId === selected.conversationId && currentScore !== null && previousScore !== null ? currentScore-previousScore : null;
      const stateLabel = html('p',currentScore === null ? '未推定' : axisLabel(selected,key).startsWith('▲') ? '▲ 前回値を維持' : axisLabel(selected,key),'muted small');
      stateLabel.title = axisLabel(selected,key);
      const comparison = html('div',undefined,'trend-chart-meta');
      comparison.append(stateLabel,html('span',`前回比 ${delta === null ? '—' : `${delta>0 ? '+' : ''}${delta.toFixed(2)}`}`));
      const card = html('div',undefined,'trend-chart'), title = html('div',undefined,'section-heading');
      title.append(html('h3',label),html('span',displayScore(currentScore)));card.append(title,html('p',`−1 ${low} ↔ +1 ${high}`,'axis-description'));
      const geometry = trendGeometry(visiblePoints,key,xs);
      const graph = svg('svg',{viewBox:'0 0 640 192',role:'group','aria-label':`${label}の推移。発話${window.start+1}〜${window.end}を発話順に等間隔で表示。全グラフで発話${index+1}を選択中。選択した発話の値は${displayScore(currentScore)}。点を押すと発言を確認できます。`});
      for(const tick of [-1,-.5,0,.5,1]) {
        const y = 90-tick*60;
        graph.append(svg('line',{x1:46,x2:606,y1:y,y2:y,stroke:tick===0 ? '#9baea4' : '#e1e9e5','stroke-width':tick===0 ? 2 : 1}),svg('text',{x:38,y:y+6,'text-anchor':'end',fill:'#63756f','font-size':16},`${tick>0 ? '+' : ''}${tick.toFixed(1)}`));
      }
      graph.append(svg('line',{x1:geometry.xs[selectedIndex],x2:geometry.xs[selectedIndex],y1:25,y2:153,stroke:'#8b9eac','stroke-dasharray':'4 4'}),svg('path',{d:geometry.path,fill:'none',stroke:color,'stroke-width':3}));
      for(const i of tickIndices) {
        graph.append(svg('text',{x:xs[i],y:180,'text-anchor':'middle',fill:'#63756f','font-size':16},`発話${window.start+i+1}`));
      }
      visiblePoints.forEach((point,i)=>{
        const value = score(point,key);if(value === null)return;
        const x = geometry.xs[i],y=90-value*60,r=i===selectedIndex ? 7:5;
        const held = axisLabel(point,key).startsWith('▲');
        const marker = held ? svg('polygon',{points:`${x},${y-r} ${x-r},${y+r} ${x+r},${y+r}`,fill:color,stroke:'white','stroke-width':1.5}) : svg('circle',{cx:x,cy:y,r,fill:color,stroke:'white','stroke-width':1.5});
        marker.setAttribute('tabindex','0');marker.setAttribute('role','button');
        marker.setAttribute('aria-haspopup','dialog');
        marker.setAttribute('aria-label',`発話${window.start+i+1} ${label} ${displayScore(value)}。発言を表示`);
        marker.append(svg('title',{},`発話${window.start+i+1} ${formatDate(point.createdAt)} ${label} ${displayScore(value)} ${axisLabel(point,key)}`));
        marker.addEventListener('click',()=>select(window.start+i,key));
        marker.addEventListener('keydown',event=>{const keyboard=event as KeyboardEvent;if(keyboard.key==='Enter' || keyboard.key===' ') {event.preventDefault();select(window.start+i,key);}});
        if(activeAxis===key && i===selectedIndex) popupAnchor=marker;
        graph.append(marker);
      });
      card.append(graph);
      const dates = html('div',undefined,'trend-dates');dates.append(html('span',`発話${window.start+1} · ${shortDate(visiblePoints[0].createdAt)}`),html('span',`発話${window.end} · ${shortDate(visiblePoints[visiblePoints.length-1].createdAt)}`));card.append(dates,comparison);charts.append(card);
    }
    if(activeAxis && popupAnchor) showPopup(activeAxis,popupAnchor);
  }
  function showPopup(key:AxisKey,anchor:SVGElement) {
    const point=points[index], dimension=dimensions.find(axis=>axis.key===key)!;
    const held=analysis(point)?.axes?.[key]?.status==='held';
    const heading=html('div',undefined,'section-heading');
    heading.append(html('h3',`${dimension.label}　${displayScore(score(point,key))}`));
    const close=html('button','×','popover-close');close.type='button';
    close.setAttribute('aria-label','吹き出しを閉じる');
    close.setAttribute('autofocus','');
    const dismiss=()=>{popup.hidePopover();anchor.focus();};
    close.addEventListener('click',dismiss);
    popup.onkeydown=event=>{if(event.key==='Escape') {event.preventDefault();dismiss();}};
    heading.append(close);
    const body=html('div',undefined,'trend-popover-body');
    body.append(html('p',`発話${index+1} · ${formatDate(point.createdAt)}`,'muted small'),html('p',axisLabel(point,key),'popover-status'));
    body.append(html('h4',held ? 'この時の発言' : '推定時の発言'));
    body.append(html('blockquote',point.content || 'この発言の本文は取得できませんでした。','popover-utterance'));
    if(held) {
      body.append(html('p','この発話では更新せず、前回の推定値を維持しています。','muted small'));
      const origin=estimateOrigin(points,index,key);
      body.append(html('h4','値の元になった発言'));
      if(origin) {
        body.append(html('p',formatDate(origin.createdAt),'muted small'),html('blockquote',origin.content || '元の発言の本文は取得できませんでした。','popover-utterance'));
      } else body.append(html('p','取得済みの履歴では、元の推定発言を確認できません。','muted small'));
    }
    body.append(html('p','保存された発言と推定状態を表示しています。AIの判断理由を説明するものではありません。','popover-note'));
    popup.append(heading,body);
    popup.showPopover();
    const target=anchor.getBoundingClientRect(), box=popup.getBoundingClientRect();
    const above=target.top>=box.height+28;
    const left=Math.max(16,Math.min(target.left+target.width/2-box.width/2,globalThis.innerWidth-box.width-16));
    const top=Math.max(16,Math.min(above ? target.top-box.height-12 : target.bottom+12,globalThis.innerHeight-box.height-16));
    popup.style.left=`${left}px`;popup.style.top=`${top}px`;
    popup.setAttribute('data-side',above ? 'bottom' : 'top');
    popup.style.setProperty('--arrow-left',`${Math.max(18,Math.min(target.left+target.width/2-left,box.width-18))}px`);
  }
  const legend = html('div',undefined,'trend-legend');
  legend.append(html('span','● 推定　▲ 前回値を維持 · 点をクリックすると発言を表示'));
  const help = html('details',undefined,'trend-help');
  help.append(html('summary','表示について'),html('p','各軸は−1〜＋1、0.25刻みの9段階が基準です。0は快・不快では中立、それ以外では中程度を表します。負の値が悪い状態を意味するとは限りません。未推定の初期値0は表示せず、線を途切れさせます。▲は前回値の維持、前回比は直前の発話との差です。旧形式の0〜1の値は−1〜＋1へ換算し、最も近い0.25刻みに丸めています（旧形式でも快・不快は符号を維持）。符号付きの記録は元の値を表示します。軸は互いに独立し、診断や気持ちの断定ではありません。'));
  help.append(html('p','全グラフで同じ発話順・表示範囲・選択位置を共有します。横軸は日時順に並べた発話の等間隔で、時間の長さは表しません。同じ日時の発話は取得順、日時未記録の発話は末尾に取得順で表示します。最初は直近30発話を表示します。スライダーや「前へ・次へ」、各グラフの点で発話を選ぶと、全グラフと上の発言本文が一緒に切り替わります。未推定の軸でも、その発話の横軸位置は変わりません。'));
  legend.append(help);
  container.append(detail,charts,legend,popup);update();
}
