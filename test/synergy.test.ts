// 태그 시너지: 같은 몬스터는 1명, 리더도 셈, 가장 높은 단계 하나만, 시너지 몫은 "<시너지> 태그"로 기록
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { activeTier, synergyStates, tagCounts } from '../src/data/synergies.ts';
import type { MonsterDef, TagSynergy } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';
import { otherSources } from '../src/ui/analysis.ts';

const SY: TagSynergy = {
  tag: '야수', name: '야성', tiers: [
    { count: 2, triggers: [{ on: 'battleStart', effects: [{ type: 'gold', amount: 1 }] }] },
    { count: 4, triggers: [{ on: 'battleStart', effects: [{ type: 'gold', amount: 5 }] }] },
  ],
};

test('세는 규칙: 같은 id는 1명, 단계는 도달한 가장 높은 것', () => {
  const c = tagCounts([{ id: 'a', tags: ['야수'] }, { id: 'a', tags: ['야수'] }, { id: 'b', tags: ['야수', '어둠'] }]);
  assert.equal(c.get('야수'), 2);
  assert.equal(c.get('어둠'), 1);
  assert.deepEqual([1, 2, 3, 4, 9].map((n) => activeTier(SY, n)), [-1, 0, 0, 1, 1]);
  assert.deepEqual(synergyStates([{ id: 'x', tags: ['야수'] }], [SY]).map((s) => [s.count, s.tier]), [[1, -1]]);
});

const team = (board: BoardEntry[], leaderId = 'knight'): TeamSnapshot => ({ name: 't', leaderId, leaderLevel: 1, growth: [], board, trinkets: [] });
const mon = (slot: number, defId: string, level = 1): BoardEntry => ({ slot, kind: 'monster', defId, level });
const beast = (id: string): MonsterDef => ({ id, name: id, grade: 1, tags: ['야수'], hp: 300, atk: 1, intervalTicks: 30, desc: '', triggers: [] });

function run(board: BoardEntry[], synergies: TagSynergy[]) {
  const mod = snapshotMod('syn');
  mod.monsters.push(beast('b1'), beast('b2'), beast('b3'));
  mod.synergies = synergies;
  applyMod(mod);
  try {
    return simulateBattle({ player: team(board), enemy: team([mon(5, 'guardian')]), env: 'normal', day: 3, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

test('전투: 같은 몬스터 두 장은 1명, 가장 높은 단계만 발동', () => {
  assert.equal(run([mon(1, 'b1'), mon(2, 'b1', 2)], [SY]).gains[0].gold, 0); // 같은 몬스터 → 1명
  const two = run([mon(1, 'b1'), mon(2, 'b2')], [SY]);
  assert.equal(two.gains[0].gold, 1);
  assert.deepEqual(two.synergies, [{ side: 0, tag: '야수', name: '야성', count: 2, tier: 0, need: 2 }]);
  // 4명이면 2단계만 (1단계 골드 1은 따로 안 받음)
  const mod = snapshotMod('syn4');
  mod.monsters.push(beast('b1'), beast('b2'), beast('b3'), beast('b4'));
  mod.synergies = [SY];
  applyMod(mod);
  try {
    const r = simulateBattle({ player: team([mon(1, 'b1'), mon(2, 'b2'), mon(3, 'b3'), mon(4, 'b4')]), enemy: team([mon(5, 'guardian')]), env: 'normal', day: 3, seed: 1 });
    assert.equal(r.gains[0].gold, 5);
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('리더의 태그도 센다', () => {
  const mod = snapshotMod('syn-leader');
  mod.monsters.push(beast('b1'));
  const leader = mod.leaders[0];
  leader.tags = [...leader.tags, '야수'];
  mod.synergies = [SY];
  applyMod(mod);
  try {
    const r = simulateBattle({ player: team([mon(1, 'b1'), { slot: 5, kind: 'leader', defId: leader.id, level: 1 }], leader.id), enemy: team([mon(5, 'guardian')]), env: 'normal', day: 3, seed: 1 });
    assert.equal(r.gains[0].gold, 1);
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('시너지가 낸 피해는 분석에 "<시너지> 태그"로', () => {
  const dmg: TagSynergy = { tag: '야수', tiers: [{ count: 2, triggers: [{ on: 'battleStart', effects: [{ type: 'damage', flat: 30 }] }] }] };
  const r = run([mon(1, 'b1'), mon(2, 'b2')], [dmg]);
  const row = otherSources(r).find((o) => o.label === '<시너지> 야수');
  assert.equal(row?.damage, 30);
});

test('검증: 단계의 필요한 수는 앞 단계보다 커야 한다', () => {
  const mod = snapshotMod('syn-v');
  mod.synergies = [{ tag: mod.tags[0], tiers: [{ count: 3, triggers: [] }, { count: 2, triggers: [] }] }];
  assert.ok(validateMod(mod).errors.some((e) => e.includes('앞 단계보다')));
});
