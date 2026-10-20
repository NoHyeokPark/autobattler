// 반응 트리거 (지정한 유닛이 행동할 때마다)와 상대 체력 N% 이하 트리거
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { describeTrigger } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import type { MonsterDef, Trigger } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });
const unit = (id: string, triggers: Trigger[], extra = 0, hp = 400): MonsterDef =>
  ({ id, name: id, grade: 1, tags: [], hp, atk: 0, intervalTicks: 20, extra, desc: '', triggers });

const NEAR: Trigger['watch'] = { side: 'ally', area: 'near', dirs: ['u', 'd', 'l', 'r'] };
const poke: Trigger = { on: 'act', effects: [{ type: 'damage', flat: 1 }] };

function run(defs: MonsterDef[], mine: BoardEntry[], foe: BoardEntry[], opts: { trinket?: Trigger[]; foeTrinket?: boolean } = {}): BattleResult {
  const mod = snapshotMod('react');
  mod.monsters.push(...defs);
  if (opts.trinket) mod.trinkets.push({ id: 't_react', name: '반응 장신구', grade: 1, desc: '', triggers: opts.trinket });
  applyMod(mod);
  try {
    return simulateBattle({ player: team(mine, opts.trinket ? ['t_react'] : []), enemy: team(foe), env: 'normal', day: 1, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}
const acts = (r: BattleResult, uid: string) => r.events.filter((e) => e.type === 'act' && e.src === uid).length;
const reacts = (r: BattleResult, uid: string) => r.events.filter((e) => e.type === 'react' && e.src === uid);

test('반응: 인접 아군이 행동할 때마다 (추가발동도 1번씩), 멀리 있는 아군에는 반응하지 않는다', () => {
  const r = run(
    [unit('actor', [poke], 2), unit('far', [poke]), unit('watcher', [{ on: 'react', watch: NEAR, effects: [{ type: 'damage', flat: 3 }] }])],
    [mon(5, 'watcher'), mon(6, 'actor'), mon(1, 'far')], // 1번 칸은 5번과 대각선 (인접 아님)
    [mon(5, 'guardian')],
  );
  const got = reacts(r, '0-5');
  assert.ok(acts(r, '0-6') >= 3);
  assert.equal(got.length, acts(r, '0-6')); // 추가발동 2 → 한 번 행동에 3번 반응
  assert.ok(got.every((e) => e.target === '0-6'));
  assert.equal(acts(r, '0-5'), r.units.find((u) => u.uid === '0-5')!.acts); // 반응은 행동 횟수에 들어가지 않는다
});

test('반응: N번마다, 최대 횟수', () => {
  const r = run(
    [unit('actor', [poke], 4), unit('watcher', [{ on: 'react', watch: NEAR, every: 3, limit: 2, effects: [{ type: 'damage', flat: 3 }] }])],
    [mon(5, 'watcher'), mon(6, 'actor')],
    [mon(5, 'guardian')],
  );
  assert.ok(acts(r, '0-6') >= 9);
  assert.equal(reacts(r, '0-5').length, 2);
});

test('반응: 상대 행동 견제 + 반응은 다른 반응을 부르지 않는다', () => {
  // 서로를 지켜보는 두 유닛 (반응끼리 이어지면 무한 반복)
  const both: Trigger = { on: 'react', watch: { side: 'ally', area: 'all' }, effects: [{ type: 'damage', flat: 1 }] };
  const r = run(
    [unit('a', [both]), unit('b', [both]), unit('hunter', [{ on: 'react', watch: { side: 'enemy', area: 'all' }, effects: [{ type: 'damage', flat: 2 }] }]), unit('foe_fast', [poke], 3, 3000)],
    [mon(2, 'a'), mon(8, 'b'), mon(5, 'hunter')], // 1열은 시작 기절이 있어 피한다
    [mon(5, 'foe_fast')],
  );
  // a는 b·hunter의 실제 행동에만, b는 a·hunter의 실제 행동에만 반응한다 (서로의 반응에는 반응하지 않음)
  assert.equal(reacts(r, '0-2').length, acts(r, '0-8') + acts(r, '0-5'));
  assert.equal(reacts(r, '0-8').length, acts(r, '0-2') + acts(r, '0-5'));
  assert.equal(reacts(r, '0-5').length, acts(r, '1-5')); // 상대의 모든 행동(추가발동 포함)에 반응
});

test('반응: 기절 중에는 반응하지 않는다', () => {
  // 같은 칸(5번)의 반응 유닛만 기절 (행동하는 유닛은 멀쩡)
  const stunFoe: Trigger = { on: 'battleStart', effects: [{ type: 'stun', target: { side: 'enemy', area: 'near', dirs: ['c'] }, ticks: 9999 }] };
  const r = run(
    [unit('actor', [poke]), unit('watcher', [{ on: 'react', watch: NEAR, effects: [{ type: 'damage', flat: 3 }] }]), unit('stunner', [stunFoe], 0, 3000)],
    [mon(5, 'watcher'), mon(6, 'actor')],
    [mon(5, 'stunner')],
  );
  assert.ok(acts(r, '0-6') > 0);
  assert.equal(reacts(r, '0-5').length, 0);
});

test('반응: 장신구는 보드 중앙 기준', () => {
  const r = run(
    [unit('actor', [poke])],
    [mon(6, 'actor')],
    [mon(5, 'guardian')],
    { trinket: [{ on: 'react', watch: NEAR, effects: [{ type: 'damage', flat: 2 }] }] }, // 6번 = 중앙의 오른쪽
  );
  const got = r.events.filter((e) => e.type === 'react' && e.side === 0);
  assert.equal(got.length, acts(r, '0-6'));
});

test('상대 체력 N% 이하가 될 때 1회', () => {
  const r = run(
    [unit('hitter', [{ on: 'act', effects: [{ type: 'damage', flat: 40 }] }, { on: 'enemyLowHp', hpPct: 50, effects: [{ type: 'gold', amount: 3 }] }])],
    [mon(5, 'hitter')],
    [mon(5, 'guardian')],
  );
  const gains = r.events.filter((e) => e.type === 'gain' && e.side === 0);
  assert.equal(gains.length, 1);
  const before = r.events.filter((e) => e.type === 'damage' && e.target === 'team1' && e.t <= gains[0].t).at(-1)!;
  assert.ok(before.after! * 100 <= 50 * r.maxHp[1]); // 넘어선 바로 그 피해 뒤에 발동
});

test('설명과 검증', () => {
  assert.equal(describeTrigger({ on: 'react', watch: NEAR, every: 3, limit: 5, effects: [] }), '인접 아군 행동 3번마다 (최대 5회): (효과 없음).');
  assert.equal(describeTrigger({ on: 'enemyLowHp', hpPct: 30, effects: [] }), '상대 체력 30% 이하 (1회): (효과 없음).');
  const mod = snapshotMod('react-v');
  mod.monsters.push(unit('bad', [{ on: 'react', effects: [] }]));
  assert.ok(validateMod(mod).errors.some((e) => e.includes('반응할 대상')));
});
