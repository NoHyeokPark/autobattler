// 희망(자원 상태)과 상태 소모 효과
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { describeStatus, effectSegs, segsText } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { T } from '../src/data/targets.ts';
import type { Effect, Trigger } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });

function run(act: Effect[], mine: Trigger[] = [], foe: Trigger[] = []): BattleResult {
  const mod = snapshotMod('hope-test');
  mod.monsters.push({ id: 'test_h', name: '마법소녀', grade: 1, tags: [], hp: 3000, atk: 10, intervalTicks: 20, desc: '', triggers: [{ on: 'act', effects: act }] });
  mod.trinkets.push({ id: 't_mine', name: '내 것', grade: 1, desc: '', triggers: mine });
  mod.trinkets.push({ id: 't_foe', name: '상대 것', grade: 1, desc: '', triggers: foe });
  applyMod(mod);
  try {
    return simulateBattle({ player: team([mon(5, 'test_h')], ['t_mine']), enemy: team([mon(5, 'guardian')], ['t_foe']), env: 'normal', day: 1, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}
const hope12: Trigger[] = [{ on: 'battleStart', effects: [{ type: 'status', status: 'hope', flat: 12, to: 'ally' }] }];
const spend = (r: BattleResult) => r.events.filter((e) => e.type === 'status' && e.note === '희망 소모');
const hits = (r: BattleResult) => r.events.filter((e) => e.type === 'damage' && e.src === '0-5').map((e) => e.amount);

test('상태 소모: 희망 5를 써서 소모한 만큼 강한 피해, 모자라면 발동하지 않는다', () => {
  const r = run([{ type: 'consume', status: 'hope', cost: 5, effects: [{ type: 'damage', atkPct: 100, scales: [{ src: 'consumed', pct: 300 }] }] }], hope12);
  assert.deepEqual(spend(r).map((e) => [e.amount, e.after]), [[-5, 7], [-5, 2]]);
  assert.deepEqual(hits(r), [25, 25]); // 공격력 10 + 소모 5 × 3, 세 번째 행동부터는 희망 2라 발동 없음
});

test('상태 소모: 이상이면 전부 소모 / 안쪽에서 화상·추가발동·가시', () => {
  const r = run([{
    type: 'consume', status: 'hope', cost: 3, all: true, effects: [
      { type: 'status', status: 'burn', flat: 0, scales: [{ src: 'consumed', pct: 100 }], to: 'enemy' },
      { type: 'extra', target: T.self(), amount: 1 },
      { type: 'status', status: 'thorns', flat: 0, scales: [{ src: 'consumed', pct: 50 }], to: 'ally' },
    ],
  }], hope12);
  assert.deepEqual(spend(r).map((e) => e.amount), [-12]);
  assert.equal(r.events.find((e) => e.type === 'status' && e.status === 'burn' && (e.amount ?? 0) > 0)!.amount, 12);
  assert.equal(r.events.find((e) => e.type === 'status' && e.status === 'thorns' && (e.amount ?? 0) > 0)!.amount, 6);
  assert.ok(r.events.some((e) => e.type === 'buff' && e.stat === 'extra' && e.target === '0-5' && e.after === 1));
});

test('상태 소모: 상대에게 걸린 독을 터뜨리기', () => {
  const poison: Trigger[] = [{ on: 'battleStart', effects: [{ type: 'status', status: 'poison', flat: 8, to: 'enemy' }] }];
  const r = run([{ type: 'consume', status: 'poison', cost: 1, all: true, from: 'enemy', effects: [{ type: 'damage', flat: 0, scales: [{ src: 'consumed', pct: 200 }] }] }], poison);
  const det = r.events.find((e) => e.type === 'status' && e.note === '독 소모')!;
  assert.equal(det.target, 'team1');
  assert.equal(hits(r)[0], -(det.amount ?? 0) * 2);
});

test('희망은 이로운 상태라 해주에 깎인다', () => {
  const r = run([], hope12, [{ on: 'timer', atSec: 1, effects: [{ type: 'dispel', pct: 50 }] }]);
  const cut = r.events.find((e) => e.type === 'status' && e.note === '해주: 희망')!;
  assert.deepEqual([cut.amount, cut.after], [-6, 6]);
});

test('설명과 검증', () => {
  const e: Effect = { type: 'consume', status: 'hope', cost: 5, effects: [{ type: 'damage', atkPct: 100, scales: [{ src: 'consumed', pct: 300 }] }] };
  assert.equal(segsText(effectSegs(e, { atk: 10, power: 0, hp: 50, level: 1 })), '희망 5 소모 → 25(공격력 100% + 소모한 중첩 300%) 피해');
  const all: Effect = { ...e, all: true } as Effect;
  assert.equal(segsText(effectSegs(all, { atk: 10, power: 0, hp: 50, level: 1 })), '희망 5 이상이면 전부 소모 → 10+(공격력 100% + 소모한 중첩 300%) 피해');
  assert.match(describeStatus('hope'), /자원/);
  const mod = structuredClone(DEFAULT_MOD);
  mod.trinkets.push({ id: 'nest', name: '중첩', grade: 1, desc: '', triggers: [{ on: 'timer', atSec: 1, effects: [{ type: 'consume', status: 'hope', cost: 1, effects: [{ type: 'consume', status: 'hope', cost: 1, effects: [] }] }] }] });
  assert.ok(validateMod(mod).errors.some((x) => x.includes('소모 안에 소모')));
});
