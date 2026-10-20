// 리더 대사: 전직하면 쓴 칸만 바뀌고, 비운 칸은 원래 리더 대사
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaderVoice } from '../src/data/leaders.ts';
import { beginDay, chooseGrowth } from '../src/game/run.ts';
import { createRun } from '../src/game/state.ts';

test('전직 대사는 쓴 칸만 덮어쓴다', () => {
  const base = leaderVoice('knight', []);
  assert.equal(base.quote, '내 뒤에 서. 길은 내가 연다.');
  assert.equal(base.lines.win, '오늘도 지켜냈다.');
  const dk = leaderVoice('knight', ['k_t_deathknight']);
  assert.equal(dk.quote, '죽음 너머에서도 싸움은 계속된다.');
  assert.equal(dk.lines.lowHp, '피가... 부족하군.'); // 전직이 쓴 칸
  assert.equal(dk.lines.win, '오늘도 지켜냈다.'); // 비운 칸은 원래 대사
});

test('전직을 고르면 메시지에 전직 대사가 나온다', () => {
  const s = createRun('knight', 3, 'voice');
  do beginDay(s); while (s.phase !== 'growth');
  chooseGrowth(s, 0);
  do beginDay(s); while (s.phase !== 'growth');
  const i = s.growthChoices.indexOf('k_t_paladin');
  assert.match(chooseGrowth(s, i).msg, /성기사.*“이 방패 뒤로는 아무도 못 지나간다\.”/);
});
