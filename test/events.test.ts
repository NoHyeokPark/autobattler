// 데이터 이벤트(지도의 ? 노드): 등장 일차, 선택지 비용·라이프 조건, 결과(장신구·몬스터·성장·골드·라이프·리더 능력치), 예전 모드 변환, 검증
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/config/balance.ts';
import { Rng } from '../src/core/rng.ts';
import { applyMod, DEFAULT_MOD, parseMod, snapshotMod } from '../src/data/registry.ts';
import { TRINKET_MAP } from '../src/data/trinkets.ts';
import type { EventDef } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';
import { choiceBlock, eventCandidates, pickEventStage } from '../src/game/events.ts';
import { applyBattle, beginDay, chooseReward } from '../src/game/run.ts';
import type { NodeOption, RunState } from '../src/game/state.ts';
import { createRun, livesLeft } from '../src/game/state.ts';

const info = { opponent: 'x', matchStage: 'x', seconds: 1 };

// 이 이벤트들만 있는 모드로 실행
function withEvents<T>(events: EventDef[], fn: () => T): T {
  const mod = snapshotMod('event-test');
  mod.events = events;
  applyMod(mod);
  try {
    return fn();
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}
const fresh = (seed = 1): RunState => {
  const s = createRun('knight', seed, `ev-${seed}`);
  beginDay(s);
  return s;
};
const eventNode = (s: RunState): NodeOption => ({ kind: 'event', env: 'normal', mapId: s.map!.nodes.find((n) => n.day === s.day)!.id });
const ev = (id: string, rest: Partial<EventDef>): EventDef => ({ id, name: id, text: '상황', choices: [{ text: '지나간다', outcomes: [] }], ...rest });

test('등장 일차 구간과 비율: 구간 밖이거나 비율 0이면 나오지 않는다', () => {
  withEvents([ev('early', { maxDay: 3 }), ev('late', { minDay: 5 }), ev('never', { weight: 0 })], () => {
    const s = fresh();
    s.day = 2;
    assert.deepEqual(eventCandidates(s).map((e) => e.id), ['early']);
    s.day = 7;
    assert.deepEqual(eventCandidates(s).map((e) => e.id), ['late']);
    s.day = 4;
    assert.equal(pickEventStage(s, new Rng(1)), null, '나올 이벤트가 없으면 보상 없이 넘어간다');
    applyBattle(s, eventNode(s), true, info);
    assert.notEqual(s.phase, 'reward');
  });
});

test('골드 비용: 모자라면 고를 수 없고, 고르면 낸다. 고를 수 있는 선택지가 없으면 그 이벤트는 나오지 않는다', () => {
  const shop: EventDef = ev('shop', { choices: [{ text: '산다', cost: 10, outcomes: [{ type: 'leaderStat', stat: 'atk', amount: 3 }] }] });
  withEvents([shop], () => {
    const s = fresh();
    s.gold = 5;
    assert.match(choiceBlock(s, shop.choices[0]) ?? '', /골드 10/);
    assert.equal(eventCandidates(s).length, 0);
    s.gold = 12;
    applyBattle(s, eventNode(s), true, info);
    assert.equal(s.rewards[0].kind, 'event');
    assert.ok(chooseReward(s, 0).ok);
    assert.equal(s.gold >= 2, true);
    const leader = [...s.board, ...s.bench].find((u) => u?.leader)!;
    assert.equal(leader.bonus?.atk, 3);
    assert.match(s.log[0].gains ?? '', /골드 -10.*리더 공격력 \+3/);
  });
});

test('라이프: 라이프가 0이 되는 선택지는 고를 수 없고, 얻는 라이프는 바로 늘어난다', () => {
  const deal: EventDef = ev('deal', {
    choices: [
      { text: '피를 바친다', outcomes: [{ type: 'life', amount: -1 }, { type: 'trinket', id: Object.keys(TRINKET_MAP)[0] }] },
      { text: '축복을 받는다', outcomes: [{ type: 'life', amount: 2 }] },
    ],
  });
  withEvents([deal], () => {
    const s = fresh();
    s.losses = BALANCE.run.lossLimit - 1; // 라이프 1
    assert.match(choiceBlock(s, deal.choices[0]) ?? '', /라이프/);
    applyBattle(s, eventNode(s), true, info);
    assert.equal(chooseReward(s, 0).ok, false);
    assert.ok(chooseReward(s, 1).ok);
    assert.equal(livesLeft(s), 3);
  });
});

test('장신구·몬스터: 지정하면 그것, 등급에서 N개 중 고르기면 같은 등급 선택 단계가 이어진다 (안 고르면 골드)', () => {
  const fixed = Object.values(TRINKET_MAP).find((t) => t.grade === 2)!.id;
  const gift: EventDef = ev('gift', {
    choices: [{ text: '받는다', outcomes: [{ type: 'trinket', id: fixed }, { type: 'trinket', grade: 3, choices: 3 }, { type: 'monster', grade: 1, choices: 2 }] }],
  });
  withEvents([gift], () => {
    const s = fresh();
    applyBattle(s, eventNode(s), true, info);
    assert.ok(chooseReward(s, 0).ok);
    assert.ok(s.trinkets.includes(fixed), '지정 장신구는 바로');
    assert.equal(s.rewards.length, 2, '고르기 두 단계가 이어진다');
    const [tr, mo] = s.rewards;
    assert.equal(tr.options.length, 3);
    assert.ok(tr.options.every((id) => TRINKET_MAP[id].grade === 3));
    assert.equal(mo.kind, 'monster');
    assert.equal(mo.options.length, 2);
    assert.ok(chooseReward(s, 1).ok);
    assert.ok(s.trinkets.includes(tr.options[1]));
    assert.ok(chooseReward(s, 'gold').ok, '몬스터는 골드로 받을 수 있다');
    assert.notEqual(s.phase, 'reward');
  });
});

test('성장: 이미 가진 반복 불가 성장을 주는 선택지가 있으면 그 이벤트는 나오지 않는다', () => {
  const blood: EventDef = ev('blood', { choices: [{ text: '마신다', outcomes: [{ type: 'growth', id: 'ev_vampire' }] }, { text: '거절', outcomes: [] }] });
  withEvents([blood], () => {
    const s = fresh();
    assert.equal(eventCandidates(s).length, 1);
    s.growth.push('ev_vampire');
    assert.equal(eventCandidates(s).length, 0);
  });
});

test('예전 모드: 이벤트 데이터가 없으면 기본 이벤트에 예전 비율·골드 수치를 옮기고 balance.events는 지운다', () => {
  const old = structuredClone(DEFAULT_MOD) as unknown as Record<string, unknown>;
  delete old.events;
  (old.balance as Record<string, unknown>).events = { weights: { gold: 10, monster: 0, growth: 5 }, goldBase: 3, goldPerDay: 2 };
  const mod = parseMod(JSON.stringify(old));
  const byId = Object.fromEntries((mod.events ?? []).map((e) => [e.id, e]));
  assert.equal(byId.ev_treasure.weight, 10);
  assert.equal(byId.ev_stray.weight, 0);
  assert.equal(byId.ev_strange_power.weight, 5);
  assert.deepEqual(byId.ev_treasure.choices[0].outcomes[0], { type: 'gold', amount: 3, perDay: 2 });
  assert.equal('events' in (mod.balance as unknown as Record<string, unknown>), false);
  // 모닥불 수치는 기본값이 채워진다
  assert.deepEqual(mod.balance.campfire, DEFAULT_MOD.balance.campfire);
});

test('검증: 없는 장신구·성장, 잘못된 등급, 빈 선택지, 거꾸로 된 일차 구간', () => {
  const mod = structuredClone(DEFAULT_MOD);
  mod.events = [
    ev('a', { minDay: 5, maxDay: 2, choices: [] }),
    ev('b', { choices: [{ text: 'x', outcomes: [{ type: 'trinket', id: 'nope' }, { type: 'monster', grade: 9 }, { type: 'growth', id: 'nope' }] }] }),
  ];
  const { errors } = validateMod(mod);
  for (const part of ['선택지가 없습니다', '등장 일차 구간', '없는 장신구', '등급은 1~', '리더 이벤트 성장에 없는']) {
    assert.ok(errors.some((e) => e.includes(part)), part);
  }
  assert.equal(validateMod(structuredClone(DEFAULT_MOD)).errors.length, 0, '기본 이벤트는 올바르다');
});
