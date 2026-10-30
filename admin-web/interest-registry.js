import {groupByTopicGenre, resolveTopicGenre, createGenreEditor} from './topic-genres.js?v=20261030-edit-lock';
import {sortMemories} from './memory-list.js?v=20261030-edit-lock';

const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text != null) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const valid = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const observedDate = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'}) : '未記録';
const percentOf = item => valid(item.interestScore, 1) ? Math.round(item.interestScore * 100) : null;

const activityLabel = item => item.activityStatus === 'active' ? '活動中' : item.activityStatus === 'paused' ? '休止中' : '';
const detailLabels = {appeal:'好きな点', origin:'きっかけ', experience:'経験'};

// The vertical position follows the latest explicit preference before accumulated weights.
// Missing coordinates stay missing; absence is never plotted as rejection or inactivity.
export function interestChartPosition(item, axis = 'activity') {
  let y = valid(item.interestScore, 1) ? item.interestScore : null;
  if (item.explicitPolarity === 'negative') y = Math.min(y ?? .25, .25);
  if (item.explicitPolarity === 'positive') y = Math.max(y ?? .75, .75);
  const x = axis === 'spontaneity'
    ? (valid(item.spontaneityScore, 1) ? item.spontaneityScore : null)
    : item.activityStatus === 'active' ? .85 : item.activityStatus === 'paused' ? .15 : null;
  return {x, y};
}
const preferenceLabel = item => item.explicitPolarity === 'negative' ? '興味なしの明言あり'
  : item.explicitPolarity === 'positive' ? '興味ありの明言あり'
  : !valid(item.interestScore, 1) ? '興味の方向が未推定'
  : item.interestScore > .5 ? '興味ありの傾向' : item.interestScore < .5 ? '興味なしの傾向' : '中立・判断材料が少ない';

export function renderInterestChart(container, items, editing, memories = []) {
  container.replaceChildren();
  const topics = Array.isArray(items) ? items : [];
  let axis = 'activity', selected = null;
  const controls = node('div', null, 'interest-axis-switch');
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '横軸の切り替え');
  const modes = [['activity','活動状況'],['spontaneity','本人の自発性']];
  const buttons = modes.map(([value, label]) => {
    const button = node('button', label, 'secondary');
    button.setAttribute('type', 'button');
    button.addEventListener('click', () => { axis = value; draw(); });
    controls.append(button); return button;
  });
  const help = node('details', null, 'trend-help interest-details');
  help.append(node('summary', 'グラフの見方'));
  help.append(node('p', '上ほど興味あり、下ほど興味なし。縦の位置は本人の最新の明言を優先し、それ以外は蓄積した関心度を使います。休止中でも興味ありのまま表示できます。点が濃いほど根拠の確かさの目安が高くなります。確かさは根拠量に基づく指標で、統計的な確率ではありません。', 'muted small'));
  const explanation = node('p', null, 'muted small interest-axis-note');
  const plot = node('div', null, 'interest-plot interest-quadrant');
  const list = node('div', null, 'interest-topic-list');
  const detail = node('section', null, 'interest-selection');
  detail.setAttribute('aria-live', 'polite'); detail.setAttribute('aria-label', '選択した興味の詳細');
  container.append(controls, explanation, help, plot, list, detail);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = (tag, attributes, text) => {
    const result = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, String(value));
    if (text != null) result.textContent = text;
    return result;
  };
  const draw = focusOrigin => {
    let focusedPoint = null, focusedKeyword = null;
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(modes[index][0] === axis)));
    const activity = axis === 'activity';
    explanation.textContent = activity
      ? '横軸：左は「やっていない・休止中」、右は「やっている」。活動状況は実施中／休止中の区分で表示します。'
      : '横軸：左は「聞かれて話す」、右は「自分から話す」。日ごとの観測を使い、同じ日の繰り返しでは偏らせません。過去の未集計データは未判定です。';
    plot.replaceChildren(); list.replaceChildren(); detail.replaceChildren();
    const graph = svg('svg', {viewBox:'0 0 820 510',role:'group','aria-label':`興味関心の四象限グラフ。縦軸は興味の方向、横軸は${activity ? '活動状況' : '本人の自発性'}。キーワードを選ぶと詳細を表示します。`});
    const left = 110, right = 742, top = 68, bottom = 410, middleX = 426, middleY = 239;
    for (const [x,y,fill] of [[left,top,'#eef6f1'],[middleX,top,'#e6f1ed'],[left,middleY,'#f7f4ef'],[middleX,middleY,'#f3f0ed']]) {
      graph.append(svg('rect',{x,y,width:316,height:171,fill}));
    }
    graph.append(svg('rect',{x:left,y:top,width:right-left,height:bottom-top,fill:'none',stroke:'#cfddd5',rx:8}));
    graph.append(svg('line',{x1:left,x2:right,y1:middleY,y2:middleY,stroke:'#9eb4a8','stroke-dasharray':'5 5'}));
    graph.append(svg('line',{x1:middleX,x2:middleX,y1:top,y2:bottom,stroke:'#9eb4a8','stroke-dasharray':'5 5'}));
    graph.append(svg('text',{x:middleX,y:top-20,'text-anchor':'middle',fill:'#355c4c','font-size':14},'興味あり'));
    graph.append(svg('text',{x:middleX,y:bottom+28,'text-anchor':'middle',fill:'#796a5d','font-size':14},'興味なし'));
    graph.append(svg('text',{x:left/2,y:middleY+5,'text-anchor':'middle',fill:'#4c6358','font-size':12},activity ? 'やっていない' : '聞かれて話す'));
    graph.append(svg('text',{x:(right+820)/2,y:middleY+5,'text-anchor':'middle',fill:'#4c6358','font-size':12},activity ? 'やっている' : '自分から話す'));
    graph.append(svg('text',{x:middleX,y:490,'text-anchor':'middle',fill:'#77877f','font-size':12},'点の濃さ：根拠の確かさの目安　　破線の点：推定中'));
    const occupied = [];
    const placeLabel = (x,y,width) => {
      for (const offsetY of [0,28,-28,56,-56,84,-84,112,-112,140,-140]) {
        for (const offsetX of [14,-width-14,40,-width-40]) {
          const box = {x:Math.max(left+8, Math.min(right-width-8,x+offsetX)),y:Math.max(top+8,Math.min(bottom-30,y-12+offsetY)),width,height:24};
          if (!occupied.some(old => box.x < old.x+old.width+6 && box.x+box.width+6 > old.x && box.y < old.y+old.height+4 && box.y+box.height+4 > old.y)) {
            occupied.push(box); return box;
          }
        }
      }
      return null;
    };
    const select = (index, origin) => { selected = index; draw(origin); };
    let positioned = 0, unknown = 0;
    const renderOrder = topics.map((item,index) => ({item,index})).sort((a,b) => Number(b.index === selected)-Number(a.index === selected));
    for (const {item,index} of renderOrder) {
      const position = interestChartPosition(item, axis);
      if (position.x === null || position.y === null) { unknown++; continue; }
      positioned++;
      const x = left + (right-left)*position.x, y = bottom - (bottom-top)*position.y;
      const color = position.y > .5 ? '#31715a' : position.y < .5 ? '#98624f' : '#58758c';
      const group = svg('g',{role:'button',tabindex:0,'aria-label':`${item.keyword}：${preferenceLabel(item)}、${activity ? activityLabel(item) : `自分から話した割合 ${Math.round(position.x*100)}%`}${item.confirmationState === 'inferred' ? '、推定中' : ''}`,'aria-pressed':String(index === selected),'data-interest-point':index});
      group.append(svg('title',{},`${item.keyword}：${preferenceLabel(item)}${item.confirmationState === 'inferred' ? '（推定中）' : ''}／${activity ? activityLabel(item) : '本人の自発性'}`));
      const labelText = String(item.keyword ?? '');
      const short = labelText.length > 9 ? labelText.slice(0,9)+'…' : labelText;
      const box = placeLabel(x,y,Math.max(56,short.length*12+18));
      if (box) {
        group.append(svg('line',{x1:x,y1:y,x2:box.x+box.width/2,y2:box.y+12,stroke:color,'stroke-opacity':.3}));
        group.append(svg('rect',{x:box.x,y:box.y,width:box.width,height:24,rx:6,fill:'#fff','fill-opacity':.95,stroke:index === selected ? color : '#dde6e0'}));
        group.append(svg('text',{x:box.x+9,y:box.y+16,fill:color,'font-size':12},short));
      }
      group.append(svg('circle',{cx:x,cy:y,r:index === selected ? 8 : 6,fill:color,'fill-opacity':.28+.72*(valid(item.confidence,1) ? item.confidence : 0),stroke:color,'stroke-width':index === selected ? 3 : 1.5,'stroke-dasharray':item.confirmationState === 'inferred' ? '3 2' : 'none'}));
      if (index === selected) focusedPoint = group;
      group.addEventListener('click',()=>select(index,'point'));
      group.addEventListener('keydown',event=>{if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();select(index,'point');}});
      graph.append(group);
    }
    if (!topics.length) graph.append(svg('text',{x:middleX,y:middleY-15,'text-anchor':'middle',fill:'#63756f','font-size':14},'会話から見つかった興味・関心はまだありません。'));
    else if (!positioned) graph.append(svg('text',{x:middleX,y:middleY-15,'text-anchor':'middle',fill:'#63756f','font-size':14},'位置を決める情報はまだありません。'));
    plot.append(graph);
    if (topics.length) {
      list.append(node('p', `すべての話題 ${topics.length}件${unknown ? ` ／ 位置が未判定 ${unknown}件` : ''}。重なった点や未判定の話題も、一覧から選べます。`, 'muted small'));
      const keywords = node('div',null,'interest-keyword-buttons');
      for (const {genre,items:groupItems} of groupByTopicGenre(topics,item=>item.keyword,item=>interestGenreContext(item,memories))) {
        keywords.append(node('h4',`${genre.label} · ${groupItems.length}件`,'interest-genre-heading'));
        groupItems.forEach(item=>{
          const index = topics.indexOf(item);
          const position = interestChartPosition(item,axis);
          const reason = position.y === null ? '興味の方向が未推定' : position.x === null ? `${activity ? '活動状況' : '自発性'}が未判定` : '';
          const button = node('button',`${item.keyword}${item.confirmationState === 'inferred' ? '・推定中' : ''}${reason ? `（${reason}）` : ''}`,'secondary');
          button.setAttribute('type','button');button.setAttribute('aria-pressed',String(index === selected));button.setAttribute('data-interest-keyword',String(index));
          if (index === selected) focusedKeyword = button;
          button.addEventListener('click',()=>select(index,'list'));keywords.append(button);
        });
      }
      list.append(keywords);
    }
    if (selected !== null && topics[selected]) {
      const item = topics[selected];
      detail.append(node('h3',item.keyword));
      detail.append(createGenreEditor(item,resolveTopicGenre(item,item.keyword,interestGenreContext(item,memories)),editing));
      detail.append(node('p',`${preferenceLabel(item)}${item.confirmationState === 'inferred' ? '・推定中' : ''}`));
      detail.append(node('p',`活動状況：${activityLabel(item) || '未判定'}。休止中は興味なしという意味ではありません。`,'muted small'));
      detail.append(node('p',`本人の自発性：${valid(item.spontaneityScore,1) ? `自分から話した割合 ${Math.round(item.spontaneityScore*100)}%（観測日ベース）` : '未判定'}`,'muted small'));
      detail.append(node('p',`根拠の確かさ：${valid(item.confidence,1) ? Math.round(item.confidence*100)+'%（目安）' : '未判定'}`,'muted small'));
      if (item.lastObservedAt && Number.isFinite(Date.parse(item.lastObservedAt))) detail.append(node('p',`最後に話題に出た日時：${observedDate(item.lastObservedAt)}`,'muted small'));
      const excerpts = Array.isArray(item.details) ? item.details.filter(value=>value && Object.hasOwn(detailLabels,value.kind) && typeof value.content === 'string' && value.content.trim()).slice(-3) : [];
      for (const excerpt of excerpts) detail.append(node('p',`${detailLabels[excerpt.kind]}：${excerpt.content.slice(0,240)}`,'interest-selected-excerpt'));
    } else detail.append(node('p','キーワードを選ぶと、活動状況や本人の発言を確認できます。','muted small'));
    if (focusOrigin === 'point') focusedPoint?.focus();
    if (focusOrigin === 'list') focusedKeyword?.focus();
  };
  draw();
}

function interestGenreContext(item, memories) {
  return [
    ...(Array.isArray(item.details) ? item.details.map(detail => typeof detail?.content === 'string' ? detail.content : '') : []),
    ...memories.filter(memory => Array.isArray(item.sourceMemoryIds) && item.sourceMemoryIds.includes(memory.id)).map(memory => memory.content ?? ''),
  ].join(' ');
}

export function sortInterestItems(items, memories = [], order = 'category') {
  const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  return sortMemories(items.map(item => {
    const ids = [...new Set(Array.isArray(item.sourceMemoryIds) ? item.sourceMemoryIds : [])];
    const linked = ids.map(id => memories.find(memory => memory.id === id));
    const dates = linked.filter(Boolean).flatMap(memory => [memory.updatedAt,memory.createdAt]).filter(validTime);
    const createdAt = validTime(item.lastObservedAt) ? item.lastObservedAt
      : dates.sort((a,b) => Date.parse(b)-Date.parse(a))[0] ?? null;
    const knownCount = value => Number.isSafeInteger(value) && value >= 1;
    const confirmationCount = knownCount(item.confirmationCount) ? item.confirmationCount
      : linked.length && linked.every(memory => memory && knownCount(memory.confirmationCount))
        ? linked.reduce((sum,memory) => sum + memory.confirmationCount,0) : null;
    return {id:item.normalizedKey ?? item.keyword,content:item.keyword,createdAt,confirmationCount,
      topicGenre:resolveTopicGenre(item,item.keyword,interestGenreContext(item,memories)).id,interest:item};
  }),order).map(row => row.interest);
}

export function renderInterestRegistry(container, items, memories = [], editing, order = 'category') {
  container.replaceChildren();
  const confirmed = (items ?? []).filter(item =>
    (item.confirmationState === 'confirmed' || item.confirmationState == null) && item.explicitPolarity !== 'negative');
  if (!confirmed.length) container.append(node('p', '確定した興味・関心はまだありません。', 'muted'));
  const contextOf = item => interestGenreContext(item,memories);
  const sorted = sortInterestItems(confirmed,memories,order);
  const groups = order === 'category' ? groupByTopicGenre(sorted, item => item.keyword, contextOf) : [{genre:null,items:sorted}];
  for (const {genre, items:groupItems} of groups) {
    const section = node('section', null, 'interest-genre-group');
    if (genre) section.append(node('h3', `${genre.label} · ${groupItems.length}件`, 'interest-genre-heading'));
    const blocks = node('div', null, 'interest-blocks');
    for (const item of groupItems) {
      const block = node('article', null, 'interest-block');
      block.append(node('h4', item.keyword));
      block.append(createGenreEditor(item,resolveTopicGenre(item,item.keyword,contextOf(item)),editing));
      if (activityLabel(item)) {
        block.append(node('p', activityLabel(item), 'interest-activity'));
      }
      if (item.lastObservedAt && Number.isFinite(Date.parse(item.lastObservedAt))) block.append(node('p', `最後に話題に出た日時：${observedDate(item.lastObservedAt)}`, 'muted small'));
      const linked = memories.filter(memory => typeof memory.content === 'string' && memory.content.trim() && item.sourceMemoryIds?.includes(memory.id));
      const excerpts = Array.isArray(item.details) ? item.details.filter(detail => detail && Object.hasOwn(detailLabels, detail.kind) && typeof detail.content === 'string' && detail.content.trim()).slice(-12) : [];
      const seen = new Set();
      const details = node('details', null, 'interest-details');
      details.append(node('summary', 'この興味に関する記憶'));
      for (const detail of excerpts) {
        const content = detail.content.trim().slice(0,240);
        if (seen.has(content)) continue;
        seen.add(content);
        const entry = node('section', null, 'interest-excerpt');
        entry.append(node('h4', detailLabels[detail.kind]), node('p', content));
        details.append(entry);
      }
      for (const memory of linked) {
        const content = memory.content.trim();
        if (seen.has(content)) continue;
        seen.add(content);
        details.append(node('p', content));
      }
      if (seen.size) block.append(details);
      else block.append(node('p', '詳しいエピソードはまだありません。', 'muted small'));
      blocks.append(block);
    }
    section.append(blocks);
    container.append(section);
  }
}
