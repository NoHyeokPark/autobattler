// 체력 소모(자해)와 "보스·엘리트전에서만" 능력
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleInput, BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { describeTrigger } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import type { MonsterDef, Trigger } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';

const team = (board: BoardEntry[]): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets: [] });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });
const unit = (id: string, triggers: Trigger[], hp = 200): MonsterDef => ({ id, name: id, grade: 1, tags: [], hp, atk: 5, intervalTicks: 20, desc: '', triggers });

function run(defs: MonsterDef[], mine: BoardEntry[], foe: BoardEntry[], node?: BattleInput['node']): BattleResult {
  const mod = snapshotMod('hpcost');
  mod.monsters.push(...defs);
  applyMod(mod);
  try {
    return simulateBattle({ player: team(mine), enemy: team(foe), env: 'normal', day: 3, seed: 1, node });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

test('체력 소모: 아군 체력을 깎고, 소모한 체력에 비례한 효과 (누구의 피해로도 기록하지 않음)', () => {
  const blood = unit('blood', [{ on: 'act', effects: [{ type: 'hpCost', pct: 10, effects: [{ type: 'damage', scales: [{ src: 'paidHp', pct: 200 }] }] }] }]);
  const r = run([blood], [mon(5, 'blood')], [mon(5, 'guardian')]);
  const costs = r.events.filter((e) => e.type === 'hpCost');
  assert.ok(costs.length > 0);
  // 소모 바로 다음 피해 = 소모한 체력의 200%
  for (const c of costs.slice(0, 3)) {
    const next = r.events.find((e) => e.t === c.t && e.type === 'damage' && e.src === '0-5' && r.events.indexOf(e) > r.events.indexOf(c))!;
    assert.equal(next.amount, c.amount! * 2);
  }
  const me = r.units.find((u) => u.uid === '0-5')!;
  assert.equal(me.damage, costs.reduce((s, c) => s + c.amount! * 2, 0)); // 자해는 피해 기록에 안 들어감
});

test('체력 소모: 체력은 1 아래로 내려가지 않고, "아군 체력 N% 이하" 능력이 발동한다', () => {
  const blood = unit('blood', [
    { on: 'act', effects: [{ type: 'hpCost', pct: 60, effects: [] }] },
    { on: 'lowHp', hpPct: 30, effects: [{ type: 'gold', amount: 1 }] },
  ], 100);
  const r = run([blood], [mon(5, 'blood')], [mon(5, 'guardian')]);
  assert.ok(r.events.filter((e) => e.type === 'hpCost').every((e) => e.after! >= 1));
  assert.equal(r.gains[0].gold, 1); // 자해로 30% 아래 → 1회 발동
});

test('보스·엘리트전에서만: 그 노드의 전투에만 능력이 있다 (보스 = 최종 보스 포함)', () => {
  const hunter = unit('hunter', [
    { on: 'battleStart', onlyIn: ['boss'], effects: [{ type: 'gold', amount: 3 }] },
    { on: 'battleStart', onlyIn: ['elite'], effects: [{ type: 'gold', amount: 1 }] },
  ]);
  const gold = (node?: BattleInput['node']) => run([hunter], [mon(5, 'hunter')], [mon(5, 'guardian')], node).gains[0].gold;
  assert.equal(gold(), 0);
  assert.equal(gold('normal'), 0);
  assert.equal(gold('elite'), 1);
  assert.equal(gold('boss'), 3);
  assert.equal(gold('final'), 3);
  assert.equal(describeTrigger(hunter.triggers[0]), '보스전 · 전투 시작: 골드 +3.');
});

test('검증: 체력 소모 안에 소모 효과는 넣을 수 없다', () => {
  const mod = snapshotMod('hpcost-v');
  mod.monsters.push(unit('bad', [{ on: 'act', effects: [{ type: 'hpCost', pct: 5, effects: [{ type: 'hpCost', pct: 5, effects: [] }] }] }]));
  assert.ok(validateMod(mod).errors.some((e) => e.includes('체력 소모 안에')));
});
