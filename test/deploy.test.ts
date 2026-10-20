// 몬스터 통솔력(지휘자): 보드에 있는 동안 배치 인원 +N. 옮긴 뒤 기준으로 제한을 확인하고, 봇도 그만큼 더 올린다
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/config/balance.ts';
import { applyMod, DEFAULT_MOD } from '../src/data/registry.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { arrangeBoard } from '../src/game/bot.ts';
import { move, sell } from '../src/game/shop.ts';
import type { OwnedUnit } from '../src/game/state.ts';
import { baseDeployLimit, createRun, deployedCount, deployLimit } from '../src/game/state.ts';

applyMod(structuredClone(DEFAULT_MOD));

let uid = 100;
const unit = (defId: string, level = 1): OwnedUnit => ({ uid: uid++, defId, level });

function fullRun() {
  const s = createRun('knight', 1, 'deploy-test');
  // 리더 + 일반 몬스터로 기본 제한(6)까지 채운다
  const base = BALANCE.board.initialDeployLimit;
  let n = deployedCount(s);
  for (let i = 0; i < 9 && n < base; i++) if (!s.board[i]) { s.board[i] = unit('slime'); n++; }
  return s;
}

test('지휘자는 통솔력 1: 보드에 있으면 배치 인원 +1', () => {
  assert.equal(MONSTER_MAP.conductor.deploy, 1);
  const s = fullRun();
  assert.equal(deployLimit(s), BALANCE.board.initialDeployLimit);
  s.bench[0] = unit('conductor');
  assert.equal(deployLimit(s), BALANCE.board.initialDeployLimit); // 벤치에서는 효과 없음
  const empty = s.board.findIndex((u) => !u);
  assert.ok(move(s, { area: 'bench', index: 0 }, { area: 'board', index: empty }).ok, '꽉 찬 보드에도 지휘자는 올라간다');
  assert.equal(deployLimit(s), BALANCE.board.initialDeployLimit + 1);
  assert.equal(baseDeployLimit(s), BALANCE.board.initialDeployLimit);
  // 다른 유닛은 더 못 올린다
  s.bench[1] = unit('slime');
  const empty2 = s.board.findIndex((u) => !u);
  assert.equal(move(s, { area: 'bench', index: 1 }, { area: 'board', index: empty2 }).ok, false);
});

test('지휘자를 빼면 제한도 함께 줄어든다: 혼자 내리거나 파는 건 되고, 벤치 유닛과 맞바꾸면 넘쳐서 막는다', () => {
  const s = fullRun();
  const at = s.board.findIndex((u) => !u);
  s.board[at] = unit('conductor');
  assert.equal(deployedCount(s), deployLimit(s));
  s.bench[0] = unit('slime');
  const before = JSON.stringify([s.board, s.bench]);
  assert.equal(move(s, { area: 'board', index: at }, { area: 'bench', index: 0 }).ok, false); // 맞바꾸면 7명인데 제한 6
  assert.equal(JSON.stringify([s.board, s.bench]), before, '실패하면 그대로');
  assert.ok(move(s, { area: 'board', index: at }, { area: 'bench', index: 1 }).ok); // 혼자 내리기: 6명, 제한 6
  assert.equal(deployedCount(s), deployLimit(s));
  assert.ok(move(s, { area: 'bench', index: 1 }, { area: 'board', index: at }).ok); // 다시 올리기
  assert.ok(sell(s, { area: 'board', index: at }).ok); // 팔기도 같은 이유로 된다
  // 보드 안에서 자리 바꾸기는 언제나 된다
  const s2 = fullRun();
  const c = s2.board.findIndex((u) => !u);
  s2.board[c] = unit('conductor');
  const m = s2.board.findIndex((u) => u && !u.leader && u.defId !== 'conductor');
  assert.ok(move(s2, { area: 'board', index: c }, { area: 'board', index: m }).ok);
});

test('봇 배치: 지휘자가 있으면 한 명 더 올린다', () => {
  const s = fullRun();
  s.bench[0] = unit('conductor');
  s.bench[1] = unit('goblin');
  s.bench[2] = unit('skeleton');
  arrangeBoard(s);
  assert.ok(s.board.some((u) => u?.defId === 'conductor'));
  assert.equal(deployedCount(s), BALANCE.board.initialDeployLimit + 1);
  assert.equal(deployedCount(s), deployLimit(s));
});
