import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/config/balance.ts';
import { describeTriggers } from '../src/data/describe.ts';
import { MONSTER_MAP, MONSTERS } from '../src/data/monsters.ts';
import { applyMod, DEFAULT_MOD, parseMod, snapshotMod } from '../src/data/registry.ts';
import { validateMod } from '../src/data/validate.ts';

const restore = () => applyMod(structuredClone(DEFAULT_MOD));

test('모드 적용은 기존 객체를 제자리에서 바꾼다 (미리 잡아 둔 참조도 새 값을 본다)', () => {
  const runRef = BALANCE.run; // run.ts가 import 시점에 잡아 두는 것과 같은 참조
  const mod = snapshotMod('t');
  mod.balance.run.winTarget = 7;
  mod.monsters.find((m) => m.id === 'slime')!.atk = 99;
  mod.monsters.push({ ...structuredClone(mod.monsters[0]), id: 'new_mon', name: '신규' });
  applyMod(mod);
  try {
    assert.equal(runRef.winTarget, 7);
    assert.equal(MONSTER_MAP.slime.atk, 99);
    assert.ok(MONSTER_MAP.new_mon);
    assert.equal(MONSTERS.length, DEFAULT_MOD.monsters.length + 1);
  } finally {
    restore();
  }
  assert.equal(BALANCE.run.winTarget, DEFAULT_MOD.balance.run.winTarget);
  assert.equal(MONSTER_MAP.new_mon, undefined);
});

test('ticksPerSec은 모드로 바꿀 수 없다', () => {
  const mod = snapshotMod('t');
  mod.balance.ticksPerSec = 99;
  applyMod(mod);
  try {
    assert.equal(BALANCE.ticksPerSec, 10);
  } finally {
    restore();
  }
});

test('기본 데이터는 검증 오류가 없다', () => {
  assert.deepEqual(validateMod(DEFAULT_MOD).errors, []);
});

test('검증: 중복 id, 소수 수치, 일반 몬스터 없음을 잡는다', () => {
  const mod = snapshotMod('t');
  mod.monsters[1].id = mod.monsters[0].id;
  mod.balance.economy.rerollCost = 1.5;
  const v = validateMod(mod);
  assert.ok(v.errors.some((e) => e.includes('중복')));
  assert.ok(v.errors.some((e) => e.includes('rerollCost')));
  const noCommon = snapshotMod('t');
  noCommon.monsters = noCommon.monsters.filter((m) => m.grade !== 1);
  assert.ok(validateMod(noCommon).errors.some((e) => e.includes('일반')));
});

test('부분 모드 파일도 기본값으로 채워서 읽는다', () => {
  const mod = parseMod(JSON.stringify({ format: 'autobattler-mod', name: '부분', balance: { ruleVersion: 2 } }));
  assert.equal(mod.balance.ruleVersion, 2);
  assert.equal(mod.balance.run.winTarget, DEFAULT_MOD.balance.run.winTarget);
  assert.equal(mod.monsters.length, DEFAULT_MOD.monsters.length);
  assert.throws(() => parseMod('{"name":"x"}'));
});

test('트리거에서 설명을 자동 생성한다', () => {
  const skel = MONSTER_MAP.skeleton;
  assert.equal(describeTriggers(skel.triggers), '전투 시작: 인접 아군 언데드 공격력 +2/4/8. 행동: 공격력 100% 피해.');
});
