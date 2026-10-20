// 밸런스 테스트 (src/sim/partyTest.ts): 리더 없는 파티, 상대 리더 빼기, 빈 성장 채우기, 양 진영 측정, 교체 비교
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateBattle } from '../src/battle/engine.ts';
import type { TeamSnapshot } from '../src/battle/types.ts';
import { maxGrowthCount } from '../src/data/growth.ts';
import { applyMod, DEFAULT_MOD, snapshotMod } from '../src/data/registry.ts';
import { buildFoes, DEFAULT_OPTS, fillGrowth, hasLeader, missingIn, runPartyTest, stripLeader, swapCandidates, winPct, withSlot } from '../src/sim/partyTest.ts';

applyMod(DEFAULT_MOD);

const noLeader: TeamSnapshot = {
  name: '몬스터만', leaderId: '', leaderLevel: 1, growth: [], trinkets: [],
  board: [{ slot: 4, kind: 'monster', defId: 'slime', level: 2 }, { slot: 5, kind: 'monster', defId: 'goblin', level: 1 }, { slot: 6, kind: 'monster', defId: 'skeleton', level: 3 }],
};

test('리더 없는 팀도 전투할 수 있다', () => {
  const r = simulateBattle({ player: noLeader, enemy: stripLeader(noLeader), env: 'normal', day: 3, seed: 1 });
  assert.ok(r.units.every((u) => !u.isLeader));
  assert.equal(r.units.filter((u) => u.side === 0).length, 3);
  assert.ok(r.endTick > 0);
});

test('상대 리더·장신구 빼기', () => {
  const foes = buildFoes({ day: 6, n: 4, seed: 1, foeLeader: false, foeTrinkets: false });
  for (const f of foes) {
    assert.ok(!f.board.some((e) => e.kind === 'leader'));
    assert.equal(f.leaderId, '');
    assert.deepEqual(f.growth, []);
    assert.deepEqual(f.trinkets, []);
    assert.ok(!hasLeader(f));
  }
  // 나눠 만들어도 같은 팀
  const all = buildFoes({ day: 6, n: 4, seed: 1, foeLeader: true, foeTrinkets: true });
  const parts = [...buildFoes({ day: 6, n: 4, seed: 1, foeLeader: true, foeTrinkets: true }, 0, 2), ...buildFoes({ day: 6, n: 4, seed: 1, foeLeader: true, foeTrinkets: true }, 2, 4)];
  assert.deepEqual(parts, all);
  assert.ok(all.every(hasLeader));
});

test('빈 성장 채우기: Lv2는 1개, Lv3은 3개, 이미 고른 것은 그대로', () => {
  const t = fillGrowth({ ...noLeader, board: [...noLeader.board, { slot: 1, kind: 'monster', defId: 'goblin', level: 2, growth: ['u_tough'] }] }, 3);
  const by = (slot: number) => t.board.find((e) => e.slot === slot)!;
  assert.equal(by(4).growth?.length, maxGrowthCount(2));
  assert.equal(by(5).growth, undefined);
  assert.equal(by(6).growth?.length, maxGrowthCount(3));
  assert.deepEqual(by(1).growth, ['u_tough']);
  // 칸 순서가 달라도 같은 성장
  const rev = fillGrowth({ ...noLeader, board: [...noLeader.board].reverse() }, 3);
  for (const e of rev.board) assert.deepEqual(e.growth, t.board.find((x) => x.slot === e.slot)!.growth);
});

test('몬스터 전직이 있으면 Lv3에 전직 하나를 고른다', () => {
  const mod = snapshotMod('promo');
  const slime = mod.monsters.find((m) => m.id === 'slime')!;
  slime.promotions = [{ id: 'p_a', name: 'A', desc: '', repeatable: false }, { id: 'p_b', name: 'B', desc: '', repeatable: false }];
  applyMod(mod);
  try {
    const t = fillGrowth({ ...noLeader, board: [{ slot: 5, kind: 'monster', defId: 'slime', level: 3 }] }, 1);
    const g = t.board[0].growth ?? [];
    assert.equal(g.filter((id) => id === 'p_a' || id === 'p_b').length, 1);
    assert.equal(g.length, maxGrowthCount(3) + 1);
  } finally {
    applyMod(DEFAULT_MOD);
  }
});

test('양 진영으로 2n전, 같은 설정이면 같은 결과', () => {
  const o = { ...DEFAULT_OPTS, day: 4, n: 6, foeLeader: false };
  const foes = buildFoes(o);
  const a = runPartyTest(noLeader, foes, o);
  const b = runPartyTest(noLeader, foes, o);
  assert.equal(a.battles, 12);
  assert.deepEqual(a, b);
  assert.deepEqual(a.units.map((u) => u.slot), [4, 5, 6]);
  assert.equal(a.byFoeLeader.length, 1);
  assert.equal(a.byFoeLeader[0].leaderId, '');
  // 나눠서 돌려도 같다
  const c = runPartyTest(noLeader, foes, o, undefined, 0, 3);
  runPartyTest(noLeader, foes, o, c, 3, 6);
  assert.equal(winPct(c), winPct(a));
});

test('교체 비교: 칸 바꾸기·비우기, 리더 칸은 그대로', () => {
  const withL: TeamSnapshot = { ...noLeader, leaderId: 'knight', board: [...noLeader.board, { slot: 2, kind: 'leader', defId: 'knight', level: 1 }] };
  assert.equal(withSlot(withL, 5, 'skeleton', 2).board.find((e) => e.slot === 5)?.defId, 'skeleton');
  assert.equal(withSlot(withL, 5, '', 1).board.some((e) => e.slot === 5), false);
  assert.equal(withSlot(withL, 2, 'slime', 1), withL);
  assert.equal(withSlot(withL, 9, 'slime', 1).board.length, 5);
  assert.ok(swapCandidates(1, 1).length > 0);
  assert.deepEqual(missingIn({ ...noLeader, board: [{ slot: 1, kind: 'monster', defId: 'nope', level: 1 }] }), ['nope']);
});

test('플레이 기록 상대: 같은 모드·규칙 버전·일반 풀·일차 범위·재현 가능한 기록만', async () => {
  const { BALANCE } = await import('../src/config/balance.ts');
  const { recordTeams, recordFoes } = await import('../src/sim/partyTest.ts');
  const team = buildFoes({ day: 5, n: 1, seed: 2, foeLeader: true, foeTrinkets: true })[0];
  const rec = (id: string, over: object) => ({
    id, runId: id, ruleVersion: BALANCE.ruleVersion, mod: 'M', day: 5, env: 'normal' as const, nodeKind: 'normal' as const, pool: 'main' as const,
    team, wins: 0, losses: 0, rankScore: null, mmr: null, exposures: 0, recordWins: 0, ...over,
  });
  const store = { records: [
    rec('ok', {}), rec('legacy', { mod: undefined }), rec('other', { mod: 'X' }), rec('old', { ruleVersion: -1 }), rec('ext', { pool: 'ext' }),
    rec('d6', { day: 6 }), rec('broken', { team: { ...team, board: [{ slot: 1, kind: 'monster', defId: 'nope', level: 1 }] } }),
  ] };
  const o = { ...DEFAULT_OPTS, day: 5, recordDays: 0, n: 5 };
  assert.equal(recordTeams(store, 'M', o).length, 2); // ok + 모드 표시 없는 예전 기록
  assert.equal(recordTeams(store, 'M', { ...o, recordDays: 1 }).length, 3);
  assert.ok(recordTeams(store, 'M', { ...o, foeLeader: false }).every((t) => !hasLeader(t)));
  // 기록이 적으면 반복해서 최소 수를 채운다
  assert.equal(recordFoes(store, 'M', o).length, 6);
  assert.equal(recordFoes(store, 'M', { ...o, day: 9 }).length, 0);
});

test('리그전: 두 팀의 승률 합은 100%, 리그 승률은 상대마다 같은 비중', async () => {
  const { runMatchup, leagueTotals } = await import('../src/sim/partyTest.ts');
  const o = { ...DEFAULT_OPTS, day: 4, fillGrowth: false };
  const [a, b] = buildFoes({ day: 4, n: 2, seed: 5, foeLeader: true, foeTrinkets: true });
  const ab = runMatchup(a, b, o, 3, 'x');
  const ba = runMatchup(b, a, o, 3, 'x');
  assert.equal(ab.battles, 6);
  assert.equal(ab.winsA + ba.winsA, 6);
  assert.deepEqual(leagueTotals({ names: ['a', 'b', 'c'], cells: [[null, 100, 50], [0, null, 20], [50, 80, null]] }), [75, 10, 65]);
  assert.deepEqual(leagueTotals({ names: ['a', 'b'], cells: [[null, 100], [0, null]], vsRecords: [0, 40] }), [50, 20]);
});

test('양쪽 리더 빼기: 내 파티와 상대 모두 리더 없이, 비교 모드는 두 번', async () => {
  const { leaderRuns } = await import('../src/sim/partyTest.ts');
  const o = { ...DEFAULT_OPTS, day: 5, n: 3, noLeaders: true };
  const foes = buildFoes(o);
  const mine = foes[0];
  assert.ok(hasLeader(mine));
  const r = runPartyTest(mine, foes, o);
  assert.ok(r.units.every((u) => !u.leader));
  // 상대 리더별 집계는 원래 상대 리더로
  assert.ok(r.byFoeLeader.every((b) => b.leaderId !== ''));
  // 리더를 직접 뺀 것과 같다
  const same = runPartyTest(stripLeader(mine), foes.map(stripLeader), { ...o, noLeaders: false });
  assert.equal(winPct(r), winPct(same));
  assert.deepEqual(leaderRuns({ ...o, leaderMode: 'both' }).map((x) => !!x.noLeaders), [false, true]);
  assert.deepEqual(leaderRuns({ ...o, leaderMode: 'none' }).map((x) => !!x.noLeaders), [true]);
  assert.deepEqual(leaderRuns({ ...o, leaderMode: undefined }).map((x) => !!x.noLeaders), [false]);
});

test('영구 성장 누적: 시작 일차부터 기준 일차 전날까지 하루 한 전투씩, 적어 둔 영구 강화 위에 더한다', async () => {
  const { prepareParty, accumTotals } = await import('../src/sim/partyTest.ts');
  const team: TeamSnapshot = {
    ...noLeader,
    board: [
      { slot: 4, kind: 'monster', defId: 'slime', level: 2, growth: ['u_growing'], bonus: { atk: 2 } }, // 전투 시작 시 자신 공격력 영구 +1
      { slot: 5, kind: 'monster', defId: 'goblin', level: 1 },
    ],
  };
  const o = { ...DEFAULT_OPTS, day: 6, accumFrom: 3, fillGrowth: false };
  const r = prepareParty(team, o, new Map());
  assert.deepEqual(r.accum?.map((d) => d.day), [3, 4, 5]);
  assert.deepEqual(r.team.board.find((e) => e.slot === 4)?.bonus, { atk: 5 });
  assert.equal(r.team.board.find((e) => e.slot === 5)?.bonus, undefined);
  assert.deepEqual(accumTotals(r.accum!).get(4), { atk: 3 });
  // 끄거나 시작이 기준 일차 이후면 그대로
  assert.equal(prepareParty(team, { ...o, accumFrom: 0 }).team, team);
  assert.equal(prepareParty(team, { ...o, accumFrom: 6 }).accum, undefined);
  // 측정 결과에 붙인 파티와 누적 내역이 남는다 (나눠 돌려도 한 번만 누적)
  const foes = buildFoes({ ...o, n: 2 });
  const acc = runPartyTest(team, foes, o, undefined, 0, 1);
  const prepared = acc.prepared;
  runPartyTest(team, foes, o, acc, 1, 2);
  assert.equal(acc.prepared, prepared);
  assert.deepEqual(acc.prepared?.board.find((e) => e.slot === 4)?.bonus, { atk: 5 });
});

test('더미 리더: 행동하지 않고 체력만 있는 유닛 (어느 칸이든), 봇 통계에서 리더를 더미로 바꿀 수 있다', async () => {
  const { dummyLeaderId } = await import('../src/data/leaders.ts');
  const { runPairs, withDummyLeader } = await import('../src/sim/pairs.ts');
  for (const slot of [1, 3, 5, 9]) {
    const t: TeamSnapshot = { ...noLeader, leaderId: dummyLeaderId(500), board: [...noLeader.board.filter((e) => e.slot !== slot), { slot, kind: 'leader', defId: dummyLeaderId(500), level: 1 }] };
    const r = simulateBattle({ player: t, enemy: t, env: 'normal', day: 1, seed: 1 });
    const d = r.units.find((u) => u.side === 0 && u.isLeader)!;
    assert.equal(d.base.hp, 500);
    assert.equal(d.acts, 0);
    assert.equal(r.events.filter((e) => e.type === 'act' && e.src === d.uid).length, 0);
  }
  const bot = buildFoes({ day: 6, n: 1, seed: 3, foeLeader: true, foeTrinkets: true })[0];
  const dt = withDummyLeader(bot, 300);
  assert.deepEqual(dt.growth, []);
  assert.equal(dt.board.find((e) => e.kind === 'leader')?.defId, '__dummy:300');
  assert.equal(dt.board.find((e) => e.kind === 'leader')?.slot, bot.board.find((e) => e.kind === 'leader')?.slot);
  const st = runPairs(6, 5, 1, { dummyLeaderHp: 500 });
  assert.equal(st.dummyLeaderHp, 500);
  assert.equal(st.battles, 12);
});

test('장신구 비교: 전투 능력이 있는 장신구만 후보, 더하기·하나만, 빠른 통계에 장신구 승률', async () => {
  const { trinketCandidates, withTrinket, battleTrinket } = await import('../src/sim/partyTest.ts');
  const { TRINKETS } = await import('../src/data/trinkets.ts');
  const { runPairs } = await import('../src/sim/pairs.ts');
  const all = trinketCandidates(1, 7, false);
  assert.ok(all.length > 0);
  assert.ok(all.every(battleTrinket));
  assert.ok(TRINKETS.some((t) => !battleTrinket(t.id)), '경제·일회성 장신구는 빠진다');
  const t = { ...noLeader, trinkets: ['a'] };
  assert.deepEqual(withTrinket(t, 'b', 'add').trinkets, ['a', 'b']);
  assert.deepEqual(withTrinket(t, 'b', 'solo').trinkets, ['b']);
  assert.deepEqual(withTrinket(t, '', 'add').trinkets, ['a']);
  assert.deepEqual(withTrinket(t, '', 'solo').trinkets, []);
  const st = runPairs(30, 8, 2);
  assert.ok(st.trinkets.length > 0);
  assert.ok(st.trinkets.every((x) => x.games > 0 && x.wins <= x.games));
});
