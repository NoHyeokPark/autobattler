// 관통 피해, 괴사(최대 체력을 깎는 상태), "아군 체력 N% 이하" 트리거
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { describeStatus, describeTrigger } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import type { Effect, Trigger } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });

// 시험 몬스터(행동 효과)와 시험 장신구(내 쪽·상대 쪽)로 실행
function run(opts: { act?: Effect[]; mine?: Trigger[]; foe?: Trigger[]; hp?: number }): BattleResult {
  const mod = snapshotMod('necrosis-test');
  mod.monsters.push({ id: 'test_n', name: '시험', grade: 1, tags: [], hp: opts.hp ?? 3000, atk: 20, intervalTicks: 20, desc: '', triggers: [{ on: 'act', effects: opts.act ?? [] }] });
  mod.trinkets.push({ id: 't_mine', name: '내 것', grade: 1, desc: '', triggers: opts.mine ?? [] });
  mod.trinkets.push({ id: 't_foe', name: '상대 것', grade: 1, desc: '', triggers: opts.foe ?? [] });
  applyMod(mod);
  try {
    return simulateBattle({ player: team([mon(5, 'test_n')], ['t_mine']), enemy: team([mon(5, 'guardian')], ['t_foe']), env: 'normal', day: 1, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

test('관통 피해는 실드를 무시한다', () => {
  const foe: Trigger[] = [{ on: 'battleStart', effects: [{ type: 'shield', flat: 500 }] }];
  const normal = run({ act: [{ type: 'damage', atkPct: 100 }], foe });
  const pierce = run({ act: [{ type: 'damage', atkPct: 100, pierce: true }], foe });
  const hit = (r: BattleResult) => r.events.find((e) => e.type === 'damage' && e.src === '0-5')!;
  assert.match(hit(normal).note ?? '', /실드 20 흡수/);
  assert.equal(hit(pierce).note, '관통');
  assert.equal(hit(pierce).shieldAfter, 500); // 실드는 그대로
});

test('괴사: 들어간 피해만큼 최대 체력도 줄고, 회복은 줄어든 최대 체력까지만', () => {
  const r = run({
    mine: [{ on: 'battleStart', effects: [{ type: 'status', status: 'necrosis', flat: 6, to: 'enemy' }] }],
    foe: [{ on: 'battleStart', effects: [{ type: 'status', status: 'regen', flat: 50, to: 'ally' }] }],
  });
  const cuts = r.events.filter((e) => e.type === 'buff' && e.stat === 'maxHp' && e.srcName === '괴사' && e.target === 'team1');
  assert.deepEqual(cuts.slice(0, 3).map((e) => e.amount), [-6, -5, -4]); // 중첩 6 → 1씩 감쇠
  const total = cuts.reduce((s, e) => s - (e.amount ?? 0), 0);
  // 재생 50이 매초 들어와도 체력은 (원래 최대 - 잃은 최대)를 넘지 않는다
  const maxNow = r.maxHp[1] - total;
  for (const e of r.events) if (e.type === 'heal' && e.target === 'team1' && e.t > 70) assert.ok((e.after ?? 0) <= maxNow);
  assert.match(describeStatus('necrosis'), /최대 체력도 줄어듦/);
});

test('괴사는 실드에 막힌다 (독과 반대)', () => {
  const r = run({
    mine: [{ on: 'battleStart', effects: [{ type: 'status', status: 'necrosis', flat: 6, to: 'enemy' }] }],
    foe: [{ on: 'battleStart', effects: [{ type: 'shield', flat: 1000 }] }],
  });
  assert.equal(r.events.filter((e) => e.type === 'buff' && e.srcName === '괴사').length, 0);
});

test('아군 체력 N% 이하 트리거: 처음 그 아래로 내려간 순간 한 번만', () => {
  const r = run({
    hp: 60,
    mine: [{ on: 'lowHp', hpPct: 50, effects: [{ type: 'shield', flat: 7 }] }],
    foe: [{ on: 'battleStart', effects: [{ type: 'status', status: 'poison', flat: 5, to: 'enemy' }] }],
  });
  const fired = r.events.filter((e) => e.type === 'shield' && e.srcName === '내 것');
  assert.equal(fired.length, 1);
  // 발동 직전 피해로 체력이 처음 절반 이하가 됐다
  const before = r.events.filter((e) => e.type === 'damage' && e.target === 'team0' && e.t <= fired[0].t);
  const maxHp = r.maxHp[0];
  assert.ok((before.at(-1)!.after ?? 0) * 100 <= 50 * maxHp);
  assert.ok(before.slice(0, -1).every((e) => (e.after ?? 0) * 100 > 50 * maxHp));
  assert.equal(describeTrigger({ on: 'lowHp', hpPct: 30, effects: [{ type: 'heal', flat: 10 }] }), '아군 체력 30% 이하 (1회): 10 회복.');
});

test('검증: 체력 % 범위', () => {
  const mod = structuredClone(DEFAULT_MOD);
  mod.trinkets.push({ id: 'bad', name: '잘못', grade: 1, desc: '', triggers: [{ on: 'lowHp', hpPct: 150, effects: [] }] });
  assert.ok(validateMod(mod).errors.some((e) => e.includes('체력 %')));
});
