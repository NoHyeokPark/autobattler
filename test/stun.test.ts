// 기절: 기절 중에는 쿨다운(남은 대기 시간)도 멈추고, 준비가 끝난 유닛도 행동하지 않는다
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import type { MonsterDef, Trigger } from '../src/data/types.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });
const unit = (id: string, intervalTicks: number, triggers: Trigger[]): MonsterDef => ({ id, name: id, grade: 1, tags: [], hp: 5000, atk: 1, intervalTicks, desc: '', triggers });
const actTimes = (r: BattleResult, uid: string) => r.events.filter((e) => e.type === 'act' && e.src === uid).map((e) => e.t);

function run(defs: MonsterDef[], mine: BoardEntry[], foe: BoardEntry[], trinket?: Trigger[]): BattleResult {
  const mod = snapshotMod('stun');
  mod.monsters.push(...defs);
  if (trinket) mod.trinkets.push({ id: 't_stun', name: '기절 장신구', grade: 1, desc: '', triggers: trinket });
  applyMod(mod);
  try {
    return simulateBattle({ player: team(mine, trinket ? ['t_stun'] : []), enemy: team(foe), env: 'normal', day: 1, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

test('쿨다운이 긴 유닛: 기절한 만큼 다음 행동이 그대로 늦어진다 (쿨다운이 기절 중에 흐르지 않음)', () => {
  const slow = unit('slow', 100, [{ on: 'act', effects: [{ type: 'damage', flat: 1 }] }]); // 10초
  const free = run([slow], [mon(5, 'guardian')], [mon(5, 'slow')]);
  // 2초에 2초 동안 기절
  const stunned = run([slow], [mon(5, 'guardian')], [mon(5, 'slow')], [{ on: 'timer', atSec: 2, effects: [{ type: 'stun', target: { side: 'enemy', area: 'all' }, ticks: 20 }] }]);
  const a = actTimes(free, '1-5');
  const b = actTimes(stunned, '1-5');
  assert.ok(a.length >= 2);
  assert.equal(b[0], a[0] + 20); // 첫 행동이 정확히 기절 시간만큼 늦어짐
  assert.equal(b[1] - b[0], a[1] - a[0]); // 그 뒤 간격은 그대로
});

test('준비가 끝난 유닛(대기 0)도 기절 중에는 행동하지 않고, 풀리는 순간 행동한다', () => {
  const ready = unit('ready', 20, [{ on: 'act', effects: [{ type: 'damage', flat: 1 }] }]);
  // 3열(6번 칸)은 대기 0으로 시작 → 원래 0초에 행동. 전투 시작 3초 기절
  const r = run([ready], [mon(5, 'guardian')], [mon(6, 'ready')], [{ on: 'battleStart', effects: [{ type: 'stun', target: { side: 'enemy', area: 'all' }, ticks: 30 }] }]);
  assert.equal(actTimes(r, '1-6')[0], 30);
});

test('같은 tick에 먼저 행동한 유닛이 건 기절도 차례를 막는다', () => {
  // 둘 다 3열(대기 0)로 0초에 행동할 차례. 아군(먼저 처리됨)이 상대 같은 칸을 1초 기절
  const stunner = unit('stunner', 20, [{ on: 'act', effects: [{ type: 'stun', target: { side: 'enemy', area: 'near', dirs: ['c'] }, ticks: 10 }] }]);
  const victim = unit('victim', 20, [{ on: 'act', effects: [{ type: 'damage', flat: 1 }] }]);
  const r = run([stunner, victim], [mon(6, 'stunner')], [mon(6, 'victim')]);
  assert.equal(actTimes(r, '0-6')[0], 0);
  assert.equal(actTimes(r, '1-6')[0], 10);
});
