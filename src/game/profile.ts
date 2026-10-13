// 리더별 기록: 우승 수, 최고 승수, 자주 쓴 조합, 누적 랭크 점수(랭크·티어는 서비스 단계).

import { MONSTER_MAP } from '../data/monsters.ts';
import type { RunState } from './state.ts';

export interface LeaderRecord {
  runs: number;
  championships: number;
  bestWins: number;
  totalScore: number;
  combos: Record<string, number>;
}

export interface Profile {
  leaders: Record<string, LeaderRecord>;
}

// 조합 키: 최종 보드 몬스터 이름을 정렬해 이은 것
export function comboKey(s: RunState): string {
  const names = s.board
    .filter((u) => u && !u.leader)
    .map((u) => MONSTER_MAP[u!.defId].name)
    .sort();
  return names.join('+') || '(리더 단독)';
}

// 런이 끝났을 때 한 번만 기록한다 (여러 번 불러도 안전).
export function recordRunEnd(p: Profile, s: RunState) {
  if (!s.end || s.profileRecorded) return;
  s.profileRecorded = true;
  const r = (p.leaders[s.leaderId] ??= { runs: 0, championships: 0, bestWins: 0, totalScore: 0, combos: {} });
  r.runs++;
  if (s.wins >= 10) r.championships++;
  r.bestWins = Math.max(r.bestWins, s.wins);
  r.totalScore += s.end.score;
  const key = comboKey(s);
  r.combos[key] = (r.combos[key] ?? 0) + 1;
}

export function topCombos(r: LeaderRecord, n = 3): [string, number][] {
  return Object.entries(r.combos).sort((a, b) => b[1] - a[1]).slice(0, n);
}
