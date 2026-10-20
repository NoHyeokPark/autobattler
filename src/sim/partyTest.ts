// 밸런스 테스트: 직접 짠 파티를 그 일차의 봇 팀 N개와 양 진영으로 붙여 승률을 잰다. 웹 에디터(밸런스 테스트 탭)와 시뮬레이터(npm run sim -- party)가 함께 쓴다.
//  - 리더 없는 파티: 리더 칸 없이 몬스터만으로 짠 팀 (몬스터 밸런스용). 이때는 보통 상대 봇 팀도 리더를 빼고 붙인다.
//  - 교체 비교: 파티의 한 칸에 후보 몬스터를 하나씩 바꿔 끼워 승률 순위를 본다.
//  - 상대: 봇 팀(기준선 50% = 봇 팀끼리 평균) 또는 플레이 기록 풀(PvP 매칭과 같은 기록). 실제 서비스에서는 기록과 만나므로 기록 승률이 더 중요하다.
//  - 리그전: 테스트 파티끼리(원하면 플레이 기록도) 서로 붙여 상성표를 본다.
//  - 영구 성장 누적(accumFrom): 시작 일차부터 기준 일차 전날까지 하루 한 전투씩 치르며 얻는 영구 강화를 칸별로 쌓은 뒤 잰다.
//  - 장신구 비교: 파티에 후보 장신구를 하나씩 더해(또는 그것 하나만 들려) 승률 변화를 본다. 여러 파티면 평균.
//  - 양쪽 리더 빼기(noLeaders): 내 파티와 상대 모두 리더 없이 붙인다. 리더 포함 승률과 비교하면 파티 구성의 힘과 리더의 힘을 나눠 볼 수 있다.

import { BALANCE } from '../config/balance.ts';
import { simulateBattle } from '../battle/engine.ts';
import type { BattleInput, BattleResult, BoardEntry, TeamSnapshot } from '../battle/types.ts';
import { hashSeed, Rng } from '../core/rng.ts';
import { maxGrowthCount, unitGrowthCandidates } from '../data/growth.ts';
import { LEADER_MAP } from '../data/leaders.ts';
import { MONSTER_MAP, MONSTERS } from '../data/monsters.ts';
import { TRINKET_MAP, TRINKETS } from '../data/trinkets.ts';
import type { EnvId, PermanentStat, Side, StatMods } from '../data/types.ts';
import { snapshotValid } from '../data/validate.ts';
import { buildBotTeam } from '../game/bot.ts';
import type { RecordStore } from '../game/matching.ts';

// 저장되는 테스트 파티 (saves/balance-tests.json). team.leaderId가 ''이면 리더 없는 파티
export interface TestParty {
  id: string;
  name: string;
  note?: string;
  team: TeamSnapshot;
  history?: TestRun[]; // 최근 측정 결과 (최신이 마지막)
}

export interface TestRun {
  at: string; // ISO 시각
  day: number;
  n: number; // 상대 팀 수 (전투 수 = 2n)
  foeLeader: boolean;
  foeTrinkets: boolean;
  winPct: number;
  avgSec: number;
  foe?: FoeSource; // 없으면 봇 팀 (예전 기록)
  noLeaders?: boolean; // 양쪽 리더를 빼고 잰 결과
  accumFrom?: number; // 영구 성장을 이 일차부터 누적하고 잰 결과
}
export type FoeSource = 'bots' | 'records';
export const HISTORY_KEEP = 12;

export interface PartyTestOpts {
  day: number;
  n: number; // 상대 봇 팀 수. 각 팀과 양 진영으로 한 번씩 = 2n전
  seed: number;
  env: EnvId;
  node: NonNullable<BattleInput['node']>;
  foeLeader: boolean; // false = 상대 봇 팀에서 리더를 뺀다 (리더 성장도 함께)
  foeTrinkets: boolean; // false = 상대 봇 팀의 장신구를 뺀다
  fillGrowth: boolean; // 성장을 다 고르지 않은 Lv2+ 몬스터는 전투마다 무작위로 채운다 (Lv3 전직 포함, 봇과 같은 규칙)
  foeSource: FoeSource;
  recordDays: number; // 플레이 기록: 일차 ±이만큼까지 (0 = 같은 일차만)
  noLeaders?: boolean; // 내 파티와 상대 모두 리더를 빼고 붙인다 (상대 리더 설정보다 우선)
  accumFrom?: number; // 영구 성장 누적: 이 일차부터 기준 일차 전날까지 하루 한 전투씩 치른 영구 강화를 쌓고 잰다 (0·없음 = 끔, 파티에 적어 둔 영구 강화는 그대로 두고 더한다)
  leaderMode?: LeaderMode; // 화면 설정: 그대로 / 양쪽 리더 빼기 / 둘 다 재서 비교
}
export type LeaderMode = 'keep' | 'none' | 'both';

// 화면의 리더 설정을 실제 측정 설정(들)로: 비교는 리더 포함·제외 두 번
export function leaderRuns(o: PartyTestOpts): PartyTestOpts[] {
  const mode = o.leaderMode ?? 'keep';
  return mode === 'both' ? [{ ...o, noLeaders: false }, { ...o, noLeaders: true }] : [{ ...o, noLeaders: mode === 'none' }];
}

export const DEFAULT_OPTS: PartyTestOpts = { day: 7, n: 150, seed: 1, env: 'normal', node: 'normal', foeLeader: true, foeTrinkets: true, fillGrowth: true, foeSource: 'bots', recordDays: 0 };

export const hasLeader = (t: TeamSnapshot) => t.board.some((e) => e.kind === 'leader') && !!LEADER_MAP[t.leaderId];

export function stripLeader(t: TeamSnapshot): TeamSnapshot {
  return { ...t, leaderId: '', leaderLevel: 1, growth: [], board: t.board.filter((e) => e.kind !== 'leader') };
}

// 상대 봇 팀 (같은 일차·시드면 항상 같은 팀). from~to만 만들 수도 있다 (웹은 나눠서 만든다)
export function buildFoes(o: Pick<PartyTestOpts, 'day' | 'n' | 'seed' | 'foeLeader' | 'foeTrinkets'>, from = 0, to = o.n): TeamSnapshot[] {
  return Array.from({ length: Math.max(0, Math.min(to, o.n) - from) }, (_, k) => {
    const i = from + k;
    return trimFoe(buildBotTeam(o.day, hashSeed('party-test', o.seed, o.day, i)), o);
  });
}

function trimFoe(t: TeamSnapshot, o: Pick<PartyTestOpts, 'foeLeader' | 'foeTrinkets'>): TeamSnapshot {
  let out = t;
  if (!o.foeLeader) out = stripLeader(out);
  if (!o.foeTrinkets) out = { ...out, trinkets: [] };
  return out;
}

// 플레이 기록 풀에서 이 일차(±recordDays)의 기록. PvP 매칭과 같은 조건 (같은 모드·같은 규칙 버전·일반 풀·지금 데이터로 재현 가능)
export function recordTeams(store: RecordStore, mod: string, o: Pick<PartyTestOpts, 'day' | 'recordDays' | 'foeLeader' | 'foeTrinkets'>): TeamSnapshot[] {
  return store.records
    .filter((r) => r.ruleVersion === BALANCE.ruleVersion && (r.mod ?? mod) === mod && r.pool === 'main' && Math.abs(r.day - o.day) <= o.recordDays && snapshotValid(r.team))
    .map((r) => trimFoe({ ...r.team, name: `기록 ${r.day}일차 · ${r.team.name}` }, o));
}

// 기록 상대 목록: 기록이 n개보다 적으면 반복해서 n개를 채운다 (전투는 결정적이라 반복은 무작위 성장이 다를 때만 의미가 있고, 승률 비율은 그대로)
export function recordFoes(store: RecordStore, mod: string, o: PartyTestOpts): TeamSnapshot[] {
  const recs = recordTeams(store, mod, o);
  if (!recs.length) return [];
  return Array.from({ length: Math.max(recs.length, recs.length * Math.ceil(o.n / recs.length)) }, (_, i) => recs[i % recs.length]);
}

// 비어 있는 성장을 무작위로 채운다 (Lv2 = 1개, Lv3 = 3개 + 전직이 있으면 전직 하나)
function fillEntry(e: BoardEntry, rng: Rng): BoardEntry {
  if (e.kind !== 'monster' || e.level < 2 || !MONSTER_MAP[e.defId]) return e;
  const def = MONSTER_MAP[e.defId];
  const promos = def.promotions ?? [];
  const growth = [...(e.growth ?? [])];
  const plain = () => growth.filter((id) => !promos.some((p) => p.id === id)).length;
  while (plain() < maxGrowthCount(e.level)) {
    const pool = unitGrowthCandidates(e.defId, growth, 2);
    if (!pool.length) break;
    growth.push(pool[rng.int(pool.length)].id);
  }
  if (e.level >= BALANCE.unit.maxLevel && promos.length && !growth.some((id) => promos.some((p) => p.id === id))) growth.push(promos[rng.int(promos.length)].id);
  return growth.length === (e.growth?.length ?? 0) ? e : { ...e, growth };
}

// 칸마다 따로 뽑는다: 칸 순서나 다른 칸을 바꿔도 나머지 칸의 성장은 그대로 (교체 비교가 덜 흔들린다)
export function fillGrowth(t: TeamSnapshot, seed: number): TeamSnapshot {
  return { ...t, board: t.board.map((e) => fillEntry(e, new Rng(hashSeed('party-growth', seed, e.slot, e.defId)))) };
}

// 칸별 기여 (내 쪽, 전투 수 합계)
export interface UnitContribution {
  slot: number;
  defId: string;
  leader: boolean;
  damage: number;
  heal: number;
  shield: number;
  acts: number;
}

export interface PartyTestResult {
  battles: number;
  wins: number;
  ticks: number;
  sudden: number;
  units: UnitContribution[];
  byFoeLeader: { leaderId: string; battles: number; wins: number }[]; // 상대 리더별 (리더를 뺀 상대는 '')
  prepared?: TeamSnapshot; // 실제로 붙인 내 파티 (리더 빼기·영구 성장 누적 반영). 나눠서 돌릴 때 한 번만 만든다
  accum?: AccumDay[]; // 영구 성장 누적 내역
}

export const emptyResult = (): PartyTestResult => ({ battles: 0, wins: 0, ticks: 0, sudden: 0, units: [], byFoeLeader: [] });

function record(acc: PartyTestResult, r: BattleResult, me: Side, foe: TeamSnapshot) {
  acc.battles++;
  const won = r.winner === me;
  if (won) acc.wins++;
  acc.ticks += r.endTick;
  if (r.suddenDeath) acc.sudden++;
  for (const u of r.units) {
    if (u.side !== me) continue;
    let c = acc.units.find((x) => x.slot === u.slot);
    if (!c) {
      c = { slot: u.slot, defId: u.uid, leader: u.isLeader, damage: 0, heal: 0, shield: 0, acts: 0 };
      acc.units.push(c);
      acc.units.sort((a, b) => a.slot - b.slot);
    }
    c.damage += u.damage;
    c.heal += u.heal;
    c.shield += u.shield;
    c.acts += u.acts;
  }
  const fl = hasLeader(foe) ? foe.leaderId : '';
  let b = acc.byFoeLeader.find((x) => x.leaderId === fl);
  if (!b) acc.byFoeLeader.push((b = { leaderId: fl, battles: 0, wins: 0 }));
  b.battles++;
  if (won) b.wins++;
}

// foes[from..to)와 양 진영으로 붙여 acc에 더한다 (웹은 잘라서 여러 번 부르며 진행률을 보여 준다)
export function runPartyTest(party: TeamSnapshot, foes: TeamSnapshot[], o: PartyTestOpts, acc: PartyTestResult = emptyResult(), from = 0, to = foes.length, cache?: FoeCache): PartyTestResult {
  if (!acc.prepared) {
    const p = prepareParty(party, o, cache);
    // 골드를 적어 두지 않은 파티는 상대들(같은 일차)의 보유 골드 중앙값으로 ("내 골드만큼" 효과용: 현상금 전단 등)
    acc.prepared = p.team.gold === undefined ? { ...p.team, gold: medianGold(foes) } : p.team;
    if (p.accum) acc.accum = p.accum;
  }
  const mine = acc.prepared;
  for (let i = from; i < Math.min(to, foes.length); i++) {
    const me = o.fillGrowth ? fillGrowth(mine, hashSeed(o.seed, i)) : mine;
    const foe = o.noLeaders ? stripLeader(foes[i]) : foes[i];
    const base = { env: o.env, day: o.day, seed: i, node: o.node };
    // 상대 리더별 집계는 리더를 뺐어도 원래 상대 팀의 리더로 나눈다 (그 리더의 봇이 짠 구성)
    record(acc, simulateBattle({ ...base, player: me, enemy: foe }), 0, foes[i]);
    record(acc, simulateBattle({ ...base, player: foe, enemy: me }), 1, foes[i]);
  }
  for (const u of acc.units) {
    const e = party.board.find((x) => x.slot === u.slot);
    if (e) u.defId = e.defId;
  }
  return acc;
}

export const winPct = (r: PartyTestResult) => (r.battles ? (100 * r.wins) / r.battles : 0);
export const avgSec = (r: PartyTestResult) => (r.battles ? r.ticks / r.battles / BALANCE.ticksPerSec : 0);

export function medianGold(teams: TeamSnapshot[]): number {
  const g = teams.map((t) => t.gold ?? 0).sort((a, b) => a - b);
  return g.length ? g[Math.floor(g.length / 2)] : 0;
}

// ── 영구 성장 누적 ──
export const ACCUM_FOES = 5; // 하루에 붙여 보는 봇 수 (얻는 영구 강화는 그 평균. 행동 횟수에 따라 달라지는 효과가 있어서)
export interface AccumDay { day: number; gains: { slot: number; stat: PermanentStat; amount: number }[] }
export type FoeCache = Map<string, TeamSnapshot>; // 누적용 봇 팀 (같은 데이터 안에서 다시 만들지 않게)

function accumFoe(day: number, seed: number, k: number, cache?: FoeCache): TeamSnapshot {
  const key = `${day}|${seed}|${k}`;
  let t = cache?.get(key);
  if (!t) {
    t = buildBotTeam(day, hashSeed('party-accum', seed, day, k));
    cache?.set(key, t);
  }
  return t;
}

export function addBonus(e: BoardEntry, stat: PermanentStat, amount: number): BoardEntry {
  const bonus: StatMods = { ...(e.bonus ?? {}) };
  bonus[stat] = (bonus[stat] ?? 0) + amount;
  if (!bonus[stat]) delete bonus[stat];
  const { bonus: _, ...rest } = e;
  return Object.keys(bonus).length ? { ...rest, bonus } : rest;
}

// from일차부터 기준 일차 전날까지 하루 한 전투씩: 그날의 봇 ACCUM_FOES개와 붙여 얻은 영구 강화의 평균(반올림)을 칸별로 더한다.
// 실제 런처럼 승패와 무관. 리더 레벨은 그날 봇의 리더 레벨을 넘지 않게 낮춘다. 빈 성장은 누적 동안 한 가지로 고정해 뽑고, 결과에는 영구 강화만 옮긴다
export function accumulatePermanent(party: TeamSnapshot, o: PartyTestOpts, from: number, cache?: FoeCache): { team: TeamSnapshot; days: AccumDay[] } {
  let cur = party;
  const days: AccumDay[] = [];
  for (let d = Math.max(1, from); d < o.day; d++) {
    const today = { ...cur, leaderLevel: Math.min(cur.leaderLevel, leaderLevelOnDay(d)) };
    const me = o.fillGrowth ? fillGrowth(today, hashSeed('party-accum-growth', o.seed)) : today;
    const sum = new Map<string, number>();
    for (let k = 0; k < ACCUM_FOES; k++) {
      const foe = accumFoe(d, o.seed, k, cache);
      const r = simulateBattle({ player: me, enemy: o.noLeaders ? stripLeader(foe) : foe, env: 'normal', day: d, seed: k, node: 'normal' });
      for (const g of r.gains[0].permanent) sum.set(`${g.slot}|${g.stat}`, (sum.get(`${g.slot}|${g.stat}`) ?? 0) + g.amount);
    }
    const gains = [...sum].map(([key, total]) => {
      const [slot, stat] = key.split('|');
      return { slot: Number(slot), stat: stat as PermanentStat, amount: Math.round(total / ACCUM_FOES) };
    }).filter((g) => g.amount !== 0).sort((a, b) => a.slot - b.slot);
    cur = { ...cur, board: cur.board.map((e) => gains.filter((g) => g.slot === e.slot).reduce((x, g) => addBonus(x, g.stat, g.amount), e)) };
    days.push({ day: d, gains });
  }
  return { team: cur, days };
}

// 실제로 붙일 내 파티: 리더 빼기 → 영구 성장 누적
export function prepareParty(party: TeamSnapshot, o: PartyTestOpts, cache?: FoeCache): { team: TeamSnapshot; accum?: AccumDay[] } {
  const base = o.noLeaders ? stripLeader(party) : party;
  if (!o.accumFrom || o.accumFrom >= o.day) return { team: base };
  const r = accumulatePermanent(base, o, o.accumFrom, cache);
  return { team: r.team, accum: r.days };
}

// 누적 내역을 칸별 합계로
export function accumTotals(days: AccumDay[]): Map<number, StatMods> {
  const out = new Map<number, StatMods>();
  for (const d of days) {
    for (const g of d.gains) {
      const m = out.get(g.slot) ?? {};
      m[g.stat] = (m[g.stat] ?? 0) + g.amount;
      out.set(g.slot, m);
    }
  }
  return out;
}

// ── 장신구 비교 ──
// add = 지금 장신구에 하나 더 (같은 것이 있으면 중첩), solo = 장신구를 이것 하나만 (파티의 다른 장신구 영향 없이)
export type TrinketMode = 'add' | 'solo';

// 전투에 효과가 있는 장신구. 수입·상점·진화의 돌·변이 같은 경제·일회성 장신구와, 전투에서 골드·장신구만 주는 것(보물 지도 등)은 전투로 잴 수 없어 뺀다
export const battleTrinket = (id: string) =>
  (TRINKET_MAP[id]?.triggers ?? []).some((t) => t.effects.some((e) => e.type !== 'gold' && e.type !== 'trinket'));
export function trinketCandidates(minGrade: number, maxGrade: number, shopOnly = true): string[] {
  return TRINKETS.filter((t) => t.grade >= minGrade && t.grade <= maxGrade && (!shopOnly || t.shop !== false) && battleTrinket(t.id)).map((t) => t.id);
}
export function withTrinket(t: TeamSnapshot, id: string, mode: TrinketMode): TeamSnapshot {
  const base = mode === 'solo' ? [] : t.trinkets;
  return { ...t, trinkets: id ? [...base, id] : [...base] };
}

// 교체 비교 후보: 상점에 나오는 몬스터 중 등급 구간 안 (shopOnly=false면 상점에 안 나오는 것도)
export function swapCandidates(minGrade: number, maxGrade: number, shopOnly = true): string[] {
  return MONSTERS.filter((m) => m.grade >= minGrade && m.grade <= maxGrade && (!shopOnly || m.shop !== false)).map((m) => m.id);
}

// 파티의 한 칸을 다른 몬스터로 바꾼 팀 (defId ''이면 그 칸을 비운다). 리더 칸은 바꾸지 않는다
export function withSlot(party: TeamSnapshot, slot: number, defId: string, level: number): TeamSnapshot {
  const board = party.board.filter((e) => e.slot !== slot || e.kind === 'leader');
  if (board.some((e) => e.slot === slot)) return party;
  if (defId) board.push({ slot, kind: 'monster', defId, level });
  return { ...party, board: board.sort((a, b) => a.slot - b.slot) };
}

// 그 일차에 봇이 보통 가지는 리더 레벨 (밸런스 수치의 리더 레벨업 일차 기준)
export function leaderLevelOnDay(day: number): number {
  return 1 + BALANCE.leader.levelUpDays.filter((d) => d <= day).length;
}

// ── 리그전 ──
// 두 팀을 rounds번(라운드마다 양 진영) 붙인다. 무작위 성장은 라운드마다 다시 뽑는다
export interface Matchup { battles: number; winsA: number; ticks: number }
export function runMatchup(a: TeamSnapshot, b: TeamSnapshot, o: PartyTestOpts, rounds: number, salt: string): Matchup {
  const m: Matchup = { battles: 0, winsA: 0, ticks: 0 };
  for (let k = 0; k < rounds; k++) {
    const a0 = o.noLeaders ? stripLeader(a) : a;
    const b0 = o.noLeaders ? stripLeader(b) : b;
    const A = o.fillGrowth ? fillGrowth(a0, hashSeed('league-a', o.seed, salt, k)) : a0;
    const B = o.fillGrowth ? fillGrowth(b0, hashSeed('league-b', o.seed, salt, k)) : b0;
    const base = { env: o.env, day: o.day, seed: k, node: o.node };
    const r1 = simulateBattle({ ...base, player: A, enemy: B });
    const r2 = simulateBattle({ ...base, player: B, enemy: A });
    m.battles += 2;
    m.ticks += r1.endTick + r2.endTick;
    if (r1.winner === 0) m.winsA++;
    if (r2.winner === 1) m.winsA++;
  }
  return m;
}

// 리그 결과: cells[i][j] = i가 j에게 이긴 비율(%). 기록 열은 플레이 기록 전체와 붙인 결과
export interface LeagueTable {
  names: string[];
  cells: (number | null)[][]; // 자기 자신은 null
  vsRecords?: number[]; // 플레이 기록 전체 상대 승률 (기록을 넣었을 때)
  records?: number; // 기록 수
  total: number[]; // 리그 승률: 상대(파티 하나하나, 기록 묶음 하나)마다 같은 비중으로 평균
}

export function leagueTotals(t: Omit<LeagueTable, 'total'>): number[] {
  return t.cells.map((row, i) => {
    const xs = row.filter((x): x is number => x !== null);
    if (t.vsRecords) xs.push(t.vsRecords[i]);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  });
}

// saves/balance-tests.json: 모드 이름별 테스트 파티와 마지막 측정 설정
export interface BalanceTestFile {
  version: 1;
  mods: Record<string, { parties: TestParty[]; opts?: Partial<PartyTestOpts> }>;
}
export const BALANCE_TEST_FILE = 'saves/balance-tests.json';

// 이 파티를 지금 데이터로 돌릴 수 있는가 (지운 몬스터·리더가 있으면 그 이름들)
export function missingIn(t: TeamSnapshot): string[] {
  const out = t.board.filter((e) => (e.kind === 'leader' ? !LEADER_MAP[e.defId] : !MONSTER_MAP[e.defId])).map((e) => e.defId);
  return [...new Set(out)];
}
