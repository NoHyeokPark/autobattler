// 전투 밖으로 이어지는 능력: 영구 강화(성장형 빌드), 골드·장신구 획득(경제형 빌드)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { BALANCE } from '../src/config/balance.ts';
import { describeEffect } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { TRINKET_MAP } from '../src/data/trinkets.ts';
import { playBattle } from '../src/game/day.ts';
import type { RecordStore } from '../src/game/matching.ts';
import { applyGains, beginDay, chooseReward } from '../src/game/run.ts';
import { createRun } from '../src/game/state.ts';
import type { RunState } from '../src/game/state.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({
  name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets,
});
const mon = (slot: number, defId: string, level = 1): BoardEntry => ({ slot, kind: 'monster', defId, level });
const dummy = team([mon(5, 'guardian')]); // 피해를 주지 않는 상대 → 서든데스까지 길게 간다

function runWith(units: { slot: number; defId: string }[]): RunState {
  const s = createRun('knight', 7, 'gains-test');
  beginDay(s);
  units.forEach((u, i) => (s.board[u.slot - 1] = { uid: 500 + i, defId: u.defId, level: 1 }));
  normalNode(s);
  return s;
}

// 다음 전투까지 진행 (보상은 골드로 받는다)
// 지도 노드의 환경(공격 증가 등)이 수치에 끼지 않게 일반 노드로 고정
function normalNode(s: RunState) {
  s.nodes = [{ kind: 'normal', env: 'normal' }];
  s.nodeIndex = 0;
}
function nextDay(s: RunState) {
  while (s.phase === 'reward') chooseReward(s, 'gold');
  if (s.phase === 'growth') s.phase = 'shop';
  normalNode(s);
}

test('영구 강화는 이번 전투에 바로 적용되고, 전투가 끝나면 유닛에 쌓인다 (패배해도)', () => {
  const s = runWith([{ slot: 1, defId: 'caterpillar' }]);
  const store: RecordStore = { records: [] };
  const b1 = playBattle(s, store);
  const cat = s.board[0]!;
  assert.deepEqual(cat.bonus, { atk: 1 });
  assert.equal(b1.gains?.permanent[0]?.amount, 1);
  // 이번 전투에도 적용: 시작 공격력 = 기본 2 + 1행 보너스 1 + 영구 1
  assert.equal(b1.result.units.find((u) => u.uid === '0-1')!.startAtk, 2 + 1 + 1);
  nextDay(s);
  const b2 = playBattle(s, store);
  assert.deepEqual(s.board[0]!.bonus, { atk: 2 }); // 전투마다 쌓인다
  // 두 번째 전투 시작 공격력 = 기본 2 + 1행 + 지난 강화 1 + 이번 강화 1
  assert.equal(b2.result.units.find((u) => u.uid === '0-1')!.startAtk, 2 + 1 + 1 + 1);
  assert.ok(s.log.every((l) => l.gains?.includes('애벌레')));
});

test('영구 체력 강화는 팀 최대 체력도 바로 늘린다', () => {
  const withTortoise = simulateBattle({ player: team([mon(5, 'guardian'), mon(4, 'tortoise')]), enemy: dummy, env: 'normal', day: 1, seed: 1 });
  // 수호 정령(5번, 2열): 70 × (100 + 5% × 배치 2명) = 77 / 고대 거북(4번, 1열): 90 / 영구 체력 +8
  const guardianHp = Math.trunc((70 * (100 + BALANCE.slot.col2.hpPctPerDeployed * 2)) / 100);
  assert.equal(withTortoise.maxHp[0], guardianHp + 90 + 8);
  assert.deepEqual(withTortoise.gains[0].permanent, [{ slot: 4, stat: 'hp', amount: 8 }]);
});

test('행동할 때마다 주는 골드는 전투당 상한에서 멈춘다', () => {
  const r = simulateBattle({ player: team([mon(1, 'miner'), mon(2, 'miner'), mon(3, 'miner')]), enemy: dummy, env: 'normal', day: 1, seed: 1 });
  const acts = r.units.filter((u) => u.side === 0).reduce((n, u) => n + u.acts, 0);
  assert.ok(acts > BALANCE.battleGains.maxGoldPerBattle);
  assert.equal(r.gains[0].gold, BALANCE.battleGains.maxGoldPerBattle);
  assert.equal(r.events.filter((e) => e.type === 'gain').length, BALANCE.battleGains.maxGoldPerBattle);
});

test('골드·장신구 획득은 전투 후 런에 들어가고, 상대(기록) 쪽 획득은 반영하지 않는다', () => {
  const s = runWith([{ slot: 1, defId: 'peddler' }, { slot: 2, defId: 'treasure' }]);
  const goldBefore = s.gold;
  const b = playBattle(s, { records: [] });
  assert.equal(b.gains?.gold, 1);
  assert.equal(s.gold - goldBefore, 1 + 0); // 보상 단계 전 (전투 보상 골드는 아직)
  assert.equal(b.gains?.trinkets.length, 1);
  assert.equal(TRINKET_MAP[s.trinkets[0]].grade, 1);

  const r = simulateBattle({ player: dummy, enemy: team([mon(1, 'peddler')]), env: 'normal', day: 1, seed: 1 });
  assert.equal(r.gains[1].gold, 1);
  const t = runWith([]);
  const g0 = t.gold;
  applyGains(t, r.gains[0]);
  assert.equal(t.gold, g0);
});

test('리더도 영구 강화가 쌓인다 (백전노장)', () => {
  const s = runWith([]);
  s.growth = ['k_veteran'];
  playBattle(s, { records: [] });
  const leader = s.board.find((u) => u?.leader)!;
  assert.deepEqual(leader.bonus, { atk: 2 });
});

test('팀 상태 이벤트에 상태 종류와 변화 후 중첩 수가 남는다 (감쇠 포함)', () => {
  const r = simulateBattle({ player: team([mon(5, 'mushroom')]), enemy: dummy, env: 'normal', day: 1, seed: 1 });
  const add = r.events.find((e) => e.type === 'status')!;
  assert.equal(add.status, 'poison');
  assert.equal(add.target, 'team1');
  const tick = r.events.find((e) => e.type === 'statusTick')!;
  assert.equal(tick.status, 'poison');
  assert.equal(tick.after, tick.amount); // 독은 감쇠 없음

  const mod = snapshotMod('decay');
  mod.balance.statuses.poison.decay = 'minus1';
  applyMod(mod);
  try {
    const r2 = simulateBattle({ player: team([mon(5, 'mushroom')]), enemy: dummy, env: 'normal', day: 1, seed: 1 });
    const t2 = r2.events.find((e) => e.type === 'statusTick')!;
    assert.equal(t2.after, (t2.amount ?? 0) - 1);
    // 다음 틱의 중첩 = 감쇠 후 값 + 그사이 추가분
    const ticks = r2.events.filter((e) => e.type === 'statusTick' || (e.type === 'status' && e.target === 'team1'));
    let stacks = 0;
    for (const e of ticks) {
      if (e.type === 'status') stacks = e.after!;
      else {
        assert.equal(e.amount, stacks);
        stacks = e.after!;
      }
    }
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('설명 문구', () => {
  assert.equal(describeEffect({ type: 'permanent', target: { side: 'ally', area: 'near', dirs: ['c'] }, stat: 'atk', amount: [1, 2, 3] }), '자신 공격력 영구 +1/2/3');
  assert.equal(describeEffect({ type: 'gold', amount: 2 }), '골드 +2');
  assert.equal(describeEffect({ type: 'trinket', grade: [1, 1, 2] }), '무작위 일반/일반/고급 장신구 1개 획득');
});
