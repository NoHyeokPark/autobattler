// 팀 상태가 낸 피해·회복을 건 유닛에게 나눠 기록한다 (중첩 비율대로)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import type { Effect } from '../src/data/types.ts';
import { otherSources } from '../src/ui/analysis.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });

function run(mine: [string, Effect[]][], foe: BoardEntry[], trinket?: Effect[], tags: Record<string, string[]> = {}): BattleResult {
  const mod = snapshotMod('attr');
  for (const [id, act] of mine) mod.monsters.push({ id, name: id, grade: 1, tags: tags[id] ?? [], hp: 400, atk: 0, intervalTicks: 20, desc: '', triggers: [{ on: 'act', effects: act }] });
  if (trinket) mod.trinkets.push({ id: 't_attr', name: '시험 장신구', grade: 1, desc: '', triggers: [{ on: 'battleStart', effects: trinket }] });
  applyMod(mod);
  try {
    return simulateBattle({ player: team(mine.map(([id], i) => mon(4 + i, id)), trinket ? ['t_attr'] : []), enemy: team(foe), env: 'normal', day: 1, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}
const unit = (r: BattleResult, uid: string) => r.units.find((u) => u.uid === uid)!;
const sumDamageEvents = (r: BattleResult, side: 0 | 1) => r.events.filter((e) => e.type === 'damage' && e.target === `team${1 - side}`).reduce((s, e) => s + (e.amount ?? 0), 0);

test('독 피해는 독을 건 유닛들에게 중첩 비율대로 나뉘고, 합계는 그대로', () => {
  const r = run([
    ['big', [{ type: 'status', status: 'poison', flat: 3, to: 'enemy' }]],
    ['small', [{ type: 'status', status: 'poison', flat: 1, to: 'enemy' }]],
  ], [mon(5, 'guardian')], [{ type: 'status', status: 'poison', flat: 4, to: 'enemy' }]);
  const big = unit(r, '0-4');
  const small = unit(r, '0-5');
  assert.ok(big.statusDamage > 0 && small.statusDamage > 0);
  assert.equal(big.damage, big.statusDamage); // 직접 공격은 없다
  assert.ok(big.statusDamage > small.statusDamage * 1.5); // 3중첩씩 건 쪽이 1중첩씩 건 쪽보다 훨씬 많이 (칸 효과로 행동 속도가 달라 정확히 3:1은 아님)
  const trinkets = otherSources(r).find((o) => o.side === 0 && o.label === '<장신구>');
  assert.ok(trinkets && trinkets.damage > 0); // 장신구가 건 몫은 장신구 한 줄로
  // 나눠도 합은 실제 피해 이벤트 합과 같다
  const credited = r.units.filter((u) => u.side === 0).reduce((s, u) => s + u.damage, 0) + otherSources(r).filter((o) => o.side === 0).reduce((s, o) => s + o.damage, 0);
  assert.equal(credited, sumDamageEvents(r, 0));
  assert.ok(!otherSources(r).some((o) => o.label.includes('이 건'))); // 출처를 모르는 상태 피해가 없다
});

test('가시 반사 피해는 가시를 건 유닛, 재생 회복은 재생을 건 유닛', () => {
  const r = run([
    ['thorny', [{ type: 'status', status: 'thorns', flat: 2, to: 'ally' }]],
    ['healer', [{ type: 'status', status: 'regen', flat: 5, to: 'ally' }]],
  ], [mon(5, 'goblin'), mon(6, 'goblin')]);
  assert.ok(unit(r, '0-4').statusDamage > 0); // 가시
  assert.equal(unit(r, '0-5').statusDamage, 0);
  assert.ok(unit(r, '0-5').statusHeal > 0); // 재생
  assert.equal(unit(r, '0-5').heal, unit(r, '0-5').statusHeal);
});

const sumShieldEvents = (r: BattleResult, side: 0 | 1) => r.events.filter((e) => e.type === 'shield' && e.side === side).reduce((s, e) => s + (e.amount ?? 0), 0);
const conserved = (r: BattleResult) => {
  const units = r.units.filter((u) => u.side === 0);
  const others = otherSources(r).filter((o) => o.side === 0);
  assert.equal(units.reduce((s, u) => s + u.damage, 0) + others.reduce((s, o) => s + o.damage, 0), sumDamageEvents(r, 0));
  assert.equal(units.reduce((s, u) => s + u.shield, 0) + others.reduce((s, o) => s + o.shield, 0), sumShieldEvents(r, 0));
};

test('강화 상태가 공격에 더한 피해는 강화를 건 유닛 몫', () => {
  const r = run([
    ['bard', [{ type: 'status', status: 'fury', flat: 2, to: 'ally' }]],
    ['hitter', [{ type: 'damage', flat: 10 }]],
  ], [mon(5, 'guardian')]);
  const bard = unit(r, '0-4');
  const hitter = unit(r, '0-5');
  assert.ok(bard.buffDamage > 0);
  assert.equal(bard.damage, bard.buffDamage); // 직접 공격은 없다
  assert.equal(hitter.buffDamage, 0);
  // 때린 유닛에게는 고정 10씩만 남는다
  const hits = r.events.filter((e) => e.type === 'damage' && e.src === '0-5').length;
  assert.equal(hitter.damage, hits * 10);
  conserved(r);
});

test('다른 아군이 올려 준 공격력 몫은 버프를 건 유닛, 자기 버프는 본인 몫', () => {
  const r = run([
    ['buffer', [{ type: 'atkFlat', amount: 10, target: { side: 'ally', area: 'all', excludeSelf: true } }]],
    ['striker', [{ type: 'atkFlat', amount: 10, target: { side: 'ally', area: 'all', tag: 'self_only' } }, { type: 'shield', atkPct: 100 }, { type: 'damage', atkPct: 100 }]],
  ], [mon(5, 'guardian')], undefined, { striker: ['self_only'] });
  const buffer = unit(r, '0-4');
  const striker = unit(r, '0-5');
  assert.ok(buffer.buffDamage > 0 && buffer.buffShield > 0);
  assert.equal(buffer.damage, buffer.buffDamage); // 버퍼는 직접 공격하지 않는다
  assert.ok(striker.damage > 0); // 스스로 올린 공격력 몫
  assert.equal(striker.buffDamage, 0);
  conserved(r);
});

test('영구 강화로 오른 공격력은 받은 유닛 몫', () => {
  const r = run([
    ['coach', [{ type: 'permanent', stat: 'atk', amount: 10, target: { side: 'ally', area: 'all', excludeSelf: true } }]],
    ['pupil', [{ type: 'damage', atkPct: 100 }]],
  ], [mon(5, 'guardian')]);
  assert.equal(unit(r, '0-4').damage, 0);
  assert.equal(unit(r, '0-4').buffDamage, 0);
  conserved(r);
});
