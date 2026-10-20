// 정화(아군의 해로운 상태)·해주(상대의 이로운 상태), 상태 간 상호작용(화상 → 가시)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { BattleResult, BoardEntry, TeamSnapshot } from '../src/battle/types.ts';
import { describeEffect, describeStatus } from '../src/data/describe.ts';
import { applyMod, DEFAULT_MOD, parseMod, snapshotMod } from '../src/data/registry.ts';
import type { Effect, StatusId, TrinketDef } from '../src/data/types.ts';
import { validateMod } from '../src/data/validate.ts';

const team = (board: BoardEntry[], trinkets: string[] = []): TeamSnapshot => ({ name: 't', leaderId: 'knight', leaderLevel: 1, growth: [], board, trinkets });
const mon = (slot: number, defId: string): BoardEntry => ({ slot, kind: 'monster', defId, level: 1 });

// 전투 시작에 팀 상태를 거는 장신구 + 행동할 때 효과를 내는 시험 몬스터로 실행
function run(start: { status: StatusId; n: number; to: 'ally' | 'enemy' }[], act: Effect[], enemyStart: { status: StatusId; n: number; to: 'ally' | 'enemy' }[] = []): BattleResult {
  const mod = snapshotMod('cleanse-test');
  const trinket = (id: string, list: typeof start): TrinketDef => ({
    id, name: id, grade: 1, desc: '', triggers: [{ on: 'battleStart', effects: list.map((x) => ({ type: 'status', status: x.status, flat: x.n, to: x.to })) }],
  });
  mod.trinkets.push(trinket('t_me', start), trinket('t_foe', enemyStart));
  mod.monsters.push({ id: 'test_c', name: '정화사', grade: 1, tags: [], hp: 3000, atk: 0, intervalTicks: 20, desc: '', triggers: [{ on: 'act', effects: act }] });
  applyMod(mod);
  try {
    return simulateBattle({ player: team([mon(5, 'test_c')], ['t_me']), enemy: team([mon(5, 'guardian')], ['t_foe']), env: 'normal', day: 1, seed: 1 });
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
}
const statusAfter = (r: BattleResult, note: string) => r.events.filter((e) => e.type === 'status' && e.note === note);

test('정화: 아군의 해로운 상태를 중첩 비율로 줄인다 (많이 쌓일수록 많이 깎임)', () => {
  // 상대가 나에게 독 40·화상 3을 건 상황 (내 장신구로 나에게 걸어 재현)
  const r = run([{ status: 'poison', n: 40, to: 'ally' }, { status: 'burn', n: 3, to: 'ally' }, { status: 'regen', n: 10, to: 'ally' }], [{ type: 'cleanse', pct: 25 }]);
  const cut = statusAfter(r, '정화: 독')[0];
  assert.ok(cut && (cut.amount ?? 0) < 0);
  // 첫 정화 직전 독 중첩의 25%(내림)를 지운다
  const before = (cut.after ?? 0) - (cut.amount ?? 0);
  assert.equal(-(cut.amount ?? 0), Math.floor(before * 0.25));
  assert.equal(statusAfter(r, '정화: 재생').length, 0); // 이로운 상태는 건드리지 않는다
});

test('해주: 상대의 이로운 상태, 가장 많이 쌓인 하나만', () => {
  const r = run([], [{ type: 'dispel', pct: 50, scope: 'largest' }], [{ status: 'regen', n: 20, to: 'ally' }, { status: 'thorns', n: 6, to: 'ally' }, { status: 'poison', n: 9, to: 'enemy' }]);
  const first = r.events.find((e) => e.type === 'status' && e.note?.startsWith('해주'))!;
  assert.equal(first.note, '해주: 재생');
  assert.equal(first.amount, -10);
  assert.equal(first.target, 'team1');
});

test('상호작용: 화상이 터질 때마다 같은 팀의 가시를 화상 중첩 × 50%만큼 줄인다', () => {
  const r = run([{ status: 'burn', n: 8, to: 'enemy' }], [], [{ status: 'thorns', n: 10, to: 'ally' }]);
  const erode = statusAfter(r, '화상→가시');
  assert.equal(erode[0].amount, -4); // 화상 8 × 50%
  assert.equal(erode[0].after, 6);
  assert.equal(erode[1].amount, -3); // 다음 틱: 화상 7 × 50% = 3
});

test('설명·설정: 상호작용 계수는 상태 설정에 있고, 예전 모드에도 기본값이 들어간다', () => {
  assert.match(describeStatus('burn'), /같은 팀의 가시를 중첩 × 50%만큼 줄임/);
  assert.match(describeEffect({ type: 'cleanse', pct: 25 }), /^정화: 아군의 해로운 상태\(독·화상·괴사\) 중첩 25% 제거$/);
  assert.match(describeEffect({ type: 'dispel', pct: 30, scope: 'largest' }), /가장 많이 쌓인 상대의 이로운 상태/);
  const old = structuredClone(DEFAULT_MOD) as unknown as { balance: { statuses: Record<string, Record<string, unknown>> } };
  for (const cfg of Object.values(old.balance.statuses)) {
    delete cfg.erodeStatus;
    delete cfg.erodePct;
  }
  old.balance.statuses.burn.perStack = 2; // 직접 고친 값은 유지
  const mod = parseMod(JSON.stringify(old));
  assert.equal(mod.balance.statuses.burn.erodeStatus, 'thorns');
  assert.equal(mod.balance.statuses.burn.erodePct, 50);
  assert.equal(mod.balance.statuses.burn.perStack, 2);
});

test('검증: 50% 넘는 정화는 경고, 없는 상태로의 상호작용은 오류', () => {
  const mod = structuredClone(DEFAULT_MOD);
  mod.trinkets.push({ id: 'big', name: '큰 정화', grade: 1, desc: '', triggers: [{ on: 'timer', atSec: 5, effects: [{ type: 'cleanse', pct: 80 }] }] });
  assert.ok(validateMod(mod).warnings.some((w) => w.includes('50%')));
  (mod.balance.statuses.burn as { erodeStatus: string }).erodeStatus = 'nope';
  assert.ok(validateMod(mod).errors.some((e) => e.includes('줄일 상태')));
});
