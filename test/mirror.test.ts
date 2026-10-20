// 거울 정령(따라 하기)과 상점 등장 여부
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import { BALANCE } from '../src/config/balance.ts';
import type { BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { TRINKET_MAP } from '../src/data/trinkets.ts';
import type { MonsterDef } from '../src/data/types.ts';
import { beginDay, incomePreview } from '../src/game/run.ts';
import { buy } from '../src/game/shop.ts';
import { createRun } from '../src/game/state.ts';

const team = (board: BoardEntry[]): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets: [] });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });

test('거울 정령: 같은 칸 상대의 행동을 (추가발동까지) 내 능력치로 따라 하고, 골드·영구 강화도 내 편이 얻는다', () => {
  const mod = snapshotMod('mirror');
  const foe: MonsterDef = {
    id: 't_foe', name: '상대', grade: 1, tags: [], hp: 3000, atk: 10, intervalTicks: 20, extra: 2, desc: '',
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }, { type: 'gold', amount: 1 }, { type: 'permanent', target: { side: 'ally', area: 'all' }, stat: 'atk', amount: 1 }] }],
  };
  mod.monsters.push(foe);
  applyMod(mod);
  try {
    const r = simulateBattle({ player: team([mon(5, 'mirror_spirit')]), enemy: team([mon(5, 't_foe'), mon(1, 'guardian')]), env: 'normal', day: 1, seed: 1 });
    const foeActs = r.events.filter((e) => e.type === 'act' && e.src === '1-5').length;
    const reacts = r.events.filter((e) => e.type === 'react' && e.src === '0-5');
    assert.ok(foeActs >= 6);
    // 추가발동 2 → 행동 한 번에 3번 따라 함 (마지막 한 번은 그 행동으로 전투가 끝나면 따라 할 틈이 없다)
    assert.ok(reacts.length === foeActs || reacts.length === foeActs - 1, `${reacts.length} / ${foeActs}`);
    assert.ok(reacts.every((e) => e.target === '1-5')); // 대각선의 수호자(1번 칸)는 따라 하지 않는다
    const mirrorHits = r.events.filter((e) => e.type === 'damage' && e.src === '0-5').map((e) => e.amount);
    assert.equal(mirrorHits.length, reacts.length);
    // 내 공격력 24로 (상대 공격력 10이 아니라). 따라 한 "아군 공격력 영구 +1"이 피해 다음에 붙어서 한 번에 1씩 오른다
    assert.deepEqual(mirrorHits, mirrorHits.map((_, i) => MONSTER_MAP.mirror_spirit.atk + i));
    // 골드·영구 강화도 따라 해서 거울 정령 편(플레이어)이 얻는다: 따라 한 횟수만큼
    assert.equal(r.gains[0].gold, Math.min(reacts.length, BALANCE.battleGains.maxGoldPerBattle));
    assert.deepEqual(r.gains[0].permanent, [{ slot: 5, stat: 'atk', amount: reacts.length }]); // 대상 "아군 전체" = 내 편 (거울 정령 자신)
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('상점 등장 여부: 상점에 나오지 않는 몬스터·장신구는 상점·보상 뽑기에 나오지 않는다', () => {
  const mod = snapshotMod('noshop');
  for (const m of mod.monsters) if (m.grade === 1 && m.id !== 'slime') m.shop = false; // 일반은 슬라임만 상점에
  for (const t of mod.trinkets) if (t.id === 'rusty_ring') t.shop = false;
  applyMod(mod);
  try {
    for (let seed = 1; seed <= 200; seed++) {
      const s = createRun('knight', seed, `n${seed}`);
      beginDay(s);
      for (const it of s.shop) {
        if (!it) continue;
        if (it.kind === 'monster' && MONSTER_MAP[it.defId].grade === 1) assert.equal(it.defId, 'slime');
        if (it.kind === 'trinket') assert.notEqual(TRINKET_MAP[it.defId].id, 'rusty_ring');
      }
    }
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});

test('내일 수입 미리보기: 지금 골드 기준 이자, 다음 이자까지 남은 골드', () => {
  const s = createRun('knight', 1, 'inc');
  s.gold = 27;
  const p = incomePreview(s);
  assert.deepEqual([p.base, p.interest, p.bonus, p.nextAt], [10, 2, 0, 3]);
  s.gold = 80;
  assert.equal(incomePreview(s).interest, 5);
  assert.equal(incomePreview(s).nextAt, undefined); // 최대
});

test('기원 획득 알림: 상점 구매(몬스터·장신구), 변이로 기원이 되면', () => {
  const mod = snapshotMod('origin-note');
  mod.trinkets.push({ id: 't_origin', name: '시험 기원 장신구', grade: 7, desc: '시험', triggers: [] });
  applyMod(mod);
  try {
    const s = createRun('knight', 3, 'origin-note');
    beginDay(s);
    s.gold = 200;
    const notes = () => (s.voices ?? []).filter((v) => v.kind === 'origin').map((v) => [v.defId, !!v.trinket]);
    s.shop = [{ kind: 'monster', defId: 'mirror_spirit' }, { kind: 'trinket', defId: 't_origin' }];
    buy(s, 0);
    buy(s, 1);
    assert.deepEqual(notes(), [['mirror_spirit', false], ['t_origin', true]]);
    // 신화 → 혼돈의 주사위 → 기원(거울 정령)
    s.voices = [];
    s.board = s.board.map((u) => (u?.leader ? u : null));
    s.bench = s.bench.map(() => null);
    s.board[0] = { uid: 900, defId: 'primordial', level: 1 };
    s.shop = [{ kind: 'trinket', defId: 'chaos_die' }];
    buy(s, 0);
    const became = s.board[0]!.defId;
    assert.equal(MONSTER_MAP[became].grade, 7); // 기원 중 무작위 (거울 정령·지휘자)
    assert.deepEqual(notes(), [[became, false]]);
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});
