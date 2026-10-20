// 팀 상태 화상(감쇠하는 독)·가시(공격 피해 반사)와, 모드에 빠진 새 기본 항목 가져오기
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { describeStatus } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, importDefaults, missingDefaults, snapshotMod } from '../src/data/registry.ts';
import type { StatusId, TrinketDef } from '../src/data/types.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({
  name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets,
});
const mon = (slot: number, defId: string, level = 1): BoardEntry => ({ slot, kind: 'monster', defId, level });

// 전투 시작 시 팀 상태를 주는 시험용 장신구를 넣은 모드로 실행한다
function withStatusTrinket<T>(status: StatusId, flat: number, to: 'ally' | 'enemy', fn: () => T): T {
  const mod = snapshotMod('status-test');
  const t: TrinketDef = {
    id: 'test_status', name: '시험', grade: 1, desc: '',
    triggers: [{ on: 'battleStart', effects: [{ type: 'status', status, flat, to }] }],
  };
  mod.trinkets.push(t);
  applyMod(mod);
  try {
    return fn();
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

test('화상: 독처럼 매초 피해를 주지만 주기마다 중첩이 1씩 줄어든다', () => {
  const r = withStatusTrinket('burn', 4, 'enemy', () =>
    simulateBattle({ player: team([mon(5, 'guardian')], ['test_status']), enemy: team([mon(5, 'guardian')]), env: 'normal', day: 1, seed: 1 }));
  const ticks = r.events.filter((e) => e.type === 'statusTick' && e.status === 'burn');
  assert.deepEqual(ticks.map((e) => e.amount), [4, 3, 2, 1]);
  assert.deepEqual(ticks.map((e) => e.after), [3, 2, 1, 0]);
  const dmg = r.events.filter((e) => e.type === 'damage' && e.srcName === '화상');
  assert.equal(dmg.reduce((a, e) => a + (e.amount ?? 0), 0), 10);
});

test('가시: 상대 유닛의 피해 효과를 받을 때마다 공격한 쪽에 중첩만큼 피해', () => {
  const r = withStatusTrinket('thorns', 3, 'ally', () =>
    simulateBattle({ player: team([mon(5, 'goblin'), mon(4, 'mushroom')]), enemy: team([mon(5, 'guardian')], ['test_status']), env: 'normal', day: 1, seed: 1 }));
  const hits = r.events.filter((e) => e.type === 'damage' && e.target === 'team1' && e.src.startsWith('0-'));
  const back = r.events.filter((e) => e.type === 'damage' && e.srcName === '가시');
  assert.ok(hits.length > 3);
  // 독 같은 시스템 피해는 반사하지 않는다. 마지막 일격으로 전투가 끝났으면 반사도 없다
  assert.ok(back.length === hits.length || (back.length === hits.length - 1 && r.winner === 0));
  for (const e of back) {
    assert.equal(e.target, 'team0');
    assert.equal(e.amount, 3);
  }
  // 반사 피해는 다시 반사되지 않는다 (아군에게 가시가 없어도 무한 반복 같은 문제가 없는지)
  assert.ok(!r.events.some((e) => e.type === 'damage' && e.target === 'team1' && e.srcName === '가시'));
});

test('팀 상태 설명은 설정값을 따른다', () => {
  assert.match(describeStatus('burn'), /매초 중첩만큼 피해.*중첩 1 감소/);
  assert.match(describeStatus('poison'), /줄지 않음/);
  assert.match(describeStatus('thorns'), /공격한 쪽에 중첩만큼 피해/);
  assert.match(describeStatus('fury', { ...DEFAULT_MOD.balance.statuses.fury, perStack: 2 }), /피해 \+ 중첩 × 2/);
});

test('새 기본 항목 가져오기: 모드에 없는 기본 항목만 찾아 기본 순서 자리에 넣고, 모드의 수정은 유지한다', () => {
  const mod = structuredClone(DEFAULT_MOD);
  const drop = (list: { id: string }[], id: string) => list.splice(list.findIndex((x) => x.id === id), 1);
  drop(mod.trinkets, 'chaos_die');
  drop(mod.trinkets, 'evo_stone');
  drop(mod.monsters, 'mushroom');
  mod.trinkets.find((t) => t.id === 'evo_pebble')!.name = '내가 고친 조약돌';
  mod.trinkets.push({ id: 'my_ring', name: '내 반지', grade: 1, desc: '', triggers: [] });
  mod.tags = mod.tags.filter((t) => t !== '자연');

  const missing = missingDefaults(mod);
  assert.deepEqual(missing.map((m) => `${m.kind}:${m.id}`).sort(), ['monsters:mushroom', 'trinkets:chaos_die', 'trinkets:evo_stone']);

  const tags = importDefaults(mod, missing.filter((m) => m.id !== 'chaos_die'));
  assert.deepEqual(tags, ['자연']); // 독버섯의 태그가 모드에 없어서 함께 추가
  assert.ok(mod.tags.includes('자연'));
  const ids = mod.trinkets.map((t) => t.id);
  assert.equal(ids.indexOf('evo_stone'), ids.indexOf('evo_pebble') + 1); // 기본 데이터의 바로 앞 항목 뒤
  assert.equal(mod.trinkets.find((t) => t.id === 'evo_pebble')!.name, '내가 고친 조약돌');
  assert.ok(ids.includes('my_ring'));
  assert.ok(!ids.includes('chaos_die')); // 고르지 않은 항목은 넣지 않는다
  assert.deepEqual(missingDefaults(mod).map((m) => m.id), ['chaos_die']);
  importDefaults(mod, missingDefaults(mod));
  assert.equal(missingDefaults(mod).length, 0);
});

test('전투 요약: 기본 능력치(영구 강화 포함)와 칸 효과 적용 뒤 시작 능력치를 따로 남긴다', () => {
  const player = team([{ slot: 1, kind: 'monster', defId: 'goblin', level: 1, bonus: { atk: 4 } }, mon(8, 'slime')]);
  const r = simulateBattle({ player, enemy: team([mon(5, 'guardian')]), env: 'normal', day: 1, seed: 1 });
  const gob = r.units.find((u) => u.uid === '0-1')!;
  assert.equal(gob.base.atk, 3 + 4); // 고블린 공격력 3 + 영구 강화 4
  assert.ok(gob.init.atk > gob.base.atk); // 1행: 공격력 보너스 (이번 전투만)
  assert.ok(gob.init.interval < gob.base.interval); // 1열: 행동 간격 배율
  assert.ok(gob.initStun > 0); // 1열: 시작 기절
  const slime = r.units.find((u) => u.uid === '0-8')!;
  assert.equal(slime.init.extra, slime.base.extra + 1); // 3행: 추가발동 +1
  assert.equal(slime.initStun, 0);
});

test('계산된 설명 수치는 전투 엔진이 실제로 내는 값과 같다', async () => {
  const { effectSegs, segsText } = await import('../src/data/describe.ts');
  const { MONSTER_MAP } = await import('../src/data/monsters.ts');
  // 2행(5번 칸): 회복·실드 배율이 칸 효과로 바뀐다 → 설명에도 그 배율을 넣어 계산
  const r = simulateBattle({ player: team([mon(5, 'slime'), mon(4, 'acolyte'), mon(6, 'mushroom')]), enemy: team([mon(5, 'guardian')]), env: 'normal', day: 1, seed: 1 });
  const sum = (uid: string) => r.units.find((u) => u.uid === uid)!.init;
  const total = (uid: string, defId: string, i = 0) => {
    const s = sum(uid);
    const segs = effectSegs(MONSTER_MAP[defId].triggers.find((t) => t.on === 'act')!.effects[i], { atk: s.atk, power: s.power, hp: s.hp, level: 1, healShieldPct: s.healShieldPct });
    return segs.find((x) => typeof x !== 'string') as { total: number };
  };
  const first = (type: string, src: string) => r.events.find((e) => e.type === type && e.src === src)!;
  assert.equal(total('0-5', 'slime').total, first('damage', '0-5').amount);
  // 회복 이벤트는 실제로 찬 양(최대 체력에서 잘림)이라 엔진 계산식과 직접 비교: 내림(내림(공격력×150%)×회복·실드 배율)
  const ac = sum('0-4');
  assert.equal(total('0-4', 'acolyte').total, Math.floor((Math.floor((ac.atk * 150) / 100) * ac.healShieldPct) / 100));
  assert.notEqual(ac.healShieldPct, 100); // 2행 칸 효과가 실제로 들어간 경우를 확인
  const poison = MONSTER_MAP.mushroom.triggers.find((t) => t.on === 'act')!.effects.findIndex((e) => e.type === 'status');
  assert.equal(total('0-6', 'mushroom', poison).total, first('status', '0-6').amount);
  assert.match(segsText(effectSegs({ type: 'damage', atkPct: 100, powerPct: 30, flat: 2 }, { atk: 10, power: 20, hp: 50, level: 1 })), /^18\(2 \+ 공격력 100% \+ 주문력 30%\) 피해$/);
});
