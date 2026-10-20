// 런 지도 (슬레이 더 스파이어식): 지도 모양, 이어진 노드만 고르기, 모닥불(휴식·단련), 이벤트(?), 14일차 라이프 골드, 기한 종료
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import { BALANCE } from '../src/config/balance.ts';
import { Rng } from '../src/core/rng.ts';
import { applyMod, DEFAULT_MOD, parseMod, snapshotMod } from '../src/data/registry.ts';
import { EVENT_GROWTH, findGrowth } from '../src/data/leaders.ts';
import { generateMap, mapOptions, mapText } from '../src/game/map.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { TRINKET_MAP } from '../src/data/trinkets.ts';
import { applyBattle, beginDay, buildRewards, chooseGrowth, chooseReward } from '../src/game/run.ts';
import { giftMonster } from '../src/game/shop.ts';
import type { NodeOption, RunState } from '../src/game/state.ts';
import { createRun, livesLeft } from '../src/game/state.ts';

applyMod(structuredClone(DEFAULT_MOD));
const R = BALANCE.run;
const info = { opponent: 'x', matchStage: 'x', seconds: 1 };
const fresh = (seed = 1): RunState => {
  const s = createRun('knight', seed, `map-${seed}`);
  beginDay(s);
  return s;
};

test('지도: 일차마다 한 줄, 다음 날 옆 갈래로만 이어지고 엇갈리지 않으며, 모든 노드가 1일차에서 닿고 마지막 날까지 이어진다', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const map = generateMap(new Rng(seed));
    const byDay = (d: number) => map.nodes.filter((n) => n.day === d);
    for (let d = 1; d <= R.maxDays; d++) assert.ok(byDay(d).length >= 1, `seed ${seed} D${d}`);
    assert.ok(byDay(1).length >= 2 && byDay(1).length <= 3, '1일차부터 갈림길 (일반 노드라 환경 수까지)');
    for (const n of map.nodes) {
      if (n.day < R.maxDays) assert.ok(n.next.length >= 1, '끊긴 길 없음');
      for (const id of n.next) {
        const m = map.nodes[id];
        assert.equal(m.day, n.day + 1);
        assert.ok(Math.abs(m.lane - n.lane) <= 1);
      }
    }
    // 엇갈림 없음
    for (let d = 1; d < R.maxDays; d++) {
      const es = byDay(d).flatMap((n) => n.next.map((id) => [n.lane, map.nodes[id].lane]));
      for (const [a, b] of es) for (const [c, e] of es) assert.ok(!((a < c && b > e) || (a > c && b < e)), `seed ${seed} D${d} 엇갈림`);
    }
    // 1일차에서 모두 닿는다
    const reach = new Set(byDay(1).map((n) => n.id));
    for (const n of map.nodes) if (reach.has(n.id)) n.next.forEach((id) => reach.add(id));
    assert.equal(reach.size, map.nodes.length);
    // 종류: 1일차 일반, 보스 날 보스 하나 이상(엘리트 없음), 모닥불 날 모닥불 하나, 마지막 날 최종 보스 하나 + 일반
    assert.ok(byDay(1).every((n) => n.kind === 'normal'));
    for (const d of R.bossDays) {
      assert.ok(byDay(d).some((n) => n.kind === 'boss'));
      assert.ok(byDay(d).every((n) => n.kind !== 'elite'), `seed ${seed} D${d} 보스 날에 엘리트`);
    }
    assert.ok(map.nodes.every((n) => n.kind !== 'boss' || R.bossDays.includes(n.day)));
    for (const d of BALANCE.map.campfireDays) assert.equal(byDay(d).filter((n) => n.kind === 'campfire').length, 1);
    assert.equal(byDay(R.finalBossDay).filter((n) => n.kind === 'final').length, 1);
    assert.ok(byDay(R.finalBossDay).every((n) => n.kind === 'final' || n.kind === 'normal'));
    assert.ok(map.nodes.every((n) => n.day >= BALANCE.map.eliteFromDay || n.kind !== 'elite'));
  }
});

test('모닥불: 전날 보스와 이어진 칸이 campfireBossWeight배 잘 뽑힌다 (항상은 아님)', () => {
  const M = BALANCE.map as { campfireBossWeight: number };
  const saved = M.campfireBossWeight;
  const rate = (w: number) => {
    M.campfireBossWeight = w;
    let boss = 0;
    let linked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const map = generateMap(new Rng(seed));
      for (const b of map.nodes.filter((n) => n.kind === 'boss' && BALANCE.map.campfireDays.includes(n.day + 1))) {
        boss++;
        if (b.next.some((id) => map.nodes[id].kind === 'campfire')) linked++;
      }
    }
    return linked / boss;
  };
  try {
    const off = rate(1);
    const on = rate(8);
    assert.ok(off > 0.35 && off < 0.6, `가중치 없음 ${off}`);
    assert.ok(on > off + 0.15, `가중치 8 ${on} > 없음 ${off}`);
    assert.ok(on < 0.95, '항상 이어지지는 않는다');
  } finally {
    M.campfireBossWeight = saved;
  }
});

test('안전 날(map.safeDays, 기본 6일차)로 갈 때는 어느 전날 노드에서든 엘리트·보스가 아닌 선택지가 있다', () => {
  const M = BALANCE.map as { safeDays: number[]; kindWeights: Record<string, number> };
  const saved = { safeDays: M.safeDays, kindWeights: M.kindWeights };
  const check = (seeds: number) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const map = generateMap(new Rng(seed));
      for (const d of M.safeDays) {
        for (const p of map.nodes.filter((n) => n.day === d - 1)) {
          const next = p.next.map((id) => map.nodes[id]);
          assert.ok(next.some((n) => n.kind !== 'elite' && n.kind !== 'boss'), `seed ${seed} D${d - 1} 갈래${p.lane + 1} → 엘리트·보스뿐`);
        }
        if (R.bossDays.includes(d)) assert.ok(map.nodes.some((n) => n.day === d && n.kind === 'boss'), '보스는 그대로 하나 이상');
      }
    }
  };
  try {
    assert.deepEqual(M.safeDays, [6]);
    check(500);
    // 엘리트가 거의 다인 수치에서 모든 보스 날·일반 날을 안전 날로 해도 지켜진다
    M.safeDays = [3, 5, 6, 8, 9, 12];
    M.kindWeights = { normal: 5, elite: 90, event: 5 };
    check(500);
  } finally {
    Object.assign(M, saved);
  }
});

test('같은 시드면 같은 지도, 오늘은 어제 고른 노드와 이어진 노드만', () => {
  const a = fresh(9);
  const b = fresh(9);
  assert.deepEqual(a.map, b.map);
  assert.deepEqual(a.nodes.map((n) => n.mapId), a.map!.nodes.filter((n) => n.day === 1).map((n) => n.id));
  // 1일차 노드 하나를 골라 싸우고 다음 날로
  const pick = a.nodes[a.nodes.length - 1];
  a.nodes = [{ ...pick, kind: 'normal' }];
  a.nodeIndex = 0;
  applyBattle(a, a.nodes[0], true, info);
  while (a.phase === 'reward') a.rewards.length ? (a.rewards = [], beginDay(a)) : beginDay(a);
  assert.deepEqual(a.mapPath, [pick.mapId]);
  const next = a.map!.nodes[pick.mapId!].next;
  assert.deepEqual(a.nodes.map((n) => n.mapId).sort(), [...next].sort());
  assert.match(mapText(a), /\[/);
});

const node = (s: RunState, kind: NodeOption['kind']): NodeOption => ({ kind, env: 'normal', mapId: s.map!.nodes.find((n) => n.day === s.day)!.id });

test('모닥불: 이기든 지든 보상 단계에서 휴식(라이프) 또는 단련(리더 능력치) 중 하나, 진 날은 탈락 판정이 먼저', () => {
  // 마지막 라이프로 모닥불에서 지면 휴식을 고르기 전에 탈락한다 (선지급 없음)
  const dead = fresh(2);
  dead.losses = R.lossLimit - 1;
  applyBattle(dead, node(dead, 'campfire'), false, info);
  assert.equal((dead.end as RunState['end'])?.reason, 'eliminated');
  // 휴식: 라이프 +restLives
  const s = fresh(2);
  applyBattle(s, node(s, 'campfire'), false, info);
  assert.equal(s.phase, 'reward');
  assert.equal(s.rewards.length, 1, '장신구 보상 없음');
  assert.equal(s.rewards[0].kind, 'campfire');
  assert.equal(chooseReward(s, 'gold').ok, false, '골드로 받기 없음');
  const lives = livesLeft(s);
  assert.ok(chooseReward(s, s.rewards[0].options.indexOf('rest')).ok);
  assert.equal(livesLeft(s), lives + BALANCE.campfire.restLives);
  assert.equal(s.day, 2);
  assert.match(s.log[0].gains ?? '', /라이프 +/);
  // 단련: 리더 영구 강화에 더해지고 전투 스냅샷에 들어간다
  const t = fresh(3);
  applyBattle(t, node(t, 'campfire'), true, info);
  for (const stat of ['power', 'power', 'hp'] as const) {
    if (t.phase !== 'reward') {
      t.phase = 'shop';
      applyBattle(t, node(t, 'campfire'), true, info);
    }
    assert.ok(chooseReward(t, t.rewards[0].options.indexOf(stat)).ok);
  }
  const leader = [...t.board, ...t.bench].find((u) => u?.leader)!;
  assert.deepEqual(leader.bonus, { power: 2 * BALANCE.campfire.train.power, hp: BALANCE.campfire.train.hp });
  assert.equal(livesLeft(t), R.lossLimit - t.losses, '단련은 라이프를 주지 않는다');
});

test('이벤트(?): 장신구 보상 대신 이벤트 상황과 선택지, 기본 이벤트 3종(보물·떠돌이 몬스터·낯선 힘)이 나온다', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 60 && seen.size < 3; seed++) {
    const s = fresh(seed);
    applyBattle(s, node(s, 'event'), seed % 2 === 0, info);
    assert.equal(s.phase, 'reward');
    assert.equal(s.rewards.length, 1, '장신구 보상 없음');
    const st = s.rewards[0];
    assert.equal(st.kind, 'event');
    seen.add(st.event!.id);
    if (st.event!.id === 'ev_treasure') {
      const before = s.gold;
      assert.ok(chooseReward(s, 0).ok);
      assert.equal(s.gold - before >= 5 + s.day - 1, true);
    } else if (st.event!.id === 'ev_stray') {
      assert.ok(chooseReward(s, 0).ok);
      const pickStage = s.rewards[0];
      assert.equal(pickStage.kind, 'monster', '몬스터 3마리 중 고르기로 이어진다');
      assert.equal(new Set(pickStage.options.map((id) => MONSTER_MAP[id].grade)).size, 1);
      const pick = pickStage.options[0];
      assert.ok(chooseReward(s, 0).ok);
      assert.ok([...s.board, ...s.bench].some((u) => u?.defId === pick) || /골드로 받았습니다/.test(s.notices?.join(' ') ?? ''), '다음 날 벤치로');
    } else {
      const g = s.growth.length;
      assert.ok(chooseReward(s, 0).ok);
      assert.equal(s.growth.length, g + 1);
      assert.ok(EVENT_GROWTH.some((x) => x.id === s.growth[s.growth.length - 1]));
    }
    assert.match(s.log[0].gains ?? '', /^이벤트 /);
  }
  assert.deepEqual([...seen].sort(), ['ev_strange_power', 'ev_stray', 'ev_treasure']);
  // 벤치가 가득 차면 몬스터 대신 그 가격만큼 골드
  const s = fresh(3);
  s.bench = s.bench.map((_, i) => ({ uid: 900 + i, defId: 'goblin', level: 1 }));
  const before = s.gold;
  assert.match(giftMonster(s, 'slime'), /골드로 받았습니다/);
  assert.ok(s.gold > before);
});

test('장신구 보상: 등급을 먼저 하나 뽑고 그 등급의 서로 다른 장신구를 보여 준다 (보스는 일차별 등급)', () => {
  const grades = new Set<number>();
  for (let seed = 1; seed <= 80; seed++) {
    const s = fresh(seed);
    s.day = 1 + (seed % 13);
    const kind = s.day === 3 || s.day === 6 || s.day === 9 || s.day === 12 ? 'boss' : 'elite';
    const stages = buildRewards(s, { kind, env: 'normal' }, true, new Rng(seed));
    assert.equal(stages.length, 2);
    for (const st of stages) {
      assert.ok(st.options.length >= 1 && st.options.length <= BALANCE.run.rewardChoices);
      assert.equal(new Set(st.options).size, st.options.length, '서로 다른 장신구');
      const g = new Set(st.options.map((id) => TRINKET_MAP[id].grade));
      assert.equal(g.size, 1, `seed ${seed} ${st.label}: 모두 같은 등급`);
      grades.add([...g][0]);
    }
    if (kind === 'boss') assert.equal(TRINKET_MAP[stages[1].options[0]].grade, BALANCE.run.bossRewardGrade[s.day]);
  }
  assert.ok(grades.size >= 3, '여러 등급이 나온다');
});

test('흡혈귀의 피: 리더가 행동할 때마다 공격력 50% + 주문력 50% 회복 (리더 성장으로 찾아진다)', () => {
  assert.ok(findGrowth('knight', 'ev_vampire'));
  const team = (growth: string[]) => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth, board: [{ slot: 5, kind: 'leader' as const, defId: 'knight', level: 1 }], trinkets: [] });
  const r = simulateBattle({ player: team(['ev_vampire']), enemy: team([]), env: 'normal', day: 1, seed: 1 });
  const me = r.units.find((u) => u.side === 0 && u.isLeader)!;
  assert.ok(me.heal > 0);
});

test('리더 성장 선택 중에 생긴 몬스터 성장 선택은 성장을 고른 뒤 이어진다', () => {
  const s = fresh(4);
  s.phase = 'growth';
  s.growthChoices = [s.growthChoices[0] ?? 'command'];
  s.bench = [{ uid: 801, defId: 'slime', level: 1 }, { uid: 802, defId: 'slime', level: 1 }, null, null, null, null];
  giftMonster(s, 'slime'); // 3장 → Lv2 성장 선택이 생긴다
  assert.equal(s.phase, 'growth');
  chooseGrowth(s, 0);
  assert.equal(s.phase, 'unitGrowth');
});

test('14일차가 시작될 때 남은 라이프(마지막 전투용 1개 빼고)를 골드로, 라이프가 남은 채 끝나면 기한 종료', () => {
  const s = fresh(5);
  s.day = R.maxDays - 1;
  s.wins = 8;
  s.losses = 2;
  s.extraLives = 1; // 라이프 = 5 + 1 - 2 = 4 → 3개가 골드로
  const before = s.gold;
  beginDay(s);
  assert.equal(s.day, R.maxDays);
  const income = s.lastIncome.base + s.lastIncome.interest + s.lastIncome.bonus;
  assert.equal(s.gold - before, income + 3 * R.spareLifeGold);
  assert.ok(s.notices?.some((n) => n.includes('골드로 바꿨습니다')));
  s.phase = 'shop';
  applyBattle(s, node(s, 'normal'), true, info); // 9승 = 10승 못 함
  assert.equal(s.end?.reason, 'outOfDays');
});

test('지도 이전 저장(지도 없음)은 다음 날 시작할 때 지도를 만들고 그날 줄 전체를 보여 준다', () => {
  const s = fresh(6);
  delete s.map;
  delete s.mapPath;
  s.phase = 'shop';
  beginDay(s);
  const map = (s as RunState).map;
  assert.ok(map);
  assert.equal(s.nodes.length, map.nodes.filter((n) => n.day === s.day).length);
  assert.deepEqual(mapOptions(s), s.nodes);
});

test('모드: 이벤트 성장이 없는 예전 모드는 기본 목록을 쓴다, 모드에서 바꿀 수 있다', () => {
  const old = snapshotMod('old') as unknown as Record<string, unknown>;
  delete old.eventGrowth;
  const parsed = parseMod(JSON.stringify(old));
  assert.ok(parsed.eventGrowth?.some((g) => g.id === 'ev_vampire'));
  const mod = snapshotMod('custom');
  mod.eventGrowth = [{ id: 'ev_x', name: 'X', desc: '', repeatable: false, stats: { hp: 10 } }];
  applyMod(mod);
  try {
    assert.ok(findGrowth('knight', 'ev_x'));
    assert.equal(findGrowth('knight', 'ev_vampire'), undefined);
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('같은 일차에 종류·환경이 완전히 같은 노드는 없다 (1일차는 환경 수만큼까지만 갈린다), 조합이 모자라게 수치를 바꾸면 겹치게 둔다', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const map = generateMap(new Rng(seed));
    for (let d = 1; d <= R.maxDays; d++) {
      const row = map.nodes.filter((n) => n.day === d);
      const keys = row.map((n) => `${n.kind}:${n.env}`);
      assert.equal(new Set(keys).size, keys.length, `seed ${seed} D${d}: ${keys.join(' ')}`);
    }
    assert.ok(map.nodes.filter((n) => n.day === 1).length <= 3);
  }
  // 환경을 일반 하나만 남기면 1일차는 한 갈래에서 시작하고, 다른 날은 종류로만 갈린다 (모자라면 겹침 허용)
  const mod = snapshotMod('env-one');
  mod.balance.map.envWeights = { normal: 100, hp: 0, atk: 0 };
  applyMod(mod);
  try {
    const map = generateMap(new Rng(3));
    assert.equal(map.nodes.filter((n) => n.day === 1).length, 1);
    assert.ok(map.nodes.every((n) => n.env === 'normal'));
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});
