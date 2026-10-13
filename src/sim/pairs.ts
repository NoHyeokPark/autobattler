// 무작위 봇 팀끼리 양 진영으로 붙여 보는 통계. 시뮬레이터(sim.ts)와 웹 에디터가 함께 쓴다.

import { BALANCE } from '../config/balance.ts';
import { simulateBattle } from '../battle/engine.ts';
import type { BattleResult, TeamSnapshot } from '../battle/types.ts';
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
  extraBuckets: { lo: number; hi: number; n: number; acts: number; out: number; wins: number }[];
}

const sideSum = (r: BattleResult, side: 0 | 1, f: (u: BattleResult['units'][number]) => number) =>
  r.units.filter((u) => u.side === side).reduce((s, u) => s + f(u), 0);

export function runPairs(n: number, day: number, seed: number): PairsStats {
  const TPS = BALANCE.ticksPerSec;
  const rng = new Rng(hashSeed('pairs', seed));
  const teams: TeamSnapshot[] = Array.from({ length: n }, (_, i) => buildBotTeam(day, hashSeed('pairs-team', seed, i)));
  const zero = () => ({ normal: 0, hp: 0, atk: 0 });
  const st: PairsStats = {
    n, day, battles: 0, playerWins: 0, flips: 0,
    lengths: { normal: [], hp: [], atk: [] }, sudden: zero(), instant: zero(), fast: zero(),
    monsters: [],
    extraBuckets: [[0, 2], [3, 5], [6, 9], [10, 19], [20, Infinity]].map(([lo, hi]) => ({ lo, hi, n: 0, acts: 0, out: 0, wins: 0 })),
  };
  const mon = new Map<string, { games: number; wins: number }>();
  const credit = (team: TeamSnapshot, won: boolean) => {
    for (const id of new Set(team.board.filter((e) => e.kind === 'monster').map((e) => e.defId))) {
      const m = mon.get(id) ?? { games: 0, wins: 0 };
      m.games++;
      if (won) m.wins++;
      mon.set(id, m);
    }
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
  return st;
}
