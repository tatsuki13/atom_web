import {resolveTopicGenre, createGenreEditor} from './topic-genres.js?v=20261030-edit-lock';
const memoryTime = memory => {
  const value = memory.createdAt ? Date.parse(memory.createdAt) : NaN;
  return Number.isFinite(value) ? value : null;
};
const memoryFrequency = memory => Number.isSafeInteger(memory.confirmationCount) && memory.confirmationCount >= 1 ? memory.confirmationCount : null;
const compareKnown = (a, b, direction) => a === null ? (b === null ? 0 : 1) : b === null ? -1 : direction * (a - b);

export function sortMemories(memories, order = 'newest') {
  return [...memories].sort((a, b) => {
    let primary = 0;
    if (order === 'category') {
      primary = resolveTopicGenre(a,a.content).rank - resolveTopicGenre(b,b.content).rank;
    } else if (order === 'frequency') {
      primary = compareKnown(memoryFrequency(a), memoryFrequency(b), -1);
    } else if (order === 'oldest') {
      primary = compareKnown(memoryTime(a), memoryTime(b), 1);
    }
    return primary || compareKnown(memoryTime(a), memoryTime(b), -1) ||
      String(a.id ?? a.content ?? '').localeCompare(String(b.id ?? b.content ?? ''), 'ja');
  });
}

export function fitMemoryList(container) {
  const children = [...container.children];
  const cards = children.filter(child => child.className === 'memory');
  const scrollable = cards.length > 9;
  container.classList.toggle('is-scrollable', scrollable);
  container.tabIndex = scrollable ? 0 : -1;
  container.setAttribute('aria-describedby', scrollable ? 'memory-scroll-hint' : '');
  if (scrollable) {
    const end = children.indexOf(cards[8]) + 1;
    const height = children.slice(0, end).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
    if (height > 0) container.style.setProperty('--memory-list-height', `${Math.ceil(height)}px`);
  }
}

export function fitInterestList(memories, interests) {
  const hasMemories = [...memories.children].some(child => child.className === 'memory');
  const height = hasMemories ? memories.getBoundingClientRect().height : 0;
  if (hasMemories && height <= 0) return; // Measure again after the memory tab becomes visible.
  interests.style.setProperty('--interest-list-height', height > 0 ? `${Math.ceil(height)}px` : '54rem');
  const scrollable = interests.scrollHeight > interests.clientHeight + 1;
  interests.tabIndex = scrollable ? 0 : -1;
}

export function renderMemoryList(container, memories, order, formatDate, editing) {
  const sorted = sortMemories(memories, order);
  const create = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const nodes = [];
  let previousGenre = null;
  for (const memory of sorted) {
    const genre = resolveTopicGenre(memory,memory.content);
    if (order === 'category' && genre.id !== previousGenre) {
      const count = sorted.filter(item => resolveTopicGenre(item,item.content).id === genre.id).length;
      nodes.push(create('h3', `${genre.label} · ${count}件`, 'memory-group-heading'));
      previousGenre = genre.id;
    }
    const card = create('article', null, 'memory');
    const meta = create('div', null, 'memory-meta');
    const count = memoryFrequency(memory);
    const badge = create('span', genre.label, 'memory-genre');
    badge.title = memory.topicGenre ? '手動で設定したジャンル' : '本文から推定したジャンル';
    meta.append(badge,
      create('span', count === null ? '確認回数未取得' : `確認 ${count}回`, 'memory-frequency'));
    card.append(create('p', memory.content), meta, create('small', `保存: ${formatDate(memory.createdAt)}`));
    if (editing) card.append(createGenreEditor(memory,genre,editing));
    nodes.push(card);
  }
  container.replaceChildren(...(nodes.length ? nodes : [create('p', '記憶がありません。', 'muted')]));
  container.scrollTop = 0;
  fitMemoryList(container);
}
