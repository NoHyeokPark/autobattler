// 무작위 봇 팀끼리 양 진영으로 붙여 보는 통계. 시뮬레이터(sim.ts)와 웹 에디터가 함께 쓴다.
// dummyLeaderHp를 주면 팀 구성(상점·합성·배치)은 원래 리더로 만든 뒤, 전투에서는 리더를 같은 칸의 더미(행동 없음, 체력만)로 바꾼다.
// 리더의 능력·성장·태그가 빠지므로 몬스터 카드 승률에서 리더 변수가 사라진다.

import { BALANCE } from '../config/balance.ts';
import { simulateBattle } from '../battle/engine.ts';
import type { BattleResult, TeamSnapshot } from '../battle/types.ts';
import { dummyLeaderId } from '../data/leaders.ts';
import { hashSeed, Rng } from '../core/rng.ts';
import type { EnvId } from '../data/types.ts';
import { buildBotTeam } from '../game/bot.ts';

export const ENVS: EnvId[] = ['normal', 'hp', 'atk'];

export interface PairsStats {
  n: number;
  day: number;
  battles: number;
  playerWins: number;
  flips: number; // 진영만 바꿨을 때 승패가 뒤집힌 매치
  lengths: Record<EnvId, number[]>; // 초
  sudden: Record<EnvId, number>;
  instant: Record<EnvId, number>; // t=0 종료
  fast: Record<EnvId, number>; // 3초 안에 종료
  monsters: { id: string; games: number; wins: number }[];
  trinkets: { id: string; games: number; wins: number }[]; // 장신구를 가진 팀의 승률 (같은 장신구 여러 개도 한 번)
  dummyLeaderHp?: number; // 리더를 더미로 바꿔 잰 경우 그 체력
  extraBuckets: { lo: number; hi: number; n: number; acts: number; out: number; wins: number }[];
}

const sideSum = (r: BattleResult, side: 0 | 1, f: (u: BattleResult['units'][number]) => number) =>
  r.units.filter((u) => u.side === side).reduce((s, u) => s + f(u), 0);

// 리더 칸을 더미로 (칸은 그대로, 리더 성장·영구 강화는 뺀다)
export function withDummyLeader(t: TeamSnapshot, hp: number): TeamSnapshot {
  const id = dummyLeaderId(hp);
  return {
    ...t, leaderId: id, leaderLevel: 1, growth: [],
    board: t.board.map((e) => (e.kind === 'leader' ? { slot: e.slot, kind: 'leader', defId: id, level: 1 } : e)),
  };
}

export function runPairs(n: number, day: number, seed: number, opts: { dummyLeaderHp?: number } = {}): PairsStats {
  const TPS = BALANCE.ticksPerSec;
  const rng = new Rng(hashSeed('pairs', seed));
  const dummy = opts.dummyLeaderHp;
  const teams: TeamSnapshot[] = Array.from({ length: n }, (_, i) => {
    const t = buildBotTeam(day, hashSeed('pairs-team', seed, i));
    return dummy ? withDummyLeader(t, dummy) : t;
  });
  const zero = () => ({ normal: 0, hp: 0, atk: 0 });
  const st: PairsStats = {
    n, day, battles: 0, playerWins: 0, flips: 0,
    lengths: { normal: [], hp: [], atk: [] }, sudden: zero(), instant: zero(), fast: zero(),
    monsters: [],
    trinkets: [],
    ...(dummy ? { dummyLeaderHp: dummy } : {}),
    extraBuckets: [[0, 2], [3, 5], [6, 9], [10, 19], [20, Infinity]].map(([lo, hi]) => ({ lo, hi, n: 0, acts: 0, out: 0, wins: 0 })),
  };
  const mon = new Map<string, { games: number; wins: number }>();
  const tri = new Map<string, { games: number; wins: number }>();
  const add = (map: typeof mon, ids: Iterable<string>, won: boolean) => {
    for (const id of new Set(ids)) {
      const m = map.get(id) ?? { games: 0, wins: 0 };
      m.games++;
      if (won) m.wins++;
      map.set(id, m);
    }
  };
  const credit = (team: TeamSnapshot, won: boolean) => {
    add(mon, team.board.filter((e) => e.kind === 'monster').map((e) => e.defId), won);
    add(tri, team.trinkets, won);
  };
  for (let i = 0; i < n && n > 1; i++) {
    const j = (i + 1 + rng.int(n - 1)) % n;
    const env = rng.pick(ENVS);
    const A = teams[i];
    const B = teams[j];
    const r1 = simulateBattle({ player: A, enemy: B, env, day, seed: i });
    const r2 = simulateBattle({ player: B, enemy: A, env, day, seed: i });
    for (const r of [r1, r2]) {
      st.battles++;
      if (r.winner === 0) st.playerWins++;
      st.lengths[env].push(r.endTick / TPS);
      if (r.suddenDeath) st.sudden[env]++;
      if (r.endTick === 0) st.instant[env]++;
      if (r.endTick < 3 * TPS) st.fast[env]++;
      for (const side of [0, 1] as const) {
        const ex = sideSum(r, side, (u) => u.extra);
        const b = st.extraBuckets.find((x) => ex >= x.lo && ex <= x.hi)!;
        b.n++;
        b.acts += sideSum(r, side, (u) => u.acts);
        b.out += sideSum(r, side, (u) => u.damage + u.heal + u.shield);
        if (r.winner === side) b.wins++;
      }
    }
    const aWin1 = r1.winner === 0;
    const aWin2 = r2.winner === 1;
    if (aWin1 !== aWin2) st.flips++;
    credit(A, aWin1);
    credit(B, !aWin1);
    credit(A, aWin2);
    credit(B, !aWin2);
  }
  st.monsters = [...mon.entries()].map(([id, m]) => ({ id, ...m })).sort((a, b) => b.wins / b.games - a.wins / a.games);
  st.trinkets = [...tri.entries()].map(([id, m]) => ({ id, ...m })).sort((a, b) => b.wins / b.games - a.wins / a.games);
  return st;
}
