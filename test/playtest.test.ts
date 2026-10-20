// 플레이 피드백: 상점 잠금 자동 해제, 공용 성장 등장 조건(등급·태그), 등급 7단계와 예전 모드 변환
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unitGrowthPool } from '../src/data/growth.ts';
import { applyMod, DEFAULT_MOD, parseMod, snapshotMod } from '../src/data/registry.ts';
import { GRADE_NAMES, MAX_GRADE } from '../src/data/types.ts';
import { beginDay } from '../src/game/run.ts';
import { reroll, shopTier } from '../src/game/shop.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { TRINKET_MAP } from '../src/data/trinkets.ts';
import { validateMod } from '../src/data/validate.ts';
import { createRun } from '../src/game/state.ts';

test('상점 잠금: 다음 날 도착하면 잠갔던 상점은 그대로 두고 잠금은 풀린다', () => {
  const s = createRun('knight', 7, 'lock');
  beginDay(s);
  const kept = JSON.stringify(s.shop);
  s.shopLocked = true;
  beginDay(s);
  assert.equal(JSON.stringify(s.shop), kept);
  assert.equal(s.shopLocked, false);
  beginDay(s); // 다시 걸지 않았으니 새로 뽑힌다
  assert.notEqual(JSON.stringify(s.shop), kept);
});

test('상점 잠금: 리롤하면 풀린다', () => {
  const s = createRun('knight', 7, 'lock2');
  beginDay(s);
  s.gold = 10;
  s.shopLocked = true;
  assert.ok(reroll(s).ok);
  assert.equal(s.shopLocked, false);
});

test('공용 성장 등장 조건: 등급 구간, 태그(포함·제외), 성장으로 바뀐 태그', () => {
  const mod = snapshotMod('cond');
  mod.monsters.push(
    { id: 'c_low', name: '낮음', grade: 1, tags: ['야수'], hp: 10, atk: 1, intervalTicks: 20, desc: '', triggers: [], growth: [{ id: 'c_to_dragon', name: '용화', desc: '', repeatable: false, addTags: ['드래곤'], removeTags: ['야수'] }] },
    { id: 'c_high', name: '높음', grade: 5, tags: ['마법'], hp: 10, atk: 1, intervalTicks: 20, desc: '', triggers: [] },
  );
  mod.unitGrowth = [
    { id: 'g_any', name: '누구나', desc: '', repeatable: false, stats: { hp: 1 } },
    { id: 'g_high', name: '전설 이상', desc: '', repeatable: false, stats: { hp: 1 }, minGrade: 5 },
    { id: 'g_low', name: '희귀 이하', desc: '', repeatable: false, stats: { hp: 1 }, maxGrade: 3 },
    { id: 'g_beast', name: '야수 전용', desc: '', repeatable: false, stats: { hp: 1 }, forTags: ['야수'] },
    { id: 'g_no_beast', name: '야수 제외', desc: '', repeatable: false, stats: { hp: 1 }, forTags: ['야수'], tagMode: 'except' },
  ];
  applyMod(mod);
  try {
    const ids = (defId: string, taken: string[] = []) => unitGrowthPool(defId, taken).map((g) => g.id).filter((id) => id.startsWith('g_')).sort();
    assert.deepEqual(ids('c_low'), ['g_any', 'g_beast', 'g_low']);
    assert.deepEqual(ids('c_high'), ['g_any', 'g_high', 'g_no_beast']);
    assert.deepEqual(ids('c_low', ['c_to_dragon']), ['g_any', 'g_low', 'g_no_beast']); // 야수 → 드래곤으로 바뀐 뒤
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('등급 7단계: 이름과 기본 데이터 (숫자는 예전 그대로, 기원 = 거울 정령(상점 X)·지휘자(상점 O))', () => {
  assert.deepEqual(GRADE_NAMES.slice(1), ['일반', '고급', '희귀', '영웅', '전설', '신화', '기원']);
  assert.equal(MAX_GRADE, 7);
  const b = DEFAULT_MOD.balance;
  assert.ok(b.shop.odds.every((row) => row.length === 7 && row[6] === 0)); // 기원은 상점 확률 0
  assert.equal(b.economy.monsterCost.length, 7);
  assert.equal(b.economy.trinketCost[6], 0);
  assert.equal(DEFAULT_MOD.monsters.find((m) => m.id === 'primordial')!.grade, 6); // 예전 기원 → 신화
  assert.deepEqual(DEFAULT_MOD.monsters.filter((m) => m.grade === 7).map((m) => [m.id, m.shop !== false]), [['mirror_spirit', false], ['conductor', true]]);
});

test('예전 모드(version 2): 등급 숫자는 그대로, 기원 칸 추가, 설명 글의 등급 이름만 한 칸씩', () => {
  const v2 = {
    format: 'autobattler-mod', version: 2, name: 'old',
    monsters: [
      { id: 'a', name: '전설의 용사', grade: 1, tags: [], hp: 10, atk: 1, intervalTicks: 20, desc: '', triggers: [] },
      { id: 'b', name: 'B', grade: 3, tags: [], hp: 10, atk: 1, intervalTicks: 20, desc: '에픽 몬스터', triggers: [{ on: 'battleStart', effects: [{ type: 'trinket', grade: [1, 2, 6] }] }] },
    ],
    trinkets: [
      { id: 't', name: '기원의 심장', grade: 6, desc: '', triggers: [] },
      { id: 'e', name: '진화의 돌', grade: 2, desc: '1회용: 보드의 희귀 이하 Lv1 유닛. 무작위 일반/희귀 장신구', triggers: [] },
    ],
    balance: {
      shop: { odds: [[50, 30, 20, 0, 0, 0]] },
      economy: { monsterCost: [1, 2, 3, 4, 5, 8], trinketCost: [4, 6, 8, 11, 14, 0] },
      run: { bossRewardGrade: { 3: 3, 12: 6 } },
    },
  };
  const m = parseMod(JSON.stringify(v2));
  assert.equal(m.version, 3);
  assert.deepEqual(m.monsters.map((x) => x.grade), [1, 3]);
  assert.deepEqual(m.monsters.map((x) => GRADE_NAMES[x.grade]), ['일반', '희귀']); // 에픽(3) → 희귀
  assert.equal(m.monsters[0].name, '전설의 용사'); // 이름은 그대로
  assert.equal(m.monsters[1].desc, '희귀 몬스터');
  assert.deepEqual((m.monsters[1].triggers[0].effects[0] as { grade: number[] }).grade, [1, 2, 6]);
  assert.equal(m.trinkets[0].name, '기원의 심장');
  assert.equal(GRADE_NAMES[m.trinkets[0].grade], '신화');
  assert.equal(m.trinkets[1].desc, '1회용: 보드의 고급 이하 Lv1 유닛. 무작위 일반/고급 장신구');
  assert.deepEqual(m.balance.shop.odds[0], [50, 30, 20, 0, 0, 0, 0]);
  assert.deepEqual(m.balance.economy.monsterCost, [1, 2, 3, 4, 5, 8, 10]);
  assert.deepEqual(m.balance.economy.trinketCost, [4, 6, 8, 11, 14, 17, 0]); // 신화 장신구는 이제 상점에도 나올 수 있어 가격이 생김
  assert.deepEqual(m.balance.run.bossRewardGrade, { 3: 3, 12: 6 });
  // 이미 새 형식이면 다시 옮기지 않는다
  assert.equal(parseMod(JSON.stringify(m)).trinkets[1].desc, m.trinkets[1].desc);
});

test('몬스터가 없는 등급(기원)에 상점 확률이 있어도 그 칸은 무시: 2일차에 신화 몬스터·장신구가 새어 나오지 않는다', () => {
  const mod = snapshotMod('origin-odds');
  mod.balance.shop.odds = mod.balance.shop.odds.map((row) => { const r = [...row]; r[0] -= 1; r[6] = 1; return r; }); // 기원 칸 1%
  for (const m of mod.monsters) if (m.grade === 7) m.shop = false; // 상점에 나오는 기원 몬스터가 없는 상황
  applyMod(mod);
  try {
    let shops = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = createRun('knight', seed, `o${seed}`);
      beginDay(s);
      beginDay(s); // 2일차
      for (const it of s.shop) {
        if (!it) continue;
        const grade = it.kind === 'monster' ? MONSTER_MAP[it.defId].grade : TRINKET_MAP[it.defId].grade;
        assert.ok(grade <= 3, `${seed}: ${it.defId} (${grade})`); // 2일차 표: 일반·고급·희귀만
        shops++;
      }
    }
    assert.ok(shops > 2000);
    assert.ok(validateMod(mod).warnings.some((w) => w.includes('기원(7등급)')));
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('상점 레벨 = 실제로 쓰는 확률표 줄 (일차 + 장신구, 표 끝에서 멈춤)', () => {
  const s = createRun('knight', 1, 'tier');
  beginDay(s);
  beginDay(s);
  assert.deepEqual([shopTier(s).tier, shopTier(s).bonus], [2, 0]);
  s.trinkets = ['telescope', 'explorer_map'];
  assert.deepEqual([shopTier(s).tier, shopTier(s).bonus], [5, 3]);
  s.day = 14;
  assert.equal(shopTier(s).tier, DEFAULT_MOD.balance.shop.odds.length);
});
