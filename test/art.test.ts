// 일러스트 파일 규칙과 외형(form) 추적, Lv3 진화 모습 선택
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { artCandidates, artKey } from '../src/data/art.ts';
import { leaderForm } from '../src/data/leaders.ts';
import { beginDay } from '../src/game/run.ts';
import { chooseForm, chooseUnitGrowth, mergeAll } from '../src/game/shop.ts';
import { createRun, toSnapshot } from '../src/game/state.ts';
import type { OwnedUnit } from '../src/game/state.ts';
import { buildManifest } from '../tools/artPlugin.ts';

const fresh = () => {
  const s = createRun('knight', 1, 'art-test');
  beginDay(s);
  return s;
};
const lv2 = (uid: number, form?: string, growth: string[] = []): OwnedUnit => ({ uid, defId: 'skeleton', level: 2, growth, ...(form ? { form } : {}) });

test('파일 이름 규칙과 대체 순서', () => {
  assert.equal(artKey({ kind: 'monsters', id: 'slime' }), 'monsters/slime');
  assert.equal(artKey({ kind: 'monsters', id: 'slime', level: 2, form: 'slime_jelly' }), 'monsters/slime.lv2.slime_jelly');
  assert.equal(artKey({ kind: 'monsters', id: 'slime', level: 1, form: 'x' }), 'monsters/slime'); // Lv1에는 형태가 없다
  assert.deepEqual(artCandidates({ kind: 'monsters', id: 'skeleton', level: 3, form: 'skel_knight' }), [
    'monsters/skeleton.lv3.skel_knight',
    'monsters/skeleton.lv2.skel_knight',
    'monsters/skeleton.lv3',
    'monsters/skeleton.lv2',
    'monsters/skeleton',
  ]);
  assert.deepEqual(artCandidates({ kind: 'trinkets', id: 'rusty_ring' }), ['trinkets/rusty_ring']);
  assert.equal(leaderForm('knight', ['k_atk', 'k_beastmaster', 'k_haste']), 'k_beastmaster');
  assert.equal(leaderForm('knight', ['k_atk']), undefined);
});

test('Lv2 성장 선택: 외형 변화 성장이면 형태가 바뀌고, 아니면 기본 형태', () => {
  const s = fresh();
  s.board[0] = { uid: 1, defId: 'skeleton', level: 2 };
  s.unitGrowth = [{ uid: 1, level: 2, choices: ['u_might', 'skel_knight'] }];
  s.phase = 'unitGrowth';
  chooseUnitGrowth(s, 1);
  assert.equal(s.board[0]!.form, 'skel_knight');
  assert.equal(toSnapshot(s, 'x').board.find((e) => e.defId === 'skeleton')?.form, 'skel_knight');

  s.board[1] = { uid: 2, defId: 'skeleton', level: 2 };
  s.unitGrowth = [{ uid: 2, level: 2, choices: ['u_might'] }];
  s.phase = 'unitGrowth';
  chooseUnitGrowth(s, 0);
  assert.equal(s.board[1]!.form, undefined);
  assert.equal(s.phase, 'shop');
});

test('Lv3 합성: 모습이 모두 같으면 그대로, 다르면 진화 모습을 고른다', () => {
  const same = fresh();
  same.board[0] = lv2(1, 'skel_knight');
  same.bench[0] = lv2(2, 'skel_knight');
  same.bench[1] = lv2(3, 'skel_knight');
  mergeAll(same);
  assert.equal(same.board[0]!.form, 'skel_knight');
  assert.equal(same.formChoices?.length ?? 0, 0);

  const mixed = fresh();
  mixed.board[0] = lv2(1);
  mixed.bench[0] = lv2(2, 'skel_knight');
  mixed.bench[1] = lv2(3);
  mergeAll(mixed);
  assert.equal(mixed.board[0]!.level, 3);
  assert.deepEqual(mixed.formChoices, [{ uid: 1, options: ['', 'skel_knight'] }]);
  mixed.phase = 'unitGrowth';
  assert.ok(chooseForm(mixed, 1).ok);
  assert.equal(mixed.board[0]!.form, 'skel_knight');
  assert.equal(mixed.phase, 'shop');
});

test('Lv2 선택 전에 Lv3으로 연쇄 합성되면, 고른 외형도 진화 후보가 된다', () => {
  const s = fresh();
  s.board[0] = lv2(1);
  s.bench[0] = lv2(2);
  s.bench[1] = lv2(3);
  s.unitGrowth = [{ uid: 3, level: 2, choices: ['skel_knight'] }]; // 3번은 막 Lv2가 되어 아직 고르지 않음
  mergeAll(s);
  assert.equal(s.unitGrowth[0].uid, 1); // 선택이 남는 유닛으로 넘어감
  assert.equal(s.formChoices?.length ?? 0, 0); // 모두 기본 형태라 아직 선택 없음
  s.phase = 'unitGrowth';
  chooseUnitGrowth(s, 0);
  assert.deepEqual(s.formChoices, [{ uid: 1, options: ['', 'skel_knight'] }]);
  assert.equal(s.phase, 'unitGrowth'); // 진화 모습 선택이 남아 있다
});

test('art 폴더 목록(manifest)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-'));
  try {
    mkdirSync(join(dir, 'monsters'));
    writeFileSync(join(dir, 'monsters', 'slime.png'), 'x');
    writeFileSync(join(dir, 'monsters', 'slime.lv2.slime_jelly.webp'), 'x');
    writeFileSync(join(dir, 'monsters', 'notes.txt'), 'x');
    const m = buildManifest(dir);
    assert.deepEqual(Object.keys(m).sort(), ['monsters/slime', 'monsters/slime.lv2.slime_jelly']);
    assert.match(m['monsters/slime'], /^monsters\/slime\.png\?v=\d+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
