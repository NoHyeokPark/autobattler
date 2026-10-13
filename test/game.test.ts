import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/config/balance.ts';
import { findOpponent, makeRecord } from '../src/game/matching.ts';
import type { RecordStore } from '../src/game/matching.ts';
import { applyBattle, beginDay, chooseExtend, chooseReward } from '../src/game/run.ts';
import { buy, move } from '../src/game/shop.ts';
import { createRun, deployedCount } from '../src/game/state.ts';
import { Rng } from '../src/core/rng.ts';

const fresh = () => {
  const s = createRun('knight', 1, 'test-run');
  beginDay(s);
  return s;
};

test('같은 몬스터 3장을 사면 Lv2로 합성된다', () => {
  const s = fresh();
  s.gold = 10;
  s.shop = [1, 2, 3].map(() => ({ kind: 'monster' as const, defId: 'slime' }));
  for (let i = 0; i < 3; i++) assert.ok(buy(s, i).ok);
  const slimes = [...s.board, ...s.bench].filter((u) => u?.defId === 'slime');
  assert.equal(slimes.length, 1);
  assert.equal(slimes[0]!.level, 2);
});

test('벤치가 가득 차도 바로 합성되면 살 수 있다', () => {
  const s = fresh();
  s.gold = 20;
  s.bench = s.bench.map((_, i) => ({ uid: 100 + i, defId: i < 2 ? 'slime' : 'goblin', level: 1 }));
  s.bench[5] = { uid: 200, defId: 'wolf', level: 1 };
  s.shop = [{ kind: 'monster', defId: 'slime' }];
  assert.ok(buy(s, 0).ok);
  assert.equal(s.bench.filter((u) => u?.defId === 'slime' && u.level === 2).length, 1);
});

test('배치 인원 제한(리더 포함 6)을 넘길 수 없다', () => {
  const s = fresh();
  s.bench = s.bench.map((_, i) => ({ uid: 100 + i, defId: 'goblin', level: 1 }));
  const slots = [0, 1, 2, 3, 5];
  slots.forEach((slot, i) => assert.ok(move(s, { area: 'bench', index: i }, { area: 'board', index: slot }).ok));
  assert.equal(deployedCount(s), 6);
  assert.equal(move(s, { area: 'bench', index: 5 }, { area: 'board', index: 6 }).ok, false);
  // 보드↔벤치 교체는 인원이 그대로라 허용
  assert.ok(move(s, { area: 'bench', index: 5 }, { area: 'board', index: 0 }).ok);
});

test('리더 레벨업은 4·7·10·13일차, 성장 선택지가 나온다', () => {
  const s = fresh();
  for (let d = 2; d <= 4; d++) {
    s.phase = 'shop';
    beginDay(s);
  }
  assert.equal(s.day, 4);
  assert.equal(s.leaderLevel, 2);
  assert.equal(s.phase, 'growth');
  assert.equal(s.growthChoices.length, BALANCE.leader.growthChoices);
});

test('이자: 보유 골드 10원마다 +1, 최대 5', () => {
  const s = fresh();
  s.gold = 37;
  beginDay(s);
  assert.equal(s.lastIncome.interest, 3);
  s.gold = 200;
  beginDay(s);
  assert.equal(s.lastIncome.interest, 5);
});

test('5패면 탈락, 점수 = 승수 - 5', () => {
  const s = fresh();
  s.wins = 3;
  s.losses = 4;
  applyBattle(s, s.nodes[0], false, { opponent: 'x', matchStage: 'x', seconds: 1 });
  assert.equal(s.phase, 'ended');
  assert.deepEqual(s.end, { reason: 'eliminated', score: -2 });
});

test('14일차 전 10승이면 보상 후 연장 선택, 연장 1패면 +4로 끝', () => {
  const s = fresh();
  s.day = 11;
  s.wins = 9;
  applyBattle(s, s.nodes[0], true, { opponent: 'x', matchStage: 'x', seconds: 1 });
  assert.equal(s.phase, 'reward');
  while (s.phase === 'reward') chooseReward(s, 'gold');
  assert.equal(s.phase, 'extendChoice');
  chooseExtend(s, true);
  assert.equal(s.extension.active, true);
  assert.equal(s.nodes.length, 2); // 연장 중 엘리트·보스 없음
  applyBattle(s, s.nodes[0], false, { opponent: 'x', matchStage: 'x', seconds: 1 });
  assert.deepEqual(s.end, { reason: 'extensionLost', score: BALANCE.rank.extensionLossScore });
});

test('노드: 보스 일차에는 보스, 9승이면 2개, 14일차는 최종 보스', () => {
  const s = fresh();
  s.day = 2;
  beginDay(s); // 3일차
  assert.deepEqual(s.nodes.map((n) => n.kind), ['normal', 'env', 'boss']);
  s.wins = 9;
  beginDay(s);
  assert.deepEqual(s.nodes.map((n) => n.kind), ['normal', 'env']);
  s.day = 13;
  s.phase = 'shop';
  beginDay(s);
  assert.deepEqual(s.nodes.map((n) => n.kind), ['normal', 'env', 'final']);
});

test('매칭: 같은 일차·같은 환경 → 일반 환경 → 시드 봇', () => {
  const store: RecordStore = { records: [] };
  const me = fresh();
  const other = createRun('saint', 2, 'other-run');
  beginDay(other);
  const rng = new Rng(1);
  const hpNode = { kind: 'env' as const, env: 'hp' as const };

  assert.equal(findOpponent(store, me, hpNode, rng).stage, '시드 봇');
  store.records.push(makeRecord(other, { kind: 'normal', env: 'normal' }, 'B'));
  assert.equal(findOpponent(store, me, hpNode, rng).stage, '같은 일차·일반 환경');
  store.records.push(makeRecord(other, hpNode, 'B'));
  store.records[1].id = 'other-hp';
  assert.equal(findOpponent(store, me, hpNode, rng).stage, '같은 일차·같은 환경');
  // 내 기록은 상대로 뽑히지 않는다
  store.records.length = 0;
  store.records.push(makeRecord(me, hpNode, 'me'));
  assert.equal(findOpponent(store, me, hpNode, rng).stage, '시드 봇');
});
