// 가속: 행동 간격 = 기본 × 100 / (100 + 가속). 합산이라 겹쳐도 0으로 수렴하지 않는다
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { computeUnit } from '../src/data/growth.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { applyMod, DEFAULT_MOD, parseMod, snapshotMod } from '../src/data/registry.ts';
import { T } from '../src/data/targets.ts';
import { hasteFromIntervalPct, hasteInterval } from '../src/data/types.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });

test('가속 공식: +50 두 번 = +100 → 간격 절반 (곱하기였다면 1/4)', () => {
  assert.equal(hasteInterval(20, 0), 20);
  assert.equal(hasteInterval(20, 50), 13);
  assert.equal(hasteInterval(20, 100), 10);
  assert.equal(hasteInterval(20, 300), 5);
  assert.equal(hasteInterval(20, -50), 40); // 감속
  assert.equal(hasteInterval(20, -95), 100); // 100 + 가속은 20 아래로 안 내려감 (최대 5배)
  assert.equal(hasteFromIntervalPct(-15), 18);
  assert.equal(hasteFromIntervalPct(40), -29);
});

test('성장 가속은 합산된다', () => {
  const g = { id: 'g', name: 'g', desc: '', repeatable: true, stats: { haste: 50 } };
  assert.equal(computeUnit(MONSTER_MAP.slime, 100, [g, g]).haste, 100);
  // 옛 저장 데이터의 행동 간격 %도 가속으로 읽는다
  assert.equal(computeUnit(MONSTER_MAP.slime, 100, [], { intervalPct: -15 }).haste, 18);
});

test('전투 중 가속 효과도 합산: 전투 시작 +50 장신구 2개 → 간격 절반', () => {
  const mod = snapshotMod('haste-test');
  mod.trinkets.push({ id: 'test_haste', name: '시험', grade: 1, desc: '', triggers: [{ on: 'battleStart', effects: [{ type: 'haste', target: T.allies(), amount: 50 }] }] });
  applyMod(mod);
  try {
    // 5번 칸(2행 2열)은 행동 간격 칸 효과가 없다
    const r = simulateBattle({ player: team([{ slot: 5, kind: 'monster', defId: 'slime', level: 1 }], ['test_haste', 'test_haste']), enemy: team([{ slot: 5, kind: 'monster', defId: 'guardian', level: 1 }]), env: 'normal', day: 1, seed: 1 });
    const u = r.units.find((x) => x.uid === '0-5')!;
    assert.equal(u.interval, hasteInterval(MONSTER_MAP.slime.intervalTicks, 100));
    const last = r.events.filter((e) => e.type === 'buff' && e.stat === 'interval' && e.target === '0-5').at(-1)!;
    assert.equal(last.haste, 100);
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('예전 모드: 행동 간격 %는 불러올 때 같은 결과의 가속으로 바뀐다 (효과·성장·영구 강화·설명)', () => {
  const old = structuredClone(DEFAULT_MOD) as unknown as Record<string, any>;
  const wolf = old.monsters.find((m: any) => m.id === 'wolf');
  wolf.triggers[0].effects[0] = { type: 'intervalPct', target: T.adjacent('야수'), pct: [-10, -15, -25] };
  old.unitGrowth[0] = { id: 'u_old', name: '옛 성장', desc: '행동 간격 -15%', repeatable: true, stats: { intervalPct: -15, atk: 1 } };
  old.trinkets.push({ id: 'old_perm', name: '옛', grade: 1, desc: '', triggers: [{ on: 'battleStart', effects: [{ type: 'permanent', target: T.allies(), stat: 'intervalPct', amount: -10 }] }] });
  const mod = parseMod(JSON.stringify(old));
  assert.deepEqual(mod.monsters.find((m) => m.id === 'wolf')!.triggers[0].effects[0], { type: 'haste', target: T.adjacent('야수'), amount: [11, 18, 33] });
  const g = mod.unitGrowth[0];
  assert.deepEqual(g.stats, { haste: 18, atk: 1 });
  assert.equal(g.desc, '가속 +18');
  assert.deepEqual(mod.trinkets.find((t) => t.id === 'old_perm')!.triggers[0].effects[0], { type: 'permanent', target: T.allies(), stat: 'haste', amount: 11 });
  assert.ok(!JSON.stringify(mod).includes('intervalPct'));
});
