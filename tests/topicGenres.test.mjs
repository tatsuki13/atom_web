import test from 'node:test';
import assert from 'node:assert/strict';
import {inferTopicGenre, groupByTopicGenre, resolveTopicGenre} from '../admin-web/topic-genres.js';

test('old memory text and interest keywords use the same topic taxonomy without API categories', () => {
  for (const [text,id] of [
    ['コーヒーが苦手です','food'], ['料理','food'], ['園芸が好きです','gardening'],
    ['ガーデニング','gardening'], ['毎朝散歩しています','exercise'], ['旅行','travel'],
    ['音楽鑑賞','arts'], ['読書','reading'], ['編み物','craft'], ['Python','digital'],
    ['ＹｏｕＴｕｂｅ','digital'], ['家族と過ごす','relationships'], ['仕事','work'],
    ['明るい口調を希望している','communication'], ['普段は説明を短くしてほしい','communication'],
    ['掃除','daily'], ['具体的な話題のない記憶','other'], ['', 'other'], [null,'other'],
  ]) assert.equal(inferTopicGenre(text).id, id, text);
});

test('food names and person clues classify and manual genres override inference', () => {
  for (const text of ['りんご','カレー','納豆','うどん','プリン','トマト','チョコレート']) assert.equal(inferTopicGenre(text).id,'food',text);
  for (const text of ['田中さん','山田太郎','美空ひばり','藤井聡太']) assert.equal(inferTopicGenre(text).id,'person',text);
  assert.equal(inferTopicGenre('太郎','','person').id,'person');
  assert.equal(resolveTopicGenre({topicGenre:'person'},'りんご').id,'person');
  assert.equal(resolveTopicGenre({topicGenre:'other'},'りんご').id,'other');
  assert.equal(resolveTopicGenre({topicGenre:null},'りんご').id,'food');
  assert.equal(resolveTopicGenre({topicGenre:'invalid'},'りんご').id,'food');
});

test('keyword classification takes priority over incidental episode topics and unrelated memories', () => {
  assert.equal(inferTopicGenre('園芸','旅行中に料理教室へ行った').id,'gardening');
  assert.equal(inferTopicGenre('いつもの楽しみ','家庭菜園で野菜を育てています').id,'gardening');
  assert.equal(inferTopicGenre('花火を見に旅行に行った').id,'travel');
  assert.equal(inferTopicGenre('いつもの楽しみ').id,'other');
});

test('grouping is deterministic, keeps unknown items and never changes the stored content', () => {
  const items=[{text:'不明な項目'},{text:'散歩'},{text:'料理'},{text:'コーヒー'}];
  const before=JSON.stringify(items);
  const groups=groupByTopicGenre(items,item=>item.text);
  assert.deepEqual(groups.map(group=>group.genre.id),['food','exercise','other']);
  assert.equal(groups[0].items.length,2);
  assert.equal(groups.reduce((sum,group)=>sum+group.items.length,0),items.length);
  assert.equal(JSON.stringify(items),before);
});
