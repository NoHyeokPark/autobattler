// 전투 시작 후 N초 트리거: 1회 / 반복(N초마다, 최대 횟수)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { BALANCE } from '../src/config/balance.ts';
import { describeTrigger } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import type { Trigger } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });
const TPS = BALANCE.ticksPerSec;

// 실드 1을 주는 시험 장신구(트리거 하나)와, 오래 버티는 두 몬스터로 싸운다. 그 장신구의 실드 이벤트 tick 목록을 돌려준다
function shieldTicks(trig: Omit<Trigger, 'effects'>, unitTrig = false): { ticks: number[]; r: BattleResult } {
  const mod = snapshotMod('timer-test');
  const t: Trigger = { ...trig, effects: [{ type: 'shield', flat: 1 }] };
  mod.trinkets.push({ id: 't_tick', name: '시계', grade: 1, desc: '', triggers: unitTrig ? [] : [t] });
  mod.monsters.push({ id: 'test_wall', name: '벽', grade: 1, tags: [], hp: 100000, atk: 1, intervalTicks: 20, desc: '', triggers: unitTrig ? [t] : [] });
  applyMod(mod);
  try {
    const r = simulateBattle({ player: team([mon(5, 'test_wall')], unitTrig ? [] : ['t_tick']), enemy: team([mon(5, 'test_wall')]), env: 'normal', day: 1, seed: 1 });
    const src = (e: BattleResult['events'][number]) => e.src === (unitTrig ? '0-5' : 'trinket:0:t_tick');
    return { ticks: r.events.filter((e) => e.type === 'shield' && src(e)).map((e) => e.t), r };
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

test('N초 트리거: 반복이 없으면 N초에 한 번', () => {
  assert.deepEqual(shieldTicks({ on: 'timer', atSec: 3 }).ticks, [3 * TPS]);
});

test('N초 반복: N초마다 (N, 2N, 3N …) 전투가 끝날 때까지', () => {
  const { ticks, r } = shieldTicks({ on: 'timer', atSec: 4, repeat: true });
  assert.ok(ticks.length >= 3);
  ticks.forEach((t, i) => assert.equal(t, (i + 1) * 4 * TPS));
  const end = r.events[r.events.length - 1].t;
  assert.equal(ticks.length, Math.floor(end / (4 * TPS)), '끝날 때까지 빠짐없이');
});

test('N초 반복: 최대 횟수까지만, 유닛 능력도 같은 방식', () => {
  assert.deepEqual(shieldTicks({ on: 'timer', atSec: 2, repeat: true, limit: 3 }).ticks, [2, 4, 6].map((s) => s * TPS));
  assert.deepEqual(shieldTicks({ on: 'timer', atSec: 5, repeat: true, limit: 2 }, true).ticks, [5, 10].map((s) => s * TPS));
});

test('N초 반복: 설명과 검증 (0초 반복은 오류, N초 트리거가 아니면 경고)', () => {
  assert.match(describeTrigger({ on: 'timer', atSec: 5, repeat: true, effects: [] }), /^5초마다:/);
  assert.match(describeTrigger({ on: 'timer', atSec: 5, repeat: true, limit: 3, effects: [] }), /^5초마다 \(최대 3회\):/);
  assert.match(describeTrigger({ on: 'timer', atSec: 5, effects: [] }), /^5초:/);
  const mod = structuredClone(DEFAULT_MOD);
  mod.trinkets.push({ id: 'z', name: '영초', grade: 1, desc: '', triggers: [{ on: 'timer', atSec: 0, repeat: true, effects: [] }] });
  mod.trinkets.push({ id: 'w', name: '잘못', grade: 1, desc: '', triggers: [{ on: 'act', repeat: true, effects: [] }] });
  const v = validateMod(mod);
  assert.ok(v.errors.some((e) => e.includes('반복하려면')));
  assert.ok(v.warnings.some((w) => w.includes('"반복"')));
});
