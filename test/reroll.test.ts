// 성장 선택지 다시 뽑기 (증강 리롤처럼 선택마다 1회)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/config/balance.ts';
import { Rng } from '../src/core/rng.ts';
import { rerollPick } from '../src/data/growth.ts';
import { beginDay, chooseGrowth, rerollGrowth } from '../src/game/run.ts';
import { buy, chooseUnitGrowth, rerollUnitGrowth } from '../src/game/shop.ts';
import { createRun } from '../src/game/state.ts';
import type { RunState } from '../src/game/state.ts';

function toLevelUp(s: RunState) {
  do beginDay(s);
  while (s.phase !== 'growth');
}

test('다시 뽑기: 지금 보이는 것과 다른 후보를 우선, 다른 후보가 없으면 null', () => {
  const rng = new Rng(1);
  const next = rerollPick(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c'], 3, rng)!;
  assert.equal(next.length, 3);
  assert.ok(next.includes('d') && next.includes('e')); // 새 후보 2개 + 기존 1개로 채움
  assert.equal(rerollPick(['a', 'b'], ['a', 'b'], 3, rng), null);
});

test('리더 성장: 레벨업마다 1회 다시 뽑기, 전직 선택에는 없음', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const s = createRun('knight', seed, `reroll-${seed}`);
    toLevelUp(s);
    assert.equal(s.growthRerolls, BALANCE.leader.growthRerolls);
    const before = [...s.growthChoices];
    assert.ok(rerollGrowth(s).ok);
    assert.equal(s.growthChoices.length, before.length);
    assert.ok(s.growthChoices.some((id) => !before.includes(id)), `seed ${seed}: 새 성장이 나온다`);
    assert.equal(s.growthRerolls, 0);
    assert.equal(rerollGrowth(s).ok, false); // 1회뿐
    assert.ok(chooseGrowth(s, 0).ok);

    toLevelUp(s); // Lv3 = 전직
    assert.equal(s.growthRerolls, 0);
    assert.equal(rerollGrowth(s).ok, false);
    chooseGrowth(s, 0);
    toLevelUp(s); // Lv4: 다시 1회
    assert.equal(s.growthRerolls, BALANCE.leader.growthRerolls);
  }
});

test('몬스터 성장: 선택마다 1회 다시 뽑기', () => {
  const s = createRun('knight', 3, 'reroll-unit');
  beginDay(s);
  if (s.phase === 'growth') chooseGrowth(s, 0);
  s.gold = 50;
  s.bench = s.bench.map(() => null);
  s.bench[0] = { uid: 801, defId: 'slime', level: 1 };
  s.bench[1] = { uid: 802, defId: 'slime', level: 1 };
  s.shop = [{ kind: 'monster', defId: 'slime' }];
  buy(s, 0); // 3장 → Lv2 성장 선택
  assert.equal(s.phase, 'unitGrowth');
  const p = s.unitGrowth[0];
  assert.equal(p.rerolls, BALANCE.unit.growthRerolls);
  const before = [...p.choices];
  assert.ok(rerollUnitGrowth(s).ok);
  assert.ok(p.choices.some((id) => !before.includes(id)));
  assert.equal(rerollUnitGrowth(s).ok, false);
  assert.ok(chooseUnitGrowth(s, 0).ok);
  assert.equal(s.phase, 'shop');
});
