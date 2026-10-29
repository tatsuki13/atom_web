import test from 'node:test';
import assert from 'node:assert/strict';
import {sortMemories, fitMemoryList, fitInterestList} from '../admin-web/memory-list.js';

const memories = [
  {id:'routine', content:'毎朝散歩をしている', category:'routine', confirmationCount:3, createdAt:'2026-10-25T00:00:00Z'},
  {id:'person', content:'母と旅行へ行った', category:'person', confirmationCount:1, createdAt:'2026-10-26T00:00:00Z'},
  {id:'preference-old', content:'料理が好き', category:'preference', confirmationCount:3, createdAt:'2026-10-24T00:00:00Z'},
  {id:'preference-new', content:'コーヒーが好き', category:'preference', confirmationCount:3, createdAt:'2026-10-27T00:00:00Z'},
  {id:'legacy', category:'unexpected', createdAt:null},
];
const ids = rows => rows.map(row => row.id);

test('memory sorting groups genres and uses newer registrations to break frequency ties', () => {
  assert.deepEqual(ids(sortMemories(memories, 'category')), ['preference-new','preference-old','person','routine','legacy']);
  assert.deepEqual(ids(sortMemories(memories, 'frequency')), ['preference-new','routine','preference-old','person','legacy']);
  assert.deepEqual(ids(memories), ['routine','person','preference-old','preference-new','legacy']);
});

test('time sorting supports both directions and leaves missing or invalid dates last', () => {
  assert.deepEqual(ids(sortMemories(memories)), ['preference-new','person','routine','preference-old','legacy']);
  assert.deepEqual(ids(sortMemories(memories, 'oldest')), ['preference-old','routine','person','preference-new','legacy']);
  const rows = [{id:'missing'}, {id:'invalid',createdAt:'invalid'}, {id:'known',createdAt:'2026-10-28'}];
  for (const order of ['newest','oldest']) assert.equal(sortMemories(rows, order)[0].id, 'known');
  assert.deepEqual(sortMemories([], 'frequency'), []);
});

test('unknown counts are not interpreted as zero or fabricated registrations', () => {
  const rows = [{id:'missing'}, {id:'string',confirmationCount:'99'}, {id:'zero',confirmationCount:0}, {id:'known',confirmationCount:1}];
  assert.equal(sortMemories(rows, 'frequency')[0].id, 'known');
});

test('the scroll window fits the first nine variable-height cards and is keyboard focusable', () => {
  const styles = {}, classes = {};
  const container = {
    children:Array.from({length:12}, (_, i) => ({className:'memory',getBoundingClientRect:() => ({height:80 + i * 5})})),
    style:{setProperty:(key,value) => {styles[key] = value;}},
    classList:{toggle:(key,value) => {classes[key] = value;}},
    setAttribute(){},
  };
  fitMemoryList(container);
  assert.equal(styles['--memory-list-height'], '900px');
  assert.equal(classes['is-scrollable'], true);
  assert.equal(container.tabIndex, 0);
  assert.equal(container.children.length, 12, 'later cards remain available in the scroll region');
  container.children = container.children.slice(0, 9);
  fitMemoryList(container);
  assert.equal(classes['is-scrollable'], false);
  assert.equal(container.tabIndex, -1);
});

test('genre headings count toward scroll height but not the nine-card limit', () => {
  const styles = {}, classes = {};
  const card = () => ({className:'memory',getBoundingClientRect:() => ({height:100})});
  const heading = () => ({className:'memory-group-heading',getBoundingClientRect:() => ({height:30})});
  const container = {
    children:[heading(), ...Array.from({length:5}, card), heading(), ...Array.from({length:5}, card)],
    style:{setProperty:(key,value) => {styles[key] = value;}},
    classList:{toggle:(key,value) => {classes[key] = value;}},
    setAttribute(){},
  };
  fitMemoryList(container);
  assert.equal(styles['--memory-list-height'], '960px');
  assert.equal(classes['is-scrollable'], true);
  container.children.pop();
  fitMemoryList(container);
  assert.equal(classes['is-scrollable'], false);
});

test('interest scrolling follows the visible memory height and recovers from hidden or empty lists', () => {
  let height = 720;
  const styles = {};
  const memories = {children:[{className:'memory'}],getBoundingClientRect:()=>({height})};
  const interests = {scrollHeight:1000,clientHeight:720,scrollTop:140,
    style:{setProperty:(key,value)=>{styles[key]=value;}}};
  fitInterestList(memories,interests);
  assert.equal(styles['--interest-list-height'],'720px');
  assert.equal(interests.tabIndex,0);
  assert.equal(interests.scrollTop,140,'resizing preserves the reading position');
  height=0;fitInterestList(memories,interests);
  assert.equal(styles['--interest-list-height'],'720px','hidden tabs must not collapse the region');
  height=340;interests.clientHeight=340;fitInterestList(memories,interests);
  assert.equal(styles['--interest-list-height'],'340px');
  interests.scrollHeight=200;fitInterestList(memories,interests);
  assert.equal(interests.tabIndex,-1);
  memories.children=[];fitInterestList(memories,interests);
  assert.equal(styles['--interest-list-height'],'54rem','an empty memory list must not hide the interests');
});
