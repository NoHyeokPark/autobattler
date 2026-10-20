// 리더 변신: 리더 Lv3에 본질 강화(맨 앞 고정 1자리) + 변신을 한꺼번에 제시, 리더당 하나. 변신은 태그·이름·능력이 바뀐다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { TeamSnapshot } from '../src/battle/types.ts';
import { BALANCE } from '../src/config/balance.ts';
import { applyMod, DEFAULT_MOD, importDefaults, missingDefaults, parseMod } from '../src/data/registry.ts';
import { findGrowth, isPromotion, LEADERS } from '../src/data/leaders.ts';
import { validateMod } from '../src/data/validate.ts';
import { Rng } from '../src/core/rng.ts';
import { botGrowth } from '../src/game/bot.ts';
import { beginDay, chooseGrowth } from '../src/game/run.ts';
import { createRun } from '../src/game/state.ts';
import type { RunState } from '../src/game/state.ts';
import { leaderView } from '../src/game/view.ts';

// 다음 리더 레벨업 날까지 진행 (상점은 건너뛴다)
function toLevelUp(s: RunState) {
  do beginDay(s);
  while (s.phase !== 'growth');
}

test('모든 기본 리더는 태그가 바뀌는 변신을 3개 이상 가진다', () => {
  for (const l of LEADERS) {
    assert.ok(!l.growth.some((g) => g.transform || g.mastery), `${l.name}: 일반 성장에는 전직이 없다`);
    const forms = (l.promotions ?? []).filter((g) => g.transform);
    assert.ok(forms.length >= 3, l.name);
    for (const g of forms) {
      assert.ok(g.addTags?.length && g.removeTags?.length, `${l.name} ${g.name}: 태그 변화`);
      assert.ok(g.form, `${l.name} ${g.name}: 일러스트 형태`);
    }
    const masteries = (l.promotions ?? []).filter((g) => g.mastery);
    assert.equal(masteries.length, 1, `${l.name}: 본질 강화 1개`);
    assert.ok(!masteries[0].addTags && !masteries[0].removeTags, `${l.name}: 본질 강화는 태그 유지`);
  }
  assert.deepEqual(validateMod(DEFAULT_MOD).errors, []);
});

test('변신 레벨: 리더 Lv3에 본질 강화가 맨 앞 고정, 변신 3개가 뒤에. 하나 고르면 다시 나오지 않는다', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = createRun('knight', seed, `tf-${seed}`);
    toLevelUp(s); // Lv2
    assert.equal(s.leaderLevel, 2);
    assert.ok(s.growthChoices.every((id) => !isPromotion('knight', id)));
    chooseGrowth(s, 0);
    toLevelUp(s); // Lv3 = 변신
    assert.equal(s.leaderLevel, 3);
    assert.equal(s.growthChoices[0], 'k_m_swordmaster'); // 고정 자리
    assert.deepEqual(s.growthChoices.slice(1).sort(), ['k_t_deathknight', 'k_t_paladin', 'k_t_wolfrider']);
    chooseGrowth(s, seed % 4); // 본질 강화든 변신이든 고른 뒤에는 둘 다 나오지 않는다
    for (let lv = 4; lv <= 1 + BALANCE.leader.levelUpDays.length; lv++) {
      toLevelUp(s);
      assert.ok(s.growthChoices.every((id) => !isPromotion('knight', id)), `Lv${lv}`);
      chooseGrowth(s, 0);
    }
  }
});

const knightTeam = (growth: string[]): TeamSnapshot => ({
  name: 't', leaderId: 'knight', leaderLevel: 3, growth, board: [{ slot: 5, kind: 'leader', defId: 'knight', level: 3 }], trinkets: [],
});
const saintTeam = (growth: string[]): TeamSnapshot => ({
  name: 't', leaderId: 'saint', leaderLevel: 3, growth, board: [{ slot: 5, kind: 'leader', defId: 'saint', level: 3 }], trinkets: [],
});
const dummy: TeamSnapshot = { name: 'd', leaderId: 'knight', leaderLevel: 1, growth: [], board: [{ slot: 5, kind: 'monster', defId: 'guardian', level: 1 }], trinkets: [] };

test('같은 언데드 변신이라도 원래 리더의 특성이 남는다: 기사는 흡혈, 성녀는 회복을 잃는다', () => {
  const dk = leaderView(LEADERS.find((l) => l.id === 'knight')!, 3, ['k_t_deathknight']);
  assert.equal(dk.name, '죽음의 기사');
  assert.deepEqual(dk.tags, ['언데드']);
  const r1 = simulateBattle({ player: knightTeam(['k_t_deathknight']), enemy: dummy, env: 'normal', day: 7, seed: 1 });
  assert.ok(r1.events.some((e) => e.type === 'heal' && e.src === '0-5'));
  assert.equal(r1.units.find((u) => u.uid === '0-5')!.name, '죽음의 기사');

  const wraith = leaderView(LEADERS.find((l) => l.id === 'saint')!, 3, ['s_t_wraith']);
  assert.deepEqual(wraith.tags, ['언데드']);
  const r2 = simulateBattle({ player: saintTeam(['s_t_wraith']), enemy: dummy, env: 'normal', day: 7, seed: 1 });
  assert.ok(!r2.events.some((e) => e.type === 'heal' && e.src === '0-5'));
  assert.ok(r2.events.some((e) => e.type === 'shield' && e.src === '0-5'));
});

test('봇은 보드에 가장 많이 모인 태그 쪽으로 변신한다', () => {
  const s = createRun('saint', 3, 'tf-bot');
  toLevelUp(s);
  chooseGrowth(s, 0);
  toLevelUp(s);
  s.board = s.board.map((u) => (u?.leader ? u : null));
  s.board[0] = { uid: 901, defId: 'slime', level: 1 };
  s.board[1] = { uid: 902, defId: 'goblin', level: 1 };
  s.board[2] = { uid: 903, defId: 'skeleton', level: 1 };
  botGrowth(s, new Rng(1));
  assert.ok(s.growth.includes('s_t_divinebeast')); // 야수 2 > 언데드 1 > 자연 0
});

test('새 기본 항목 가져오기: 모드에 있는 리더에 빠진 성장(변신)만 넣는다', () => {
  const mod = structuredClone(DEFAULT_MOD);
  const knight = mod.leaders.find((l) => l.id === 'knight')!;
  knight.promotions = [];
  knight.hp = 999; // 직접 고친 값은 유지
  const missing = missingDefaults(mod);
  assert.deepEqual(missing.map((m) => `${m.kind}:${m.parent}:${m.id}`).sort(),
    ['leaderPromotion:knight:k_m_swordmaster', 'leaderPromotion:knight:k_t_deathknight', 'leaderPromotion:knight:k_t_paladin', 'leaderPromotion:knight:k_t_wolfrider']);
  importDefaults(mod, missing);
  assert.equal(knight.hp, 999);
  assert.deepEqual(knight.promotions.map((g) => g.id), DEFAULT_MOD.leaders.find((l) => l.id === 'knight')!.promotions!.map((g) => g.id));
  assert.equal(missingDefaults(mod).length, 0);
});

test('본질 강화: 태그를 유지하고 이름이 바뀌며, 봇은 원래 태그가 많이 모였으면 본질 강화를 고른다', () => {
  const sm = leaderView(LEADERS.find((l) => l.id === 'knight')!, 3, ['k_m_swordmaster']);
  assert.equal(sm.name, '검성');
  assert.deepEqual(sm.tags, ['전사']);

  const s = createRun('knight', 4, 'tf-bot-m');
  toLevelUp(s);
  chooseGrowth(s, 0);
  toLevelUp(s);
  s.board = s.board.map((u) => (u?.leader ? u : null));
  s.board[0] = { uid: 901, defId: 'squire', level: 1 };
  s.board[1] = { uid: 902, defId: 'squire', level: 1 };
  s.board[2] = { uid: 903, defId: 'slime', level: 1 };
  botGrowth(s, new Rng(1));
  assert.ok(s.growth.includes('k_m_swordmaster')); // 전사 2 > 야수 1
});

test('예전 모드: 일반 성장에 섞인 변신·본질 강화는 불러올 때 전직 목록으로 옮겨지고, 변신 레벨 설정도 이름이 바뀐다', () => {
  const old = structuredClone(DEFAULT_MOD) as unknown as Record<string, any>;
  for (const l of old.leaders) {
    l.growth = [...l.growth, ...l.promotions];
    delete l.promotions;
  }
  old.balance.leader = { ...old.balance.leader, transformLevels: [4] };
  delete old.balance.leader.promotionLevels;
  const mod = parseMod(JSON.stringify(old));
  const knight = mod.leaders.find((l) => l.id === 'knight')!;
  assert.ok(!knight.growth.some((g) => g.transform || g.mastery));
  assert.deepEqual(knight.promotions!.map((g) => g.id).sort(), ['k_m_swordmaster', 'k_t_deathknight', 'k_t_paladin', 'k_t_wolfrider']);
  assert.deepEqual(mod.balance.leader.promotionLevels, [4]);
  assert.ok(!('transformLevels' in mod.balance.leader));
  assert.deepEqual(validateMod(mod).warnings.filter((w) => w.includes('전직')), []);
});

test('등장 레벨 구간: 리더 성장은 그 레벨 구간의 레벨업에서만 나온다', () => {
  const mod = structuredClone(DEFAULT_MOD);
  const knight = mod.leaders.find((l) => l.id === 'knight')!;
  for (const g of knight.growth) g.minLevel = 4; // 모두 Lv4부터
  knight.growth.push({ id: 'k_early', name: '초반 전용', desc: '', repeatable: true, maxLevel: 2, stats: { atk: 1 } });
  applyMod(mod);
  try {
    const s = createRun('knight', 9, 'lv-range');
    toLevelUp(s); // Lv2: 초반 전용만 가능
    assert.deepEqual(s.growthChoices, ['k_early']);
    chooseGrowth(s, 0);
    toLevelUp(s); // Lv3: 전직
    assert.ok(s.growthChoices.every((id) => isPromotion('knight', id)));
    chooseGrowth(s, 0);
    toLevelUp(s); // Lv4: 초반 전용은 빠지고 나머지 등장
    assert.equal(s.growthChoices.length, BALANCE.leader.growthChoices);
    assert.ok(!s.growthChoices.includes('k_early'));
    assert.ok(validateMod(mod).warnings.some((w) => w.includes('Lv2에 나올 수 있는 성장이 1개뿐')));
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});
