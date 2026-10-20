// 에이전트 세션 저장과 명령 처리 (명령줄 cli.ts와 MCP 서버 mcp.ts가 같이 쓴다).
//  - 세션 파일: saves/agent/session.json (AB_AGENT_DIR로 바꿀 수 있음). 런 상태 + 시드·runId + 행동 기록.
//    새 런을 시작하면 이전 세션은 saves/agent/runs/<runId>.json으로 옮겨 둔다.
//  - 상대: 공용 PvP 기록 풀(saves/records.json)을 웹 게임과 같은 조건으로 읽는다 (규칙 버전·재현 가능한 기록만).
//    기본은 읽기만 한다. AB_AGENT_SHARE_RECORDS=1(명령줄 --share-records)이면 에이전트의 기록도 풀에 넣는다.
//  - 리더별 기록(우승 수 등)은 saves/agent/profile.json에 따로 쌓는다 (사람의 기록과 섞지 않음).
//  - 런 이력: saves/agent/history.json에 모든 런의 결과를 남긴다 (우승·탈락·포기). 진행 중인 런이 있으면 새 런은 abandon을 명시해야 하고, 포기도 이력에 남는다 (평가를 공정하게).
//  - 메모: act에 note(판단 이유)를 붙이면 그 행동 위치에 저장하고 action_log에 함께 보여 준다.
//  - 모드: 적용 중인 모드(mods/editor.json)를 쓴다 (AB_AGENT_MOD = 다른 모드 이름·파일, AB_AGENT_NO_MOD=1 = 기본 데이터). 런 도중 모드가 바뀌면 경고한다 (다시 실행해도 같은 결과가 안 나온다).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BALANCE } from '../config/balance.ts';
import { LEADER_MAP, LEADERS, leaderPath } from '../data/leaders.ts';
import { snapshotValid } from '../data/validate.ts';
import type { RecordStore } from '../game/matching.ts';
import type { Profile } from '../game/profile.ts';
import { recordRunEnd } from '../game/profile.ts';
import type { RunState } from '../game/state.ts';
import { loadModFile, loadRecords, resolveModPath, saveRecords } from '../game/storage.ts';
import type { AgentAction } from './agent.ts';
import { execute, info, observe, resolveLeader, rulesText, startRun } from './agent.ts';

export interface AgentSession {
  version: 1;
  runId: string;
  seed: number;
  leaderId: string;
  mod: string; // 적용 중이던 모드 이름
  modHash: string; // 모드 파일 내용 해시 (도중에 바뀌었는지)
  createdAt: string;
  log: AgentAction[];
  notes?: AgentNote[];
  recorded?: boolean; // 런 이력에 결과를 남겼는가
  state: RunState;
}

// 판단 메모: at = 이 메모를 남길 때까지 쌓인 행동 수 (action_log에서 그 위치에 끼워 보여 준다)
export interface AgentNote { at: number; day: number; phase: RunState['phase']; text: string }

// 런 이력 한 줄
export interface AgentRunRecord {
  runId: string;
  leaderId: string;
  path?: string; // 전직 이름
  seed: number;
  mod: string;
  startedAt: string;
  endedAt: string;
  result: NonNullable<RunState['end']>['reason'] | 'abandoned';
  day: number;
  wins: number;
  losses: number;
  score: number | null;
  actions: number;
}

export const AGENT_DIR = process.env.AB_AGENT_DIR ?? join(process.cwd(), 'saves', 'agent');
const SESSION = join(AGENT_DIR, 'session.json');
const PROFILE = join(AGENT_DIR, 'profile.json');
const HISTORY = join(AGENT_DIR, 'history.json');
const shareRecords = () => process.env.AB_AGENT_SHARE_RECORDS === '1';

function writeJson(file: string, data: unknown) {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}
const readJson = <T>(file: string): T | null => {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

// 모드 적용 (프로세스마다 한 번)
let modInfo: { name: string; hash: string } | null = null;
export function ensureMod(): { name: string; hash: string } {
  if (modInfo) return modInfo;
  const path = resolveModPath(process.env.AB_AGENT_MOD, process.env.AB_AGENT_NO_MOD === '1'); // AB_AGENT_NO_MOD=1 = 기본 데이터
  if (!path) return (modInfo = { name: '기본 데이터', hash: '' });
  const name = loadModFile(path);
  return (modInfo = { name, hash: createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 12) });
}

// 웹 게임과 같은 상대 풀: 규칙 버전이 같고 지금 데이터로 재현할 수 있는 기록만 (모드는 매칭이 거른다)
function recordPool(): { store: RecordStore; save: () => void } {
  const full = loadRecords();
  const usable = full.records.filter((r) => r.ruleVersion === BALANCE.ruleVersion && snapshotValid(r.team));
  const hidden = full.records.filter((r) => !usable.includes(r));
  const store: RecordStore = { records: usable };
  return { store, save: () => { if (shareRecords()) saveRecords({ records: [...hidden, ...store.records] }); } };
}

export const loadSession = () => readJson<AgentSession>(SESSION);
const saveSession = (s: AgentSession) => writeJson(SESSION, s);

function modWarning(sess: AgentSession): string {
  const m = ensureMod();
  return sess.modHash && m.hash && sess.modHash !== m.hash ? `\n⚠ 이 런을 시작한 뒤 모드 데이터가 바뀌었습니다 (${sess.mod} → ${m.name}). 지금 데이터로 계속합니다.` : '';
}

function historyEntry(sess: AgentSession, abandoned: boolean, endedAt = new Date().toISOString()): AgentRunRecord {
  const s = sess.state;
  return {
    runId: sess.runId, leaderId: sess.leaderId, path: leaderPath(sess.leaderId, s.growth)?.name, seed: sess.seed, mod: sess.mod,
    startedAt: sess.createdAt, endedAt, result: abandoned ? 'abandoned' : s.end!.reason,
    day: s.day, wins: s.wins, losses: s.losses, score: s.end?.score ?? null, actions: sess.log.length,
  };
}

// 이력 파일이 아직 없으면 보관된 런들(runs/)과 끝난 지금 런으로 처음 한 번 만든다 (이력 기능 전에 플레이한 런)
function loadHistory(): AgentRunRecord[] {
  const saved = readJson<AgentRunRecord[]>(HISTORY);
  if (saved) return saved;
  const dir = join(AGENT_DIR, 'runs');
  const past = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson<AgentSession>(join(dir, f))).filter((x): x is AgentSession => !!x) : [];
  const cur = loadSession();
  const all = [...past, ...(cur?.state.end ? [cur] : [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return all.map((x) => historyEntry(x, !x.state.end, x.createdAt));
}

// 끝났거나 포기한 런을 이력에 (런마다 한 번)
function recordHistory(sess: AgentSession, abandoned: boolean) {
  const s = sess.state;
  if (!abandoned && !s.end) return;
  const list = loadHistory();
  if (list.some((x) => x.runId === sess.runId)) {
    if (!existsSync(HISTORY)) writeJson(HISTORY, list);
    return;
  }
  list.push(historyEntry(sess, abandoned));
  writeJson(HISTORY, list);
  sess.recorded = true;
}
export function historySummary(): string {
  const list = loadHistory();
  if (!list.length) return '에이전트 런 이력: 없음';
  const n = (r: AgentRunRecord['result']) => list.filter((x) => x.result === r).length;
  const champ = n('champion') + n('extensionStop') + n('extensionLost') + n('extensionDone');
  return `에이전트 런 이력: ${list.length}판 · 우승 ${champ} · 탈락 ${n('eliminated') + n('outOfDays')} · 포기 ${n('abandoned')} · 평균 ${(list.reduce((a, x) => a + x.wins, 0) / list.length).toFixed(1)}승`;
}

function noSession(): string {
  return `진행 중인 런이 없습니다. new_game으로 시작하세요 (리더: ${LEADERS.map((l, i) => `${i + 1}.${l.name}`).join(', ')}).`;
}

export function agentNew(leader?: string, seedArg?: number, abandon = false): string {
  const mod = ensureMod();
  const old = loadSession();
  // 진행 중인 런을 두고 새로 시작하려면 포기를 명시해야 한다 (포기도 이력에 남는다)
  if (old && !old.state.end && !abandon) {
    return `진행 중인 런이 있습니다 (${LEADER_MAP[old.leaderId]?.name ?? old.leaderId} · ${old.state.day}일차 · ${old.state.wins}승 ${old.state.losses}패). 이어서 하려면 get_state, 포기하고 새로 시작하려면 new_game에 abandon: true (명령줄: new --abandon). 포기는 런 이력에 남습니다.`;
  }
  const seed = seedArg ?? (Date.now() & 0x7fffffff);
  const leaderId = resolveLeader(leader, seed);
  if (!leaderId) return `리더 "${leader}"를 찾지 못했습니다. 가능: ${LEADERS.map((l, i) => `${i + 1}.${l.name}(${l.id})`).join(', ')}`;
  if (old) {
    recordHistory(old, !old.state.end);
    writeJson(join(AGENT_DIR, 'runs', `${old.runId}.json`), old); // 이전 런 보관
  }
  const runId = `agent-${Date.now().toString(36)}-${seed}`;
  const state = startRun(leaderId, seed, runId);
  saveSession({ version: 1, runId, seed, leaderId, mod: mod.name, modHash: mod.hash, createdAt: new Date().toISOString(), log: [], state });
  return [
    `새 런: ${LEADER_MAP[leaderId].name} · 시드 ${seed} · 모드 ${mod.name}${shareRecords() ? ' · 기록 풀에 참여' : ''}`,
    historySummary(),
    '규칙을 아직 안 읽었다면 rules를 먼저 보세요. 런은 끝까지 플레이합니다 (새로 시작하면 포기로 기록).',
    '',
    observe(state),
  ].join('\n');
}

export function agentState(): string {
  ensureMod();
  const sess = loadSession();
  return sess ? observe(sess.state) + modWarning(sess) : noSession();
}

export function agentAct(commands: string, note?: string): string {
  ensureMod();
  const sess = loadSession();
  if (!sess) return noSession();
  const text = note?.trim();
  if (text) (sess.notes ??= []).push({ at: sess.log.length, day: sess.state.day, phase: sess.state.phase, text });
  const pool = recordPool();
  const r = execute(sess.state, pool.store, commands);
  sess.log.push(...r.actions);
  if (r.battles.length) pool.save();
  if (sess.state.end) {
    const profile = readJson<Profile>(PROFILE) ?? { leaders: {} };
    recordRunEnd(profile, sess.state);
    writeJson(PROFILE, profile);
    recordHistory(sess, false);
  }
  saveSession(sess);
  return [...r.lines, ...(r.stopped ? [`(${r.stopped})`] : []), '', observe(sess.state)].join('\n') + modWarning(sess);
}

export function agentInfo(target: string): string {
  ensureMod();
  return info(loadSession()?.state ?? null, target);
}

export function agentRules(): string {
  ensureMod();
  return rulesText();
}

export function agentLog(): string {
  ensureMod();
  const sess = loadSession();
  if (!sess) return noSession();
  const lines = [`런 ${sess.runId} · ${LEADER_MAP[sess.leaderId]?.name ?? sess.leaderId} · 시드 ${sess.seed} · 모드 ${sess.mod}`];
  const notes = sess.notes ?? [];
  sess.log.forEach((a, i) => {
    for (const n of notes.filter((x) => x.at === i)) lines.push(`  💭 D${n.day} ${n.text}`);
    lines.push(`D${a.day} [${a.phase}] ${a.failed ? '✗ ' : ''}${a.cmd}`);
  });
  for (const n of notes.filter((x) => x.at >= sess.log.length)) lines.push(`  💭 D${n.day} ${n.text}`);
  lines.push(historySummary());
  return lines.join('\n');
}
