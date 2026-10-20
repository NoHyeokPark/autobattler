// 장신구의 위치 기준 대상: 기준 칸 = 보드 중앙 (2행 2열, 5번 칸). 상대 대상이면 상대 보드의 중앙
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { describeTrigger, filterText } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { T } from '../src/data/targets.ts';
import type { Effect } from '../src/data/types.ts';

const team = (slots: number[], trinkets: string[] = []): TeamSnapshot => ({
  name: 't', leaderId: 'knight', leaderLevel: 1, growth: [],
  board: slots.map((slot): BoardEntry => ({ slot, kind: 'monster', defId: 'guardian', level: 1 })), trinkets,
});

// 전투 시작 시 효과 하나를 내는 시험용 장신구로 전투하고, 공격력이 바뀐 칸 번호를 돌려준다
function buffedSlots(effect: Effect, side: 0 | 1 = 0): number[] {
  const mod = snapshotMod('anchor-test');
  mod.trinkets.push({ id: 'test_anchor', name: '시험', grade: 1, desc: '', triggers: [{ on: 'battleStart', effects: [effect] }] });
  applyMod(mod);
  try {
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const r = simulateBattle({ player: team(all, ['test_anchor']), enemy: team(all), env: 'normal', day: 1, seed: 1 });
    return r.events
      .filter((e) => e.type === 'buff' && e.stat === 'atk' && e.target?.startsWith(`${side}-`))
      .map((e) => Number(e.target!.split('-')[1]))
      .sort((a, b) => a - b);
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

test('장신구 범위 대상은 보드 중앙이 기준 칸', () => {
  assert.deepEqual(buffedSlots({ type: 'atkFlat', target: T.adjacent(), amount: 5 }), [2, 4, 6, 8]);
  assert.deepEqual(buffedSlots({ type: 'atkFlat', target: T.self(), amount: 5 }), [5]);
  assert.deepEqual(buffedSlots({ type: 'atkFlat', target: T.around(), amount: 5 }), [1, 2, 3, 4, 6, 7, 8, 9]);
  assert.deepEqual(buffedSlots({ type: 'atkFlat', target: { side: 'ally', area: 'sameRow' }, amount: 5 }), [4, 5, 6]);
  assert.deepEqual(buffedSlots({ type: 'atkFlat', target: { side: 'ally', area: 'sameCol' }, amount: 5 }), [2, 5, 8]);
  assert.deepEqual(buffedSlots({ type: 'atkPct', target: T.mirror(), pct: -50 }, 1), [5]); // 상대 보드의 중앙
});

test('장신구 범위 대상 설명은 "중앙" 기준', () => {
  assert.equal(filterText(T.adjacent(), true), '중앙 상하좌우 아군');
  assert.equal(filterText(T.self(), true), '중앙 칸 아군');
  assert.equal(filterText(T.mirror(), true), '중앙 칸 상대');
  assert.equal(filterText({ side: 'ally', area: 'near', dirs: ['c', 'u', 'd', 'l', 'r'], tag: '야수' }, true), '중앙 칸과 그 상하좌우 아군 야수');
  assert.equal(filterText({ side: 'ally', area: 'sameRow' }, true), '가운데 행(2행) 아군');
  assert.equal(describeTrigger({ on: 'battleStart', effects: [{ type: 'atkFlat', target: T.adjacent(), amount: 2 }] }, true), '전투 시작: 중앙 상하좌우 아군 공격력 +2.');
  assert.equal(filterText(T.adjacent()), '인접 아군'); // 유닛은 그대로
});
