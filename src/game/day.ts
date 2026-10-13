// 준비 완료 → 상대 매칭 → 전투 → 결과 반영을 한 번에 처리한다. UI와 시뮬레이터가 함께 쓴다.

import { BALANCE } from '../config/balance.ts';
import { simulateBattle } from '../battle/engine.ts';
import type { BattleInput, BattleResult } from '../battle/types.ts';
import { hashSeed } from '../core/rng.ts';
import { LEADER_MAP } from '../data/leaders.ts';
import type { MatchResult, RecordStore } from './matching.ts';
import { addRecord, findOpponent, makeRecord, noteRecordResult } from './matching.ts';
import { applyBattle, applyGains, canReady, gainSummaryText } from './run.ts';
import type { GainSummary } from './run.ts';
import { withRng } from './shop.ts';
import type { NodeOption, RunState } from './state.ts';

export interface DayBattle {
  node: NodeOption;
  match: MatchResult;
  input: BattleInput;
  result: BattleResult;
  win: boolean;
  gains?: GainSummary; // 전투 후 런에 반영된 획득 (골드·장신구·영구 강화). 테스트 전투에는 없음
}

export function playBattle(s: RunState, store: RecordStore, playerName?: string): DayBattle {
  const check = canReady(s);
  if (!check.ok) throw new Error(check.msg);
  const node = s.nodes[s.nodeIndex!];
  const rec = makeRecord(s, node, playerName ?? `${LEADER_MAP[s.leaderId].name}의 파티`);
  const match = withRng(s, (rng) => findOpponent(store, s, node, rng));
  addRecord(store, rec);
  const input: BattleInput = {
    player: rec.team,
    enemy: match.team,
    env: node.env,
    day: s.day,
    seed: hashSeed(s.runId, s.day),
  };
  const result = simulateBattle(input);
  const win = result.winner === 0;
  noteRecordResult(store, match.recordId, !win);
  // 승패와 무관하게 먼저 반영한다 (연패하며 스택을 쌓는 빌드)
  const gains = applyGains(s, result.gains[0]);
  applyBattle(s, node, win, {
    opponent: match.team.name,
    matchStage: match.stage,
    seconds: result.endTick / BALANCE.ticksPerSec,
    gains: gainSummaryText(gains) || undefined,
  });
  return { node, match, input, result, win, gains };
}
