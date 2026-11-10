import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalToday,physicalDayOffset,validPhysicalDay,physicalDays,physicalValue,physicalFormatted} from '../admin-web/physical-history.js';

test('body dates use Tokyo midnight and navigate leap days and year boundaries',()=>{
  assert.equal(physicalToday(new Date('2026-11-08T15:00:00Z')),'2026-11-09');
  assert.equal(physicalToday(new Date('2026-11-08T14:59:59Z')),'2026-11-08');
  assert.equal(physicalDayOffset('2024-03-01',-1),'2024-02-29');
  assert.equal(physicalDayOffset('2026-01-01',-1),'2025-12-31');
  for (const day of ['2026-02-29','2026-11-31','','2026-1-1','invalid']) assert.equal(validPhysicalDay(day),false);
  assert.equal(validPhysicalDay('2024-02-29'),true);
});

test('missing days stay empty while zero values and invalid individual metrics remain distinct',()=>{
  const records=[{date:'2026-11-09',steps:0},{date:'2026-11-07',steps:123}];
  const days=physicalDays('2026-11-09',7,records);
  assert.equal(days.length,7);
  assert.equal(days[0].date,'2026-11-03');
  assert.equal(days[5].record,null);
  assert.equal(days[6].record.steps,0);
  assert.equal(physicalFormatted(0,'steps'),'0歩');
  assert.equal(physicalFormatted(432,'sleepMinutes'),'7時間12分');
  for (const value of [null,undefined,NaN,Infinity,-1,'20']) {
    assert.equal(physicalValue(value),null);
    assert.equal(physicalFormatted(value,'steps'),'未取得');
  }
  assert.equal(physicalDays('2026-11-09',30,records)[0].date,'2026-10-11');
});
