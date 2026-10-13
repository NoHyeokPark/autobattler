import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleInput, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { clampN, mulDiv } from '../src/core/num.ts';
import { BALANCE } from '../src/config/balance.ts';
import { buildBotTeam } from '../src/game/bot.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({
  name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets,
});
const mon = (slot: number, defId: string, level = 1): BoardEntry => ({ slot, kind: 'monster', defId, level });
const input = (p: TeamSnapshot, e: TeamSnapshot, env: BattleInput['env'] = 'normal'): BattleInput => ({ player: p, enemy: e, env, day: 1, seed: 1 });
const firstAct = (r: ReturnType<typeof simulateBattle>, uid: string) => r.events.find((e) => e.type === 'act' && e.src === uid)?.t;

test('같은 입력이면 항상 같은 결과 (결정적 시뮬레이션)', () => {
  const a = buildBotTeam(7, 11);
  const b = buildBotTeam(7, 22);
  const r1 = simulateBattle({ player: a, enemy: b, env: 'atk', day: 7, seed: 5 });
  const r2 = simulateBattle({ player: a, enemy: b, env: 'atk', day: 7, seed: 5 });
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
});

// 회복·실드가 섞이면 먼저 행동하는 쪽이 오히려 손해일 수 있어(가득 찬 HP에 회복) 피해 전용 팀으로 확인한다.
test('피해만 주는 같은 팀끼리면 플레이어가 이긴다 (동률 플레이어 우선)', () => {
  const t = team([mon(1, 'slime'), mon(3, 'goblin'), mon(5, 'wolf'), mon(7, 'bats'), mon(9, 'ogre')]);
  for (const env of ['normal', 'hp', 'atk'] as const) assert.equal(simulateBattle(input(t, t, env)).winner, 0);
});

test('봇 팀 미러전도 결정적이다', () => {
  const t = buildBotTeam(5, 100);
  const r = simulateBattle({ player: t, enemy: t, env: 'normal', day: 5, seed: 0 });
  assert.equal(JSON.stringify(r), JSON.stringify(simulateBattle({ player: t, enemy: t, env: 'normal', day: 5, seed: 0 })));
});

test('서든데스로 양측이 동시에 쓰러지면 플레이어 승리', () => {
  const t = team([mon(5, 'bard')]); // 음유시인은 피해를 주지 않는다
  const r = simulateBattle(input(t, t));
  assert.equal(r.suddenDeath, true);
  assert.equal(r.winner, 0);
  assert.ok(r.finalHp[0] <= 0 && r.finalHp[1] <= 0);
  assert.ok(r.endTick >= BALANCE.suddenDeath.startSec * BALANCE.ticksPerSec);
});

test('3열은 t=0에 행동, 1열은 3초 기절 후 0.7배 간격으로 첫 행동', () => {
  const t = team([mon(1, 'slime'), mon(2, 'slime'), mon(3, 'slime')]);
  const r = simulateBattle(input(t, team([mon(5, 'guardian')])));
  assert.equal(firstAct(r, '0-3'), 0);
  assert.equal(firstAct(r, '0-2'), 20);
  assert.equal(firstAct(r, '0-1'), 30 + 14);
});

test('3행은 추가발동 +1 (행동 시 2회 연속 처리, 같은 tick)', () => {
  const t = team([mon(8, 'slime')]);
  const r = simulateBattle(input(t, team([mon(5, 'guardian')])));
  const acts = r.events.filter((e) => e.type === 'act' && e.src === '0-8');
  assert.equal(acts[0].t, 30); // 20 × 1.5
  assert.equal(acts[1].t, 30);
  assert.equal(acts[1].note, '추가발동 1');
});

test('같은 tick이면 플레이어 → 슬롯 번호 순으로 처리', () => {
  const p = team([mon(5, 'slime'), mon(2, 'slime')]);
  const e = team([mon(2, 'slime')]);
  const r = simulateBattle(input(p, e));
  const order = r.events.filter((x) => x.type === 'act' && x.t === 20).map((x) => x.src);
  assert.deepEqual(order, ['0-2', '0-5', '1-2']);
});

test('기절은 남은 대기 시간 감소를 멈춘다', () => {
  // 서리 심장: 5초에 상대 전체 4초 기절
  const p = team([mon(5, 'guardian')], ['frost_heart']);
  const e = team([mon(5, 'dragon')]); // 간격 200 → 원래 t=200에 행동
  const r = simulateBattle(input(p, e));
  assert.equal(firstAct(r, '1-5'), 200 + 40);
});

test('HP 0이 되는 순간 즉시 종료하고 남은 큐는 실행하지 않는다', () => {
  const p = team([mon(3, 'dragon', 3)]); // t=0 한방
  const e = team([mon(3, 'slime')]);
  const r = simulateBattle(input(p, e));
  assert.equal(r.endTick, 0);
  assert.equal(r.winner, 0);
  assert.equal(r.events.filter((x) => x.type === 'act' && x.side === 1).length, 0);
});

test('정수 안전 한도에서 잘라낸다', () => {
  const SAFE = BALANCE.engine.safeLimit;
  assert.equal(mulDiv(SAFE, 1_000_000, 1), SAFE);
  assert.equal(clampN(Number.MAX_SAFE_INTEGER), SAFE);
  assert.ok(Number.isSafeInteger(mulDiv(SAFE - 1, 999_999, 1000)));
});
