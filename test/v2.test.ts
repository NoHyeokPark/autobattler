// 0.2 변경 사항: 장신구 중첩, 몬스터 성장, 상점 6칸, 일차별 체력, 방향 대상, 주문력
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleInput, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { BALANCE } from '../src/config/balance.ts';
import { Rng } from '../src/core/rng.ts';
import { filterText } from '../src/data/describe.ts';
import { computeUnit, findUnitGrowth, maxGrowthCount, mergeBonus } from '../src/data/growth.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { applyMod, DEFAULT_MOD, parseMod, snapshotMod } from '../src/data/registry.ts';
import { T } from '../src/data/targets.ts';
import { beginDay, buildRewards } from '../src/game/run.ts';
import { buy, chooseUnitGrowth, mergeAll, rollShop } from '../src/game/shop.ts';
import { createRun, shopLevel, toSnapshot } from '../src/game/state.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({
  name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets,
});
const mon = (slot: number, defId: string, level = 1, growth?: string[]): BoardEntry => ({ slot, kind: 'monster', defId, level, ...(growth ? { growth } : {}) });
const input = (p: TeamSnapshot, e: TeamSnapshot, day = 1): BattleInput => ({ player: p, enemy: e, env: 'normal', day, seed: 1 });
const fresh = () => {
  const s = createRun('knight', 1, 'v2');
  beginDay(s);
  return s;
};

// ── 1. 장신구 중복·중첩 ──

test('같은 장신구를 여러 개 가지면 효과가 중첩된다', () => {
  const dummy = team([mon(5, 'guardian')]);
  const one = simulateBattle(input(team([mon(5, 'guardian')], ['rusty_ring']), dummy));
  const three = simulateBattle(input(team([mon(5, 'guardian')], ['rusty_ring', 'rusty_ring', 'rusty_ring']), dummy));
  const shieldAt0 = (r: typeof one) => r.events.filter((e) => e.type === 'shield' && e.t === 0 && e.side === 0).reduce((s, e) => s + (e.amount ?? 0), 0);
  assert.equal(shieldAt0(one), 40);
  assert.equal(shieldAt0(three), 120);
});

test('이미 가진 장신구도 보상·상점에 다시 나오고, 상점 레벨도 중첩된다', () => {
  const s = fresh();
  s.trinkets = ['rusty_ring', 'leather_glove', 'lucky_coin', 'telescope', 'telescope'];
  assert.equal(shopLevel(s), 2);
  // 1일차 보상은 대부분 일반 등급인데 일반 장신구를 다 가졌어도 선택지가 채워진다
  const stage = buildRewards(s, { kind: 'normal', env: 'normal' }, true, new Rng(3))[0];
  assert.equal(stage.options.length, BALANCE.run.rewardChoices);
  assert.equal(new Set(stage.options).size, stage.options.length); // 한 선택지 안에서는 겹치지 않음
});

// ── 2. 몬스터 성장 ──

test('3장 합성으로 레벨업하면 성장 선택 단계가 되고, 고른 성장이 유닛에 붙는다', () => {
  const s = fresh();
  s.gold = 10;
  s.shop = [1, 2, 3].map(() => ({ kind: 'monster' as const, defId: 'slime' }));
  buy(s, 0);
  buy(s, 1);
  buy(s, 2);
  assert.equal(s.phase, 'unitGrowth');
  assert.equal(s.unitGrowth[0].choices.length, BALANCE.unit.growthChoices);
  const pick = s.unitGrowth[0].choices[0];
  assert.ok(chooseUnitGrowth(s, 0).ok);
  assert.equal(s.phase, 'shop');
  const slime = [...s.board, ...s.bench].find((u) => u?.defId === 'slime')!;
  assert.deepEqual(slime.growth, [pick]);
  // 스냅샷(PvP 기록)에도 성장이 들어간다
  s.board[0] = slime;
  s.bench = s.bench.map((u) => (u === slime ? null : u));
  assert.deepEqual(toSnapshot(s, 'x').board.find((e) => e.defId === 'slime')?.growth, [pick]);
});

test('Lv3 합성은 새 선택 없이 Lv2 3장의 성장을 모두 가진다 (반복 불가 중복은 하나만)', () => {
  const s = fresh();
  const lv2 = (uid: number, growth: string[]) => ({ uid, defId: 'slime', level: 2, growth });
  s.board[0] = lv2(101, ['u_might']);
  s.bench[0] = lv2(102, ['u_might', 'u_double']); // 비정상적으로 2개지만 합치기 규칙 확인용
  s.bench[1] = lv2(103, ['u_double']);
  mergeAll(s);
  const lv3 = s.board[0]!;
  assert.equal(lv3.level, 3);
  assert.deepEqual(lv3.growth, ['u_might', 'u_might', 'u_double']); // 근력 강화는 반복 가능 → 중첩, 연속 행동은 반복 불가 → 하나
  assert.equal(s.unitGrowth.length, 0); // Lv3에서는 고르지 않음
  assert.equal(s.bench.filter(Boolean).length, 0);
});

test('Lv2가 되자마자 Lv3으로 연쇄 합성되면 Lv2 선택은 Lv3 유닛에 들어간다', () => {
  const s = fresh();
  s.gold = 10;
  s.board[0] = { uid: 201, defId: 'slime', level: 2, growth: ['u_tough'] };
  s.board[1] = { uid: 202, defId: 'slime', level: 2, growth: ['slime_jelly'] };
  s.bench[0] = { uid: 203, defId: 'slime', level: 1 };
  s.bench[1] = { uid: 204, defId: 'slime', level: 1 };
  s.shop = [{ kind: 'monster', defId: 'slime' }];
  buy(s, 0);
  const lv3 = s.board[0]!;
  assert.equal(lv3.level, 3);
  assert.equal(s.phase, 'unitGrowth');
  assert.equal(s.unitGrowth.length, 1);
  assert.equal(s.unitGrowth[0].uid, lv3.uid);
  const pick = s.unitGrowth[0].choices[0];
  chooseUnitGrowth(s, 0);
  assert.deepEqual(lv3.growth, ['u_tough', 'slime_jelly', pick]);
  assert.equal(maxGrowthCount(2), 1);
  assert.equal(maxGrowthCount(3), 3);
});

test('영구 강화는 합성 때 합산하지 않고 계열별 최고값만 남는다', () => {
  // 행동 간격은 낮을수록 좋음 → 최솟값, 나머지는 최댓값. 없는 값은 0으로 봐서 불리한 강화는 사라진다.
  assert.deepEqual(
    mergeBonus([{ intervalPct: -10, atk: 3 }, { intervalPct: -15, hp: -5 }, { intervalPct: -5, atk: 5, powerPct: 20 }]),
    { intervalPct: -15, atk: 5, powerPct: 20 },
  );
  assert.equal(mergeBonus([undefined, {}, undefined]), undefined);

  const s = fresh();
  s.board[0] = { uid: 301, defId: 'slime', level: 1, bonus: { intervalPct: -10, atk: 3 } };
  s.bench[0] = { uid: 302, defId: 'slime', level: 1, bonus: { intervalPct: -15 } };
  s.bench[1] = { uid: 303, defId: 'slime', level: 1, bonus: { intervalPct: -5, atk: 5 } };
  mergeAll(s);
  assert.equal(s.board[0]!.level, 2);
  assert.deepEqual(s.board[0]!.bonus, { intervalPct: -15, atk: 5 }); // -30%가 아니라 -15%
});

test('영구 강화는 전투 능력치에 반영되고 기록 스냅샷에도 들어간다', () => {
  const s = fresh();
  s.board[0] = { uid: 401, defId: 'slime', level: 1, bonus: { atk: 10, intervalPct: -50 } };
  const entry = toSnapshot(s, 'x').board.find((e) => e.defId === 'slime')!;
  assert.deepEqual(entry.bonus, { atk: 10, intervalPct: -50 });
  const r = simulateBattle(input(team([{ ...entry, slot: 2 }]), team([mon(5, 'guardian')])));
  const u = r.units.find((x) => x.uid === '0-2')!;
  assert.equal(u.startAtk, 5 + 10 + 1); // 기본 5 + 강화 10 + 1행 보너스 1
  assert.equal(u.interval, 10); // 20 tick × 0.5
});

test('성장: 기본 능력 제거·새 능력 추가·태그 추가/제거·% 능력치', () => {
  const wolf = MONSTER_MAP.wolf;
  const alpha = computeUnit(wolf, 100, [findUnitGrowth('wolf', 'wolf_alpha')!]);
  assert.equal(alpha.triggers.length, 2);
  assert.equal(alpha.triggers[0].on, 'act'); // 원래 0번(전투 시작 가속)이 빠지고 기본 공격이 앞으로
  assert.deepEqual((alpha.triggers[1].effects[0] as { target: { dirs: string[] } }).target.dirs.length, 8);
  const carrier = computeUnit(MONSTER_MAP.plague, 100, [findUnitGrowth('plague', 'plague_carrier')!]);
  assert.deepEqual(carrier.tags, ['자연']);
  assert.equal(carrier.power, 39); // 30 × 1.3
  const might = computeUnit(MONSTER_MAP.slime, 190, [findUnitGrowth('slime', 'u_might')!]);
  assert.equal(might.atk, 11); // 5 × 1.9 = 9 → ×1.25 = 11
});

test('성장으로 얻은 태그가 전투의 태그 시너지에 반영된다', () => {
  // 기사 리더의 "전사의 맹세"(아군 전사 공격력 +25%)는 원래 언데드인 해골 병사에게 적용되지 않지만,
  // "망자의 기사" 성장으로 전사 태그를 얻으면 적용된다.
  const withLeader = (growth?: string[]): TeamSnapshot => ({
    name: 't', leaderId: 'knight', leaderLevel: 1, growth: ['k_oath'], trinkets: [],
    board: [{ slot: 8, kind: 'leader', defId: 'knight', level: 1 }, mon(5, 'skeleton', 2, growth)],
  });
  const atk = (t: TeamSnapshot) => simulateBattle(input(t, team([mon(5, 'guardian')]))).units.find((u) => u.uid === '0-5')!.startAtk;
  const plain = atk(withLeader());
  const knighted = atk(withLeader(['skel_knight']));
  assert.equal(knighted, Math.trunc((plain * 125) / 100));
});

// ── 3·4. 엘리트 확률표 앞당김 삭제, 상점 6칸 ──

test('상점은 6칸이고 엘리트 보너스용 확률표 앞당김 설정은 없다', () => {
  const s = fresh();
  rollShop(s, new Rng(1));
  assert.equal(s.shop.length, 6);
  assert.equal('eliteRewardRowShift' in BALANCE.run, false);
});

// ── 5. 일차별 체력 배율 ──

test('일차별로 양측 최대 체력이 같은 비율로 늘어난다', () => {
  const t = team([mon(5, 'slime')]);
  const d1 = simulateBattle(input(t, t, 1)).maxHp[0];
  const d14 = simulateBattle(input(t, t, 14)).maxHp;
  const pct = BALANCE.scaling.hpPctByDay[13];
  assert.equal(d14[0], Math.trunc((d1 * pct) / 100));
  assert.equal(d14[0], d14[1]);
});

// ── 6. 방향 대상 ──

test('방향 대상: 대칭 위치의 위·오른쪽 상대에게만 디버프', () => {
  const mod = snapshotMod('t');
  mod.monsters.push({
    id: 'tester', name: '시험체', grade: 1, tags: [], hp: 50, atk: 0, intervalTicks: 100, desc: '',
    triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.enemy(['u', 'r']), pct: -50 }] }],
  });
  applyMod(mod);
  try {
    const p = team([mon(5, 'tester')]);
    const e = team([mon(2, 'ogre'), mon(6, 'ogre'), mon(4, 'ogre'), mon(5, 'ogre')]);
    const r = simulateBattle(input(p, e));
    const atk = (uid: string) => r.units.find((u) => u.uid === uid)!.startAtk;
    assert.equal(atk('1-2'), Math.trunc((28 + 1) / 2)); // 위 (1행이라 공격력 +1 후 절반)
    assert.equal(atk('1-6'), 14); // 오른쪽
    assert.equal(atk('1-4'), 28); // 왼쪽: 대상 아님
    assert.equal(atk('1-5'), 28); // 같은 칸: 대상 아님
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('대상 설명 문구', () => {
  assert.equal(filterText(T.adjacent('언데드')), '인접 아군 언데드');
  assert.equal(filterText(T.mirror()), '같은 칸 상대');
  assert.equal(filterText(T.enemy(['u', 'r'])), '대칭 위치 위·오른쪽 상대');
  assert.equal(filterText(T.around()), '주변 8칸 아군');
});

test('예전 형식 모드(scope, stacks)를 새 형식으로 변환해 읽는다', () => {
  const old = structuredClone(DEFAULT_MOD) as unknown as Record<string, unknown>;
  old.monsters = [{
    id: 'old', name: '옛 몬스터', grade: 1, tags: [], hp: 10, atk: 1, intervalTicks: 20, desc: '',
    triggers: [{ on: 'act', effects: [
      { type: 'atkFlat', target: { scope: 'adjacent', tag: '야수' }, amount: 1 },
      { type: 'stun', target: { scope: 'enemies', sameRow: true }, ticks: 5 },
      { type: 'status', status: 'poison', stacks: 2, to: 'enemy' },
    ] }],
  }];
  delete old.unitGrowth;
  const mod = parseMod(JSON.stringify(old));
  const eff = mod.monsters[0].triggers[0].effects;
  assert.deepEqual(eff[0], { type: 'atkFlat', target: { side: 'ally', area: 'near', dirs: ['u', 'd', 'l', 'r'], tag: '야수' }, amount: 1 });
  assert.deepEqual(eff[1], { type: 'stun', target: { side: 'enemy', area: 'sameRow' }, ticks: 5 });
  assert.deepEqual(eff[2], { type: 'status', status: 'poison', flat: 2, to: 'enemy' });
  assert.ok(mod.unitGrowth.length > 0);
});

// ── 7. 주문력 ──

test('독 중첩은 주문력 기반이라 레벨업과 주문력 성장으로 함께 오른다', () => {
  const firstPoison = (level: number, growth?: string[]) => {
    const r = simulateBattle(input(team([mon(5, 'mushroom', level, growth)]), team([mon(5, 'guardian')])));
    return r.events.find((e) => e.type === 'status' && e.side === 0)!.amount;
  };
  assert.equal(firstPoison(1), 1); // 주문력 10 × 10%
  assert.equal(firstPoison(2), 2); // 19 × 10% = 1.9 → 반올림 2
  assert.equal(firstPoison(3), 4); // 36 × 10% = 3.6 → 4
  assert.equal(firstPoison(3, ['u_arcane']), 5); // 36 × 1.4 = 50 → 5
});
