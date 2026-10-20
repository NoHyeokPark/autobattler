// 상대 리더 대사, 몬스터 대사(처음 구매·최고 레벨), 능력 말풍선
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { leaderVoice } from '../src/data/leaders.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { beginDay } from '../src/game/run.ts';
import { buy } from '../src/game/shop.ts';
import { createRun } from '../src/game/state.ts';

test('상대일 때 대사: 쓴 칸만 바뀌고 비운 칸은 플레이어일 때 대사', () => {
  const mod = snapshotMod('rival');
  const knight = mod.leaders.find((l) => l.id === 'knight')!;
  knight.rivalLines = { battleStart: '네가 내 앞을 막는다고?' };
  applyMod(mod);
  try {
    const v = leaderVoice('knight', []);
    assert.equal(v.lines.battleStart, '간다. 뒤처지지 마.');
    assert.equal(v.rival.battleStart, '네가 내 앞을 막는다고?');
    assert.equal(v.rival.win, '오늘도 지켜냈다.'); // 비운 칸
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('몬스터 대사: 이번 런에서 처음 샀을 때 한 번, 최고 레벨이 됐을 때', () => {
  const mod = snapshotMod('mon-lines');
  mod.monsters.find((m) => m.id === 'slime')!.lines = { buy: '말랑!', maxLevel: '커다래졌어!' };
  applyMod(mod);
  try {
    const s = createRun('knight', 1, 'mon-lines');
    beginDay(s);
    s.gold = 100;
    s.bench = s.bench.map(() => null);
    s.board = s.board.map((u) => (u?.leader ? u : null));
    const buySlime = () => {
      s.shop = [{ kind: 'monster', defId: 'slime' }];
      buy(s, 0);
      if (s.phase === 'unitGrowth') s.unitGrowth = [], (s.phase = 'shop');
    };
    buySlime();
    assert.deepEqual(s.voices, [{ defId: 'slime', kind: 'buy' }]);
    delete s.voices;
    for (let k = 0; k < 8; k++) buySlime(); // 9장 = Lv3
    assert.deepEqual(s.voices, [{ defId: 'slime', kind: 'maxLevel' }]); // 처음 구매 대사는 다시 안 나온다
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('능력 말풍선: 트리거가 발동할 때, 상태 소모는 성공했을 때만', () => {
  const mod = snapshotMod('say');
  mod.monsters.push({
    id: 'test_say', name: '마법소녀', grade: 1, tags: [], hp: 3000, atk: 5, intervalTicks: 20, desc: '',
    triggers: [
      { on: 'battleStart', say: '변신!', effects: [{ type: 'status', status: 'hope', flat: 3, to: 'ally' }] },
      { on: 'act', effects: [{ type: 'consume', status: 'hope', cost: 3, say: '희망의 빛이여!', effects: [{ type: 'damage', flat: 10 }] }] },
    ],
  });
  applyMod(mod);
  try {
    const team = (b: BoardEntry[]): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board: b, trinkets: [] });
    const r = simulateBattle({ player: team([{ slot: 5, kind: 'monster', defId: 'test_say', level: 1 }]), enemy: team([{ slot: 5, kind: 'monster', defId: 'guardian', level: 1 }]), env: 'normal', day: 1, seed: 1 });
    const says = r.events.filter((e) => e.type === 'say').map((e) => [e.src, e.note]);
    assert.deepEqual(says, [['0-5', '변신!'], ['0-5', '희망의 빛이여!']]); // 희망 3은 한 번만 소모된다
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});
