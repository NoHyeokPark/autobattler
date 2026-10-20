// 성장 촉진 장신구: 진화의 돌(보드·벤치 Lv1 → Lv2), 각성의 두루마리(다음 구매 → Lv2). 장신구 등급 이하만, 1회용
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeUnit, findUnitGrowth } from '../src/data/growth.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { isOneShot, TRINKET_MAP } from '../src/data/trinkets.ts';
import { beginDay, chooseReward } from '../src/game/run.ts';
import { buy, chooseUnitGrowth, move } from '../src/game/shop.ts';
import { createRun } from '../src/game/state.ts';

const fresh = () => {
  const s = createRun('knight', 3, 'upgrade-test');
  beginDay(s);
  s.gold = 50;
  return s;
};

test('진화의 돌: 보드의 등급 이하 Lv1 유닛 하나를 Lv2로 올리고 사라진다', () => {
  const s = fresh();
  s.board[0] = { uid: 1, defId: 'ogre', level: 1 }; // 희귀(3) → 고급 돌로는 불가
  s.board[1] = { uid: 2, defId: 'slime', level: 1 }; // 일반(1) → 가능
  s.shop = [{ kind: 'trinket', defId: 'evo_stone' }]; // 고급(2)
  const r = buy(s, 0);
  assert.ok(r.msg.includes('진화의 돌'));
  assert.equal(s.board[1]!.level, 2);
  assert.equal(s.board[0]!.level, 1);
  assert.ok(!s.trinkets.includes('evo_stone'));
  assert.equal(s.phase, 'unitGrowth'); // Lv2 성장 선택
  chooseUnitGrowth(s, 0);
  assert.equal(s.board[1]!.growth?.length, 1);
  assert.equal(s.phase, 'shop');
});

test('진화의 돌: 벤치의 Lv1 유닛도 대상 (보드 배치로 대상을 고를 수 없다)', () => {
  const s = fresh();
  s.board[0] = { uid: 1, defId: 'ogre', level: 1 }; // 희귀 → 대상 아님
  s.bench[0] = { uid: 2, defId: 'goblin', level: 1 }; // 일반, 벤치
  s.shop = [{ kind: 'trinket', defId: 'evo_pebble' }]; // 일반(1)
  const r = buy(s, 0);
  assert.ok(r.msg.includes('진화의 조약돌'));
  assert.equal(s.bench[0]!.level, 2);
  assert.equal(s.board[0]!.level, 1);
  assert.ok(!s.trinkets.includes('evo_pebble'));
});

test('진화의 돌: 보드·벤치 모두 대상이 없으면 보관하다가, 대상이 생기면 발동', () => {
  const s = fresh();
  s.board[0] = { uid: 1, defId: 'ogre', level: 1 };
  s.bench[0] = { uid: 2, defId: 'slime', level: 2 }; // Lv2는 대상 아님
  s.shop = [{ kind: 'trinket', defId: 'evo_pebble' }, { kind: 'monster', defId: 'goblin' }];
  buy(s, 0);
  assert.ok(s.trinkets.includes('evo_pebble')); // 보관
  assert.equal(s.phase, 'shop');
  const r = buy(s, 1); // 일반 Lv1이 벤치로 들어온다
  assert.ok(r.msg.includes('진화의 조약돌'));
  assert.equal(s.bench.find((u) => u?.defId === 'goblin')!.level, 2);
  assert.ok(!s.trinkets.includes('evo_pebble'));
});

test('진화의 돌: 전투 보상으로 얻으면 다음 상점 단계 시작에 발동', () => {
  const s = fresh();
  s.board[0] = { uid: 1, defId: 'slime', level: 1 };
  s.phase = 'reward';
  s.rewards = [{ label: '전투 보상', options: ['evo_pebble'], gold: 4 }];
  chooseReward(s, 0); // → 다음 날 시작
  assert.equal(s.day, 2);
  assert.equal(s.board[0]!.level, 2);
  assert.equal(s.phase, 'unitGrowth');
});

test('각성의 두루마리: 다음에 사는 등급 이하 몬스터가 Lv2로 들어오고 사라진다', () => {
  const s = fresh();
  s.trinkets = ['awk_note']; // 일반(1)
  s.shop = [{ kind: 'monster', defId: 'wolf' }, { kind: 'monster', defId: 'slime' }];
  buy(s, 0); // 늑대는 고급(2) → 적용 안 됨
  assert.equal(s.bench.find((u) => u?.defId === 'wolf')!.level, 1);
  assert.ok(s.trinkets.includes('awk_note'));
  const r = buy(s, 1);
  assert.ok(r.msg.includes('각성의 쪽지'));
  assert.equal(s.bench.find((u) => u?.defId === 'slime')!.level, 2);
  assert.ok(!s.trinkets.includes('awk_note'));
  assert.equal(s.phase, 'unitGrowth');
});

test('혼돈의 주사위: 한 단계 높은 등급의 무작위 몬스터로 바뀌고 레벨·성장·영구 강화는 유지', () => {
  const s = fresh();
  s.board[0] = { uid: 1, defId: 'slime', level: 2, growth: ['slime_jelly', 'u_might'], bonus: { atk: 4 }, form: 'x' };
  s.shop = [{ kind: 'trinket', defId: 'chaos_die' }];
  const r = buy(s, 0);
  const u = s.board[0]!;
  assert.ok(r.msg.includes('혼돈의 주사위: 슬라임 →'));
  assert.equal(MONSTER_MAP[u.defId].grade, 2); // 일반 → 고급
  assert.equal(u.level, 2);
  assert.deepEqual(u.growth, ['slime_jelly', 'u_might']);
  assert.deepEqual(u.bonus, { atk: 4 });
  assert.equal(u.form, undefined); // 모습은 새 몬스터의 기본 모습
  assert.ok(!s.trinkets.includes('chaos_die'));
  // 슬라임 전용 성장(끈적이는 몸)이 새 몬스터에서도 그대로 효과를 낸다
  assert.equal(findUnitGrowth(u.defId, 'slime_jelly')?.name, '끈적이는 몸');
  const c = computeUnit(MONSTER_MAP[u.defId], 190, [findUnitGrowth(u.defId, 'slime_jelly')!]);
  assert.ok(c.triggers.some((t) => t.effects.some((e) => e.type === 'shield')));
});

test('혼돈의 주사위: 전설 몬스터는 신화 몬스터가 되고, 최고 등급(기원)과 리더는 대상이 아니다', () => {
  const s = fresh();
  s.board = s.board.map((u) => (u?.leader ? u : null)); // 리더만
  s.board[0] = { uid: 1, defId: 'mirror_spirit', level: 1 }; // 기원 = 최고 등급
  s.trinkets = ['chaos_die'];
  s.shop = [{ kind: 'monster', defId: 'slime' }];
  buy(s, 0); // 보드 대상 없음 → 보관
  assert.ok(s.trinkets.includes('chaos_die'));
  s.bench[1] = { uid: 2, defId: 'dragon', level: 1 }; // 전설
  move(s, { area: 'bench', index: 1 }, { area: 'board', index: 1 });
  assert.equal(s.board[1]!.defId, 'primordial');
  assert.equal(s.board[0]!.defId, 'mirror_spirit'); // 원래 있던 기원은 그대로
  assert.ok(!s.trinkets.includes('chaos_die'));
});

test('혼돈의 주사위: 바뀐 몬스터가 같은 몬스터 3장을 채우면 바로 합성된다', () => {
  // 변이 결과는 런의 난수로 정해지므로, 같은 상태를 복제해 먼저 결과를 본 뒤 그 몬스터 2장을 미리 두고 다시 굴린다
  const base = fresh();
  base.board[0] = { uid: 1, defId: 'slime', level: 1 };
  base.trinkets = ['chaos_die'];
  base.shop = [{ kind: 'monster', defId: 'goblin' }];
  const probe = structuredClone(base);
  buy(probe, 0);
  const became = probe.board[0]!.defId;
  assert.equal(MONSTER_MAP[became].grade, 2);

  base.bench[1] = { uid: 11, defId: became, level: 1 };
  base.bench[2] = { uid: 12, defId: became, level: 1 };
  buy(base, 0);
  const copies = [...base.board, ...base.bench].filter((u) => u?.defId === became);
  assert.equal(copies.length, 1);
  assert.equal(copies[0]!.level, 2);
  assert.equal(base.phase, 'unitGrowth'); // Lv2 합성 → 성장 선택
});

test('장신구 분류: 일회성 / 지속', () => {
  for (const id of ['evo_pebble', 'awk_note', 'chaos_die']) assert.equal(isOneShot(TRINKET_MAP[id]), true, id);
  for (const id of ['rusty_ring', 'lucky_coin', 'telescope', 'war_drum']) assert.equal(isOneShot(TRINKET_MAP[id]), false, id);
});

test('여러 개 가지면 낮은 등급부터 쓴다 (높은 등급은 아껴 둔다)', () => {
  const s = fresh();
  s.trinkets = ['awk_tome', 'awk_note']; // 희귀, 일반
  s.shop = [{ kind: 'monster', defId: 'slime' }];
  buy(s, 0);
  assert.deepEqual(s.trinkets, ['awk_tome']);
});

test('최고 레벨로 가진 몬스터는 상점에 나오지 않는다 (보드·벤치 모두)', async () => {
  const { rollShop, maxedMonsters } = await import('../src/game/shop.ts');
  const { Rng } = await import('../src/core/rng.ts');
  const { BALANCE } = await import('../src/config/balance.ts');
  const s = fresh();
  s.board[0] = { uid: 1, defId: 'slime', level: 3 };
  s.bench[0] = { uid: 2, defId: 'goblin', level: 3 };
  s.bench[1] = { uid: 3, defId: 'skeleton', level: 2 }; // Lv2는 그대로 나온다
  assert.deepEqual([...maxedMonsters(s)].sort(), ['goblin', 'slime']);
  let skeleton = 0;
  for (let seed = 1; seed <= 200; seed++) {
    rollShop(s, new Rng(seed));
    const ids = s.shop.map((x) => x?.defId);
    assert.ok(!ids.includes('slime') && !ids.includes('goblin'), `seed ${seed}`);
    if (ids.includes('skeleton')) skeleton++;
  }
  assert.ok(skeleton > 0);
  // 끄면 다시 나온다
  BALANCE.shop.hideMaxLevelOwned = false;
  try {
    assert.equal(maxedMonsters(s).size, 0);
  } finally {
    BALANCE.shop.hideMaxLevelOwned = true;
  }
});

test('혼돈의 동전: 일반·고급 몬스터만 변이하고, 대상이 없으면 보관한다', () => {
  const s = fresh();
  s.board = s.board.map((u) => (u?.leader ? u : null)); // 리더만
  s.board[0] = { uid: 1, defId: 'ogre', level: 1 }; // 희귀(3) → 동전 대상 아님
  s.shop = [{ kind: 'trinket', defId: 'chaos_coin' }];
  buy(s, 0);
  assert.ok(s.trinkets.includes('chaos_coin')); // 보관
  assert.equal(s.board[0]!.defId, 'ogre');
  s.bench[1] = { uid: 2, defId: 'wolf', level: 1 }; // 고급(2)
  const r = move(s, { area: 'bench', index: 1 }, { area: 'board', index: 1 });
  assert.ok(r.msg.includes('혼돈의 동전: 늑대 →'));
  assert.equal(MONSTER_MAP[s.board[1]!.defId].grade, 3); // 고급 → 희귀
  assert.ok(!s.trinkets.includes('chaos_coin'));
});

test('변이 장신구가 여럿이면 대상 범위가 좁은 동전부터 쓴다 (넓은 주사위를 좁은 대상에 낭비하지 않게)', () => {
  const s = fresh();
  s.board = s.board.map((u) => (u?.leader ? u : null));
  s.board[0] = { uid: 1, defId: 'slime', level: 1 }; // 둘 다 대상
  s.trinkets = ['chaos_die'];
  s.shop = [{ kind: 'trinket', defId: 'chaos_coin' }];
  const r = buy(s, 0);
  // 동전이 먼저 슬라임을 바꾸고, 보관 중이던 주사위는 바뀐 몬스터를 한 번 더 바꾼다 (대상이 있으면 바로 발동)
  assert.ok(r.msg.indexOf('혼돈의 동전') >= 0 && r.msg.indexOf('혼돈의 동전') < r.msg.indexOf('혼돈의 주사위'));
  assert.deepEqual(s.trinkets, []);
});
