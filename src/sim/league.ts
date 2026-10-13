// 봇 리그: 봇이 실제 게임 규칙대로 런을 돌리며 기록 풀을 쌓는다.
// 시뮬레이터(sim.ts)와 웹(기록 풀 생성 버튼)이 함께 쓴다.

import { BALANCE } from '../config/balance.ts';
import { hashSeed, Rng } from '../core/rng.ts';
import { LEADERS } from '../data/leaders.ts';
import type { EnvId } from '../data/types.ts';
import { botGrowth, botNode, botRewardChoice, botShop, STRATEGIES } from '../game/bot.ts';
import type { Strategy } from '../game/bot.ts';
import { playBattle } from '../game/day.ts';
import type { RecordStore } from '../game/matching.ts';
import { beginDay, chooseExtend, chooseReward, stopExtension } from '../game/run.ts';
import { createRun, deployLimit } from '../game/state.ts';

export interface WinCount {
  n: number;
  wins: number;
}

export interface LeagueStats {
  runs: number;
  // gold·trinkets: 전투 밖 획득 합계, battles: 치른 전투 수, stack: 런 종료 시 보드 최대 영구 공격력 합, earlyOut: 7일차 안에 탈락한 런
  // lateShops·lateGoldLeft: 3패 이상일 때의 상점 단계 수와 그때 쓰지 않고 남긴 골드 합 (올인 타이밍 확인용)
  strategies: Record<Strategy, { runs: number; wins: number; champs: number; score: number; battles: number; gold: number; trinkets: number; stack: number; earlyOut: number; lateShops: number; lateGoldLeft: number }>;
  nodePick: Map<string, number>; // "kind:env"
  stages: Map<string, WinCount>;
  nodeWin: Map<string, WinCount>;
  sideByEnv: Record<EnvId, { n: number; playerWins: number }>;
  emptySlots: number[];
  limit6Boards: number;
}

function inc(m: Map<string, WinCount>, k: string, win: boolean) {
  const v = m.get(k) ?? { n: 0, wins: 0 };
  v.n++;
  if (win) v.wins++;
  m.set(k, v);
}

export function runLeague(store: RecordStore, runs: number, seed: number): LeagueStats {
  const stats: LeagueStats = {
    runs,
    strategies: Object.fromEntries(STRATEGIES.map((s) => [s, { runs: 0, wins: 0, champs: 0, score: 0, battles: 0, gold: 0, trinkets: 0, stack: 0, earlyOut: 0, lateShops: 0, lateGoldLeft: 0 }])) as LeagueStats['strategies'],
    nodePick: new Map(),
    stages: new Map(),
    nodeWin: new Map(),
    sideByEnv: { normal: { n: 0, playerWins: 0 }, hp: { n: 0, playerWins: 0 }, atk: { n: 0, playerWins: 0 } },
    emptySlots: Array(9).fill(0),
    limit6Boards: 0,
  };
  for (let r = 0; r < runs; r++) {
    const strategy = STRATEGIES[r % STRATEGIES.length];
    const leader = LEADERS[Math.floor(r / STRATEGIES.length) % LEADERS.length];
    const rng = new Rng(hashSeed('league', seed, r));
    const s = createRun(leader.id, hashSeed('league-run', seed, r), `sim-${seed}-${r}`);
    beginDay(s);
    for (let guard = 0; guard < 200 && s.phase !== 'ended'; guard++) {
      if (s.phase === 'growth') botGrowth(s, rng, strategy);
      else if (s.phase === 'shop') {
        if (s.extension.active && s.extension.wins >= 2 && rng.chancePct(50)) {
          stopExtension(s);
          continue;
        }
        botShop(s, strategy, rng);
        if (s.losses >= 3) {
          stats.strategies[strategy].lateShops++;
          stats.strategies[strategy].lateGoldLeft += s.gold;
        }
        s.nodeIndex = botNode(s, rng);
        if (deployLimit(s) === BALANCE.board.initialDeployLimit) {
          stats.limit6Boards++;
          s.board.forEach((u, i) => { if (!u) stats.emptySlots[i]++; });
        }
        const node = s.nodes[s.nodeIndex];
        const key = `${node.kind}:${node.env}`;
        stats.nodePick.set(key, (stats.nodePick.get(key) ?? 0) + 1);
        const day = s.day;
        const b = playBattle(s, store);
        const st = stats.strategies[strategy];
        st.battles++;
        st.gold += b.gains?.gold ?? 0;
        st.trinkets += b.gains?.trinkets.length ?? 0;
        inc(stats.stages, b.match.stage, b.win);
        if (node.kind === 'boss') inc(stats.nodeWin, `보스 ${day}일차`, b.win);
        if (node.kind === 'elite') inc(stats.nodeWin, '엘리트', b.win);
        if (node.kind === 'final') inc(stats.nodeWin, '최종 보스', b.win);
        if (b.match.recordId) {
          stats.sideByEnv[node.env].n++;
          if (b.win) stats.sideByEnv[node.env].playerWins++;
        }
      } else if (s.phase === 'reward') {
        chooseReward(s, botRewardChoice(s.rewards[0].options, strategy));
      } else if (s.phase === 'extendChoice') {
        chooseExtend(s, rng.chancePct(50));
      }
    }
    const st = stats.strategies[strategy];
    st.runs++;
    st.wins += s.wins;
    st.score += s.end?.score ?? 0;
    if (s.wins >= BALANCE.run.winTarget) st.champs++;
    st.stack += Math.max(0, ...s.board.map((u) => u?.bonus?.atk ?? 0));
    if (s.losses >= BALANCE.run.lossLimit && s.day <= 7) st.earlyOut++;
  }
  return stats;
}
