// 몬스터 전직: 최고 레벨(Lv3)이 되면 반드시. 길이 하나면 바로, 여럿이면 고른다
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import { monsterName } from '../src/data/growth.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import type { GrowthDef } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';
import { beginDay } from '../src/game/run.ts';
import { buy, choosePromotion, chooseUnitGrowth } from '../src/game/shop.ts';
import { createRun, toSnapshot } from '../src/game/state.ts';
import type { OwnedUnit, RunState } from '../src/game/state.ts';
import { monsterView } from '../src/game/view.ts';

const GYARADOS: GrowthDef = { id: 'p_gyarados', name: '갸라도스', desc: '', repeatable: false, form: true, quote: '크아아!', stats: { hpPct: 200, atkPct: 300 }, addTags: ['드래곤'] };
const RED: GrowthDef = { id: 'p_red', name: '붉은 슬라임', desc: '', repeatable: false, stats: { atk: 5 } };
const BLUE: GrowthDef = { id: 'p_blue', name: '푸른 슬라임', desc: '', repeatable: false, stats: { hp: 50 } };

function withPromotions(promotions: GrowthDef[], fn: () => void) {
  const mod = snapshotMod('mpromo');
  mod.monsters.find((m) => m.id === 'slime')!.promotions = promotions;
  applyMod(mod);
  try {
    fn();
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}

// 벤치에 Lv2 슬라임 2장 (성장 하나씩) + 상점에 슬라임 → Lv1 2장을 더 두고 1장 사면 Lv2 → Lv3 연쇄
function setup(): RunState {
  const s = createRun('knight', 5, 'mpromo');
  beginDay(s);
  s.gold = 100;
  s.board = s.board.map((u) => (u?.leader ? u : null));
  const lv = (uid: number, level: number, growth?: string[]): OwnedUnit => ({ uid, defId: 'slime', level, ...(growth ? { growth } : {}) });
  s.bench = [lv(101, 2, ['u_might']), lv(102, 2, ['u_might']), lv(103, 1), lv(104, 1), null, null];
  s.shop = [{ kind: 'monster', defId: 'slime' }];
  return s;
}
const slimes = (s: RunState) => [...s.board, ...s.bench].filter((u): u is OwnedUnit => !!u && u.defId === 'slime');

test('길이 하나면 Lv3이 되는 순간 바로 전직: 이름·모습·능력치·작은 알림', () => {
  withPromotions([GYARADOS], () => {
    const s = setup();
    buy(s, 0);
    // Lv2가 된 순간의 성장 선택을 고르면 → 이미 Lv3으로 합성되어 있고 전직도 끝나 있다
    // (아래 배율 확인이 성장 % 에 흔들리지 않게 체력·공격력 % 성장은 피해서 고른다)
    while (s.unitGrowth.length) chooseUnitGrowth(s, Math.max(0, s.unitGrowth[0].choices.findIndex((id) => id !== 'u_tough' && id !== 'u_might')));
    const [u] = slimes(s);
    assert.equal(u.level, 3);
    assert.ok(u.growth!.includes('p_gyarados'));
    assert.equal(u.form, 'p_gyarados');
    assert.equal(monsterName(u.defId, u.growth), '갸라도스');
    assert.equal(s.phase, 'shop');
    assert.ok(s.voices?.some((v) => v.kind === 'promote' && v.promoId === 'p_gyarados' && v.from === '슬라임'));
    assert.ok(!s.voices?.some((v) => v.kind === 'maxLevel')); // 최고 레벨 대사 대신 전직 알림
    const before = monsterView({ ...slimeDef() }, 3, u.growth!.filter((id) => id !== 'p_gyarados'));
    const after = monsterView(slimeDef(), 3, u.growth);
    assert.equal(after.name, '갸라도스');
    assert.ok(after.hp > before.hp * 2.5 && after.atk >= before.atk * 3); // % 는 다른 성장의 % 와 더해진다 (+50% + 300% → 4.5배 vs 1.5배)
    assert.ok(after.tags.includes('드래곤'));
    // 전투에서도 전직 이름
    s.board[0] = u;
    s.bench = s.bench.map((x) => (x === u ? null : x));
    const team = toSnapshot(s, 'me');
    const r = simulateBattle({ player: team, enemy: team, env: 'normal', day: 3, seed: 1 });
    assert.ok(r.units.some((x) => x.name === '갸라도스'));
  });
});

test('길이 여럿이면 고른다 (성장 선택을 먼저 끝내야 함), 전직하면 외형 선택은 없다', () => {
  withPromotions([RED, BLUE], () => {
    const s = setup();
    s.bench[0]!.form = 'x'; // 재료들의 외형이 달라도 전직할 몬스터는 외형을 고르지 않는다
    buy(s, 0);
    assert.equal(s.phase, 'unitGrowth');
    assert.equal(s.unitPromotions?.length, 1);
    assert.equal(choosePromotion(s, 1).ok, false); // Lv2 성장 선택이 먼저
    while (s.unitGrowth.length) chooseUnitGrowth(s, 0);
    assert.equal(s.formChoices?.length ?? 0, 0);
    const r = choosePromotion(s, 1);
    assert.ok(r.ok, r.msg);
    const [u] = slimes(s);
    assert.equal(monsterName(u.defId, u.growth), '푸른 슬라임');
    assert.ok(u.growth!.includes('u_might')); // 가진 성장은 유지
    assert.equal(s.phase, 'shop');
  });
});

test('검증: 전용 성장과 전직 id가 겹치면 오류', () => {
  const mod = snapshotMod('mpromo-v');
  const slime = mod.monsters.find((m) => m.id === 'slime')!;
  slime.promotions = [{ ...RED, id: slime.growth![0].id }];
  assert.ok(validateMod(mod).errors.some((e) => e.includes('성장·전직')));
});

function slimeDef() {
  return snapshotMod('x').monsters.find((m) => m.id === 'slime')!;
}
