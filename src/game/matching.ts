// PvP 상대 선정. 상대는 같은 일차에 같은 환경 노드를 고른 플레이어의 기록에서 뽑는다.
//  일반·환경 노드: 같은 일차·같은 환경 → 같은 일차·일반 환경 → 시드 봇
//  엘리트·보스:   일차+1·같은 환경 → 일차+1·일반 환경 → 시드 봇(일차+1)
//  연장 중:       연장 풀 같은 일차·같은 환경 → 연장 풀 같은 일차·일반 → 일반 풀 같은 일차·같은 환경 → 시드 봇
//  최종 보스:     14일차 연장 풀 기록(환경 무관) → 시드 봇(강화)

import { BALANCE } from '../config/balance.ts';
import { hashSeed } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import type { EnvId } from '../data/types.ts';
import type { TeamSnapshot } from '../battle/types.ts';
import { buildBotTeam } from './bot.ts';
import type { NodeOption, RunState } from './state.ts';
import { toSnapshot } from './state.ts';

export interface RecordSnapshot {
  id: string;
  runId: string;
  ruleVersion: number;
  day: number;
  env: EnvId;
  nodeKind: NodeOption['kind'];
  pool: 'main' | 'ext';
  team: TeamSnapshot;
  wins: number;
  losses: number;
  // 랭크 도입 대비 자리만 둔다 (프로토타입에서는 null)
  rankScore: number | null;
  mmr: number | null;
  exposures: number;
  recordWins: number;
}

export interface RecordStore {
  records: RecordSnapshot[];
}

export interface MatchResult {
  team: TeamSnapshot;
  stage: string;
  recordId: string | null;
}

export function makeRecord(s: RunState, node: NodeOption, name: string): RecordSnapshot {
  return {
    id: `${s.runId}-d${s.day}`,
    runId: s.runId,
    ruleVersion: BALANCE.ruleVersion,
    day: s.day,
    env: node.env,
    nodeKind: node.kind,
    pool: s.extension.active ? 'ext' : 'main',
    team: toSnapshot(s, name),
    wins: s.wins,
    losses: s.losses,
    rankScore: null,
    mmr: null,
    exposures: 0,
    recordWins: 0,
  };
}

// MMR 갱신 함수 자리 (서비스 단계에서 구현)
export function updateMmr(_rec: RecordSnapshot, _won: boolean): void {}

const seedBotCache = new Map<string, TeamSnapshot>();

// 데이터(모드)가 바뀌면 시드 봇을 다시 만든다.
export function clearSeedBotCache() {
  seedBotCache.clear();
}

export function seedBot(day: number, env: EnvId, salt: number, strong: boolean): TeamSnapshot {
  const key = `${day}|${env}|${salt}|${strong}`;
  let team = seedBotCache.get(key);
  if (!team) {
    const penalty = strong ? 0 : BALANCE.matching.seedBotIncomePenalty;
    team = buildBotTeam(Math.min(day, BALANCE.run.maxDays), hashSeed('seedbot', day, env, salt, strong ? 1 : 0), { incomePenalty: penalty });
    seedBotCache.set(key, team);
  }
  return team;
}

export function findOpponent(store: RecordStore, s: RunState, node: NodeOption, rng: Rng): MatchResult {
  const base = store.records.filter((r) => r.runId !== s.runId && r.ruleVersion === BALANCE.ruleVersion);
  const query = (pool: 'main' | 'ext', day: number, env: EnvId | null) =>
    base.filter((r) => r.pool === pool && r.day === day && (env === null || r.env === env));
  const pick = (cands: RecordSnapshot[], stage: string): MatchResult | null => {
    if (cands.length === 0) return null;
    const fresh = cands.filter((r) => r.exposures < BALANCE.matching.exposureCap);
    const rec = rng.pick(fresh.length > 0 ? fresh : cands);
    rec.exposures++;
    return { team: rec.team, stage, recordId: rec.id };
  };
  const bot = (day: number, strong: boolean): MatchResult => ({
    team: seedBot(day, node.env, rng.int(4), strong),
    stage: strong ? '시드 봇(강화)' : '시드 봇',
    recordId: null,
  });

  const d = s.day;
  if (node.kind === 'final') {
    return pick(query('ext', d, null), '연장 플레이어 기록') ?? bot(d, true);
  }
  if (s.extension.active) {
    return pick(query('ext', d, node.env), '연장 풀·같은 환경')
      ?? pick(query('ext', d, 'normal'), '연장 풀·일반 환경')
      ?? pick(query('main', d, node.env), '일반 풀·같은 환경')
      ?? bot(d, true);
  }
  const day = node.kind === 'elite' || node.kind === 'boss' ? d + 1 : d;
  const tag = day === d ? '같은 일차' : '일차+1';
  return pick(query('main', day, node.env), `${tag}·같은 환경`)
    ?? pick(query('main', day, 'normal'), `${tag}·일반 환경`)
    ?? bot(day, false);
}

export function noteRecordResult(store: RecordStore, recordId: string | null, recordWon: boolean) {
  if (!recordId) return;
  const rec = store.records.find((r) => r.id === recordId);
  if (!rec) return;
  if (recordWon) rec.recordWins++;
  updateMmr(rec, recordWon);
}

export function addRecord(store: RecordStore, rec: RecordSnapshot) {
  const i = store.records.findIndex((r) => r.id === rec.id);
  if (i >= 0) store.records[i] = rec;
  else store.records.push(rec);
}
