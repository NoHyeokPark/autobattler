// 지휘자: 전투 시작에 주변 8칸에서 "자기 주변 8칸에 태그가 겹치는 유닛이 없는" 유닛을 행동시키고 수만큼 보상.
// 8명(완벽한 공연)이면 황금 지휘봉 → 다음 날 지휘자를 뺀 보드 전체가 변이
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { TRINKET_MAP } from '../src/data/trinkets.ts';
import type { MonsterDef } from '../src/data/types.ts';
import { applyGains, beginDay } from '../src/game/run.ts';
import { createRun } from '../src/game/state.ts';

const TAGS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
const player = (id: string, tags: string[], intervalTicks = 30): MonsterDef =>
  ({ id, name: id, grade: 1, tags, hp: 300, atk: 3, intervalTicks, desc: '', triggers: [{ on: 'act', effects: [{ type: 'damage', flat: 1 }] }] });
const team = (board: BoardEntry[]): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets: [] });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });
const RING = [1, 2, 3, 4, 6, 7, 8, 9];

function battle(defs: MonsterDef[], ring: string[]): BattleResult {
  const mod = snapshotMod('conductor');
  mod.monsters.push(...defs);
  applyMod(mod);
  try {
    return simulateBattle({ player: team([mon(5, 'conductor'), ...ring.map((id, i) => mon(RING[i], id)).filter((e) => e.defId)]), enemy: team([mon(5, 'guardian')]), env: 'normal', day: 9, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}
const conducted = (r: BattleResult) => r.events.filter((e) => e.type === 'react' && e.src === '0-5' && e.note?.endsWith('지휘')).map((e) => e.target);

test('완벽한 공연: 주변 8명이 모두 다른 태그 → 8명 행동 (1열 시작 기절 무시), 골드 8, 고급 장신구 2, 황금 지휘봉', () => {
  const defs = TAGS.map((t, i) => player(`p${i}`, [t]));
  const r = battle(defs, defs.map((d) => d.id));
  assert.equal(conducted(r).length, 8);
  for (const slot of RING) assert.ok(r.events.some((e) => e.type === 'act' && e.src === `0-${slot}` && e.t === 0), `slot ${slot}`);
  assert.equal(r.gains[0].gold, 8);
  assert.deepEqual(r.gains[0].trinkets, [2, 2]);
  assert.deepEqual(r.gains[0].named, ['golden_baton']);
});

test('같은 태그가 이웃하면 둘 다 빠지고, 태그 없는 유닛도 빠진다', () => {
  const defs = [
    player('a1', ['t1']), player('a2', ['t1']), // 1번·2번 칸: 서로 이웃, 같은 태그 → 둘 다 빠짐
    player('b', ['t2']), player('none', []), // 태그 없음 → 빠짐
    player('c', ['t3']),
  ];
  const r = battle(defs, ['a1', 'a2', 'b', 'none', 'c']); // 1, 2, 3, 4, 6번 칸
  assert.deepEqual(conducted(r).sort(), ['0-3', '0-6']);
  assert.equal(r.gains[0].gold, 2);
  assert.deepEqual(r.gains[0].trinkets, []); // 3명 미만
  assert.equal(r.gains[0].named, undefined);
});

test('지휘로 한 행동은 보너스: 원래 쿨다운은 그대로 돈다', () => {
  const defs = [player('slow', ['t1'], 50)];
  const withConductor = battle(defs, ['', '', '', '', 'slow']); // 6번 칸 (3열: 대기 0으로 시작)
  const acts = withConductor.events.filter((e) => e.type === 'act' && e.src === '0-6').map((e) => e.t);
  assert.deepEqual(acts.slice(0, 2), [0, 0]); // 지휘로 한 번 + 원래 3열 첫 행동
  assert.ok(acts[2] > 0);
});

test('황금 지휘봉: 얻으면 기원 알림, 다음 날 지휘자를 뺀 보드의 몬스터가 모두 변이', () => {
  const s = createRun('knight', 11, 'baton');
  beginDay(s);
  s.board = s.board.map((u) => (u?.leader ? u : null));
  s.board[0] = { uid: 501, defId: 'slime', level: 2 };
  s.board[1] = { uid: 502, defId: 'goblin', level: 1 };
  s.board[2] = { uid: 503, defId: 'conductor', level: 1 };
  applyGains(s, { gold: 0, trinkets: [], permanent: [], named: ['golden_baton'] });
  assert.ok(s.trinkets.includes('golden_baton'));
  assert.ok(s.voices?.some((v) => v.kind === 'origin' && v.defId === 'golden_baton'));
  beginDay(s);
  assert.ok(!s.trinkets.includes('golden_baton'));
  assert.equal(MONSTER_MAP[s.board[0]!.defId].grade, 2);
  assert.equal(s.board[0]!.level, 2); // 레벨 유지
  assert.equal(MONSTER_MAP[s.board[1]!.defId].grade, 2);
  assert.equal(s.board[2]!.defId, 'conductor');
  assert.ok(s.notices?.some((n) => n.includes('황금 지휘봉')));
  assert.equal(TRINKET_MAP.golden_baton.shop, false);
});
