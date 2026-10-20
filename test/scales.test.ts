// "내 X만큼" 비례 규칙과 리더·몬스터 대상 구분
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { effectSegs, filterText, segsText } from '../src/data/describe.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { T } from '../src/data/targets.ts';
import type { Effect, MonsterDef } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';

const team = (board: BoardEntry[], extra: Partial<TeamSnapshot> = {}): TeamSnapshot => ({
  name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets: [], ...extra,
});
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });
const dummy = team([mon(5, 'guardian')]);

// 시험용 몬스터 하나를 넣은 모드로 실행
function withMonster<R>(m: Partial<MonsterDef> & { triggers: MonsterDef['triggers'] }, fn: () => R): R {
  const mod = snapshotMod('scales-test');
  mod.monsters.push({ id: 'test_m', name: '시험', grade: 1, tags: ['야수'], hp: 50, atk: 10, intervalTicks: 20, desc: '', ...m });
  mod.trinkets.push({ id: 'test_poison', name: '독', grade: 1, desc: '', triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'poison', flat: 5, to: 'enemy' }] }] });
  applyMod(mod);
  try {
    return fn();
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}
const firstDamage = (r: ReturnType<typeof simulateBattle>, uid: string) => r.events.find((e) => e.type === 'damage' && e.src === uid)!.amount;

test('비례: 내 골드만큼 피해 (골드 × 50%)', () => {
  const dmg: Effect = { type: 'damage', atkPct: 100, scales: [{ src: 'gold', pct: 50 }] };
  withMonster({ triggers: [{ on: 'act', effects: [dmg] }] }, () => {
    const r = simulateBattle({ player: team([mon(5, 'test_m')], { gold: 20 }), enemy: dummy, env: 'normal', day: 1, seed: 1 });
    assert.equal(firstDamage(r, '0-5'), 10 + 10);
  });
});

test('비례: 상대에게 쌓인 독만큼 피해 (독 1당 2)', () => {
  const dmg: Effect = { type: 'damage', atkPct: 100, scales: [{ src: 'enemyStatus', status: 'poison', pct: 200 }] };
  withMonster({ triggers: [{ on: 'act', effects: [dmg] }] }, () => {
    const r = simulateBattle({ player: team([mon(5, 'test_m')], { trinkets: ['test_poison'] }), enemy: dummy, env: 'normal', day: 1, seed: 1 });
    assert.equal(firstDamage(r, '0-5'), 10 + 5 * 2);
  });
});

test('비례: 내 가속만큼 회복, 아군 야수 수만큼 공격력', () => {
  const effects: Effect[] = [
    { type: 'haste', target: T.self(), amount: 40 },
    { type: 'atkFlat', target: T.self(), amount: 0, scales: [{ src: 'allyCount', tag: '야수', pct: 300 }] },
  ];
  withMonster({ triggers: [{ on: 'battleStart', effects }] }, () => {
    // 시험 몬스터(야수) + 슬라임(야수) + 견습 기사(전사) → 야수 2 × 3 = 공격력 +6
    const r = simulateBattle({ player: team([mon(5, 'test_m'), mon(4, 'slime'), mon(6, 'squire')]), enemy: dummy, env: 'normal', day: 1, seed: 1 });
    const u = r.units.find((x) => x.uid === '0-5')!;
    assert.equal(u.startAtk, 10 + 6);
  });
  const heal: Effect = { type: 'heal', flat: 1, scales: [{ src: 'haste', pct: 50 }] };
  const segs = effectSegs(heal, { atk: 10, power: 0, hp: 50, level: 1, haste: 40 });
  assert.equal(segsText(segs), '21(1 + 가속 50%) 회복');
});

test('대상 구분: 리더만 / 몬스터만', () => {
  const effects: Effect[] = [
    { type: 'atkFlat', target: { side: 'ally', area: 'all', kind: 'leader' }, amount: 100 },
    { type: 'powerFlat', target: { side: 'ally', area: 'all', kind: 'monster' }, amount: 100 },
  ];
  withMonster({ triggers: [{ on: 'battleStart', effects }] }, () => {
    const r = simulateBattle({ player: team([mon(4, 'test_m'), { slot: 5, kind: 'leader', defId: 'knight', level: 1 }]), enemy: dummy, env: 'normal', day: 1, seed: 1 });
    const leader = r.units.find((x) => x.uid === '0-5')!;
    const monster = r.units.find((x) => x.uid === '0-4')!;
    assert.ok(leader.startAtk >= 100 && leader.startPower < 100);
    assert.ok(monster.startAtk < 100 && monster.startPower >= 100);
  });
  assert.equal(filterText({ side: 'ally', area: 'all', kind: 'leader' }), '아군 리더');
  assert.equal(filterText({ side: 'enemy', area: 'all', tag: '야수', kind: 'monster' }), '상대 야수 몬스터');
});

test('설명: 전투 밖에서 모르는 출처는 계수만, 아는 값은 계산', () => {
  const dmg: Effect = { type: 'damage', atkPct: 100, scales: [{ src: 'enemyStatus', status: 'poison', pct: 200 }, { src: 'gold', pct: 50 }] };
  assert.equal(segsText(effectSegs(dmg, { atk: 10, power: 0, hp: 50, level: 1, gold: 20 })), '20+(공격력 100% + 상대 독 200% + 골드 50%) 피해');
  // 전투 중에는 지금 값으로 다 계산된다
  const live = segsText(effectSegs(dmg, { atk: 10, power: 0, hp: 50, level: 1, gold: 20, source: (sc) => (sc.src === 'enemyStatus' ? 5 : undefined) }));
  assert.equal(live, '30(공격력 100% + 상대 독 200% + 골드 50%) 피해');
});

test('검증: 알 수 없는 출처는 오류, 정상 비례는 통과', () => {
  const mod = structuredClone(DEFAULT_MOD);
  const m = mod.monsters.find((x) => x.id === 'slime')!;
  m.triggers = [{ on: 'act', effects: [{ type: 'damage', scales: [{ src: 'gold', pct: 50 }] }] }];
  assert.deepEqual(validateMod(mod).errors, []);
  (m.triggers[0].effects[0] as { scales: unknown[] }).scales = [{ src: 'nope', pct: 1 }];
  assert.ok(validateMod(mod).errors.some((e) => e.includes('비례 출처')));
  assert.ok(MONSTER_MAP.slime);
});
