// 밸런스 테스트: 테스트 파티를 저장해 두고, 그 일차의 봇 팀 N개와 양 진영으로 붙여 승률을 잰다 (기준 50%).
// 리더 없는 파티(몬스터만)도 만들 수 있고, 한 칸에 후보 몬스터를 바꿔 끼우는 교체 비교로 몬스터끼리 견줄 수 있다.
// 상대는 봇 팀 또는 플레이 기록 풀(PvP 매칭과 같은 기록). 리그전은 테스트 파티끼리(원하면 기록도) 붙여 상성표를 만든다.
// 파티와 측정 기록은 saves/balance-tests.json에 모드 이름별로 저장된다 (터미널: npm run sim -- party).

import { useMemo, useRef, useState } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import type { TeamSnapshot } from '../../src/battle/types.ts';
import { hashSeed } from '../../src/core/rng.ts';
import { activeModName } from '../../src/data/activeMod.ts';
import { statModsText } from '../../src/data/describe.ts';
import { monsterName } from '../../src/data/growth.ts';
import { LEADER_MAP, LEADERS, leaderPath } from '../../src/data/leaders.ts';
import { MONSTER_MAP } from '../../src/data/monsters.ts';
import { TRINKET_MAP, TRINKETS } from '../../src/data/trinkets.ts';
import { GRADE_NAMES, MAX_GRADE } from '../../src/data/types.ts';
import { buildBotTeam } from '../../src/game/bot.ts';
import {
  ACCUM_FOES, accumTotals, avgSec, buildFoes, DEFAULT_OPTS, prepareParty, emptyResult, hasLeader, HISTORY_KEEP, leaderLevelOnDay, leaderRuns, leagueTotals, missingIn, recordFoes, recordTeams, runMatchup, runPartyTest,
  battleTrinket, swapCandidates, trinketCandidates, winPct, withSlot, withTrinket,
} from '../../src/sim/partyTest.ts';
import type { BalanceTestFile, FoeCache, LeaderMode, TrinketMode, LeagueTable, PartyTestOpts, PartyTestResult, TestParty, TestRun } from '../../src/sim/partyTest.ts';
import { loadBalanceTests, loadRecords, saveBalanceTests } from '../lib/persist.ts';
import { Check, Field, NumInput, Select, TextInput } from './fields.tsx';
import { emptySetup, fromTeam, SideSetup, toTeam } from './Sandbox.tsx';

const CHUNK = 8; // 한 번에 붙일 상대 수 (화면이 멈추지 않게 나눠서 계산)
const tick = () => new Promise((r) => setTimeout(r, 0));
const newId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const pct1 = (x: number) => `${x.toFixed(1)}%`;
const share = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '-');
const rateClass = (p: number) => (p > 60 ? 'hot' : p < 40 ? 'cold' : '');
// 같은 조건의 측정 기록인가 (양쪽 리더를 뺀 측정은 상대 리더 설정과 무관)
const sameSetup = (a: TestRun, o: PartyTestOpts, noLeaders: boolean) =>
  a.day === o.day && a.n === o.n && a.foeTrinkets === o.foeTrinkets && (a.foe ?? 'bots') === o.foeSource &&
  !!a.noLeaders === noLeaders && (noLeaders || a.foeLeader === o.foeLeader) && (a.accumFrom ?? 0) === accumOf(o);
const accumOf = (o: PartyTestOpts) => (o.accumFrom && o.accumFrom < o.day ? o.accumFrom : 0);
const resKey = (id: string, noLeaders: boolean) => `${id}|${noLeaders ? 'N' : 'L'}`;
const signed = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(1)}%p`;
const LEADER_MODES: [LeaderMode, string][] = [['keep', '그대로'], ['none', '양쪽 리더 빼기'], ['both', '비교 (리더 포함·제외 둘 다)']];
const foeLabel = (o: PartyTestOpts) => (o.foeSource === 'records' ? `${o.day}일차${o.recordDays ? ` ±${o.recordDays}` : ''} 플레이 기록` : `${o.day}일차 봇 팀`);

type LeagueResult = LeagueTable & { at: string; label: string; rounds: number; ids: string[]; noLeaders: boolean; alt?: LeagueTable }; // alt = 비교 모드의 리더 제외 결과
let lastLeague: LeagueResult | null = null; // 탭을 옮겨도 이번 세션 동안은 남긴다

function leaderLabel(t: TeamSnapshot): string {
  if (!hasLeader(t)) return '리더 없음';
  const l = LEADER_MAP[t.leaderId];
  const p = leaderPath(t.leaderId, t.growth);
  return `${p?.name ?? l.name} Lv${t.leaderLevel}`;
}

function unitLabel(t: TeamSnapshot, slot: number): string {
  const e = t.board.find((x) => x.slot === slot);
  if (!e) return '(빈 칸)';
  if (e.kind === 'leader') return `[리더] ${leaderPath(t.leaderId, t.growth)?.name ?? LEADER_MAP[t.leaderId]?.name ?? e.defId}`;
  return `${monsterName(e.defId, e.growth)} Lv${e.level}`;
}

function DiffCell({ d }: { d: number | null }) {
  return <td className={d === null ? 'muted' : d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d === null ? '-' : signed(d)}</td>;
}

function RateCell({ p }: { p: number }) {
  return (
    <td className={rateClass(p)}>
      <span className="rate-bar" style={{ width: `${p}%` }} />
      {pct1(p)}
    </td>
  );
}

interface Job { label: string; done: number; total: number }
interface SwapRow { defId: string; r: PartyTestResult }
interface LeagueCfg { rounds: number; records: boolean }
interface TrinketCfg { mode: TrinketMode; target: 'selected' | 'checked'; minGrade: number; maxGrade: number; n: number; shopOnly: boolean }
// 장신구 비교 결과: base[파티] = 후보 없이 승률, rates[후보][파티] = 후보를 넣은 승률
interface TrinketResult { at: string; label: string; mode: TrinketMode; names: string[]; ids: string[]; base: number[]; rows: { id: string; rates: number[] }[] }
let lastTrinkets: TrinketResult | null = null;
const TRINKET_MODES: [TrinketMode, string][] = [['add', '지금 장신구에 더하기'], ['solo', '이 장신구 하나만']];
interface SwapState { partyId: string; slot: number; level: number; base: PartyTestResult; rows: SwapRow[]; noLeaders: boolean }

export function BalanceTest({ dirty, onApply }: { dirty: boolean; onApply: () => void }) {
  const mod = activeModName();
  const [file, setFile] = useState<BalanceTestFile>(loadBalanceTests);
  const parties = file.mods[mod]?.parties ?? [];
  const [opts, setOpts] = useState<PartyTestOpts>(() => ({ ...DEFAULT_OPTS, ...file.mods[mod]?.opts }));
  const [selId, setSelId] = useState<string | null>(parties[0]?.id ?? null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, PartyTestResult>>({});
  const [job, setJob] = useState<Job | null>(null);
  const cancel = useRef(false);
  const foeCache = useRef(new Map<string, TeamSnapshot[]>());
  const accumCache = useRef<FoeCache>(new Map()); // 영구 성장 누적용 봇 팀
  const [swapCfg, setSwapCfg] = useState({ slot: 0, level: 2, minGrade: 1, maxGrade: 4, n: 60, shopOnly: true });
  const [swap, setSwap] = useState<SwapState | null>(null);
  const [leagueCfg, setLeagueCfg] = useState<LeagueCfg>({ rounds: 10, records: false });
  const [league, setLeague] = useState<LeagueResult | null>(lastLeague);
  const [msg, setMsg] = useState('');
  const [leagueView, setLeagueView] = useState<'L' | 'N'>('L');
  const [trinketCfg, setTrinketCfg] = useState<TrinketCfg>({ mode: 'add', target: 'checked', minGrade: 1, maxGrade: 6, n: 40, shopOnly: true });
  const [trinkets, setTrinkets] = useState<TrinketResult | null>(lastTrinkets);
  const [trinketByParty, setTrinketByParty] = useState(false);
  const mode: LeaderMode = opts.leaderMode ?? 'keep';
  const recordCount = useMemo(() => recordTeams(loadRecords(), mod, opts).length, [mod, opts]);

  const sel = parties.find((p) => p.id === selId) ?? null;
  const setup = useMemo(() => (sel ? fromTeam(sel.team) : null), [sel]);

  const write = (nextParties: TestParty[], o: PartyTestOpts = opts) => {
    const next: BalanceTestFile = { version: 1, mods: { ...file.mods, [mod]: { parties: nextParties, opts: o } } };
    setFile(next);
    saveBalanceTests(next);
  };
  const update = (id: string, fn: (p: TestParty) => TestParty) => write(parties.map((p) => (p.id === id ? fn(p) : p)));
  const setOpt = (patch: Partial<PartyTestOpts>) => {
    const o = { ...opts, ...patch };
    setOpts(o);
    write(parties, o);
  };
  const add = (team: TeamSnapshot, name: string) => {
    const p: TestParty = { id: newId(), name, team };
    write([...parties, p]);
    setSelId(p.id);
  };
  const applyAndReset = () => {
    foeCache.current.clear(); // 상대 봇 팀도 바뀐 데이터로 다시 만든다
    accumCache.current.clear();
    onApply();
  };

  // 상대: 플레이 기록이면 기록 풀에서, 봇 팀이면 만들어서 (같은 설정이면 다시 만들지 않고, 만드는 것도 나눠서)
  const foesFor = async (o: PartyTestOpts, label: string): Promise<TeamSnapshot[] | null> => {
    setMsg('');
    if (o.foeSource === 'records') {
      const recs = recordFoes(loadRecords(), mod, o);
      if (!recs.length) setMsg(`${foeLabel(o)}이 없습니다. 게임을 플레이하거나 터미널에서 npm run sim -- league --write 로 기록을 쌓으세요. 일차 범위(±)를 넓혀도 됩니다.`);
      return recs.length ? recs : null;
    }
    const key = `${o.day}|${o.n}|${o.seed}|${o.foeLeader}|${o.foeTrinkets}`;
    const hit = foeCache.current.get(key);
    if (hit) return hit;
    const out: TeamSnapshot[] = [];
    for (let i = 0; i < o.n; i += CHUNK) {
      if (cancel.current) return null;
      setJob({ label: `${label}: 상대 봇 팀 만드는 중`, done: i, total: o.n });
      await tick();
      out.push(...buildFoes(o, i, i + CHUNK));
    }
    foeCache.current.set(key, out);
    return out;
  };

  const measure = async (team: TeamSnapshot, foes: TeamSnapshot[], o: PartyTestOpts, label: string): Promise<PartyTestResult | null> => {
    const acc = emptyResult();
    for (let i = 0; i < foes.length; i += CHUNK) {
      if (cancel.current) return null;
      setJob({ label, done: i, total: foes.length });
      await tick();
      if (i === 0 && accumOf(o)) {
        setJob({ label: `${label}: 영구 성장 누적 (${o.accumFrom}~${o.day - 1}일차)`, done: 0, total: foes.length });
        await tick();
      }
      runPartyTest(team, foes, o, acc, i, i + CHUNK, accumCache.current);
    }
    return acc;
  };

  const runParties = async (ids: string[]) => {
    cancel.current = false;
    const o = opts;
    const foes = await foesFor(o, '준비');
    if (!foes) return setJob(null);
    const got: Record<string, TestRun[]> = {};
    const list = parties.filter((p) => ids.includes(p.id) && missingIn(p.team).length === 0);
    const at = new Date().toISOString();
    measuring: for (const ro of leaderRuns(o)) {
      const nl = !!ro.noLeaders;
      for (const [k, p] of list.entries()) {
        const r = await measure(p.team, foes, ro, `${nl ? '리더 제외 · ' : ''}${p.name} (${k + 1}/${list.length})`);
        if (!r) break measuring;
        (got[p.id] ??= []).push({ at, day: o.day, n: o.n, foeLeader: o.foeLeader, foeTrinkets: o.foeTrinkets, foe: o.foeSource, ...(nl ? { noLeaders: true } : {}), ...(accumOf(o) ? { accumFrom: accumOf(o) } : {}), winPct: Math.round(winPct(r) * 10) / 10, avgSec: Math.round(avgSec(r) * 10) / 10 });
        setResults((x) => ({ ...x, [resKey(p.id, nl)]: r }));
      }
    }
    setJob(null);
    write(parties.map((p) => (got[p.id] ? { ...p, history: [...(p.history ?? []), ...got[p.id]].slice(-HISTORY_KEEP) } : p)));
  };

  const runSwap = async (p: TestParty) => {
    cancel.current = false;
    const o = { ...opts, n: swapCfg.n, noLeaders: mode !== 'keep' }; // 비교 모드에서는 리더를 뺀 쪽(몬스터만의 힘)으로
    const foes = await foesFor(o, '교체 비교 준비');
    if (!foes) return setJob(null);
    const slot = swapSlot;
    const base = await measure(p.team, foes, o, '교체 비교: 지금 파티');
    if (!base) return setJob(null);
    const empty = !p.team.board.some((e) => e.slot === slot);
    const cands = [...(empty ? [] : ['']), ...swapCandidates(swapCfg.minGrade, swapCfg.maxGrade, swapCfg.shopOnly)];
    const rows: SwapRow[] = [];
    for (const [k, id] of cands.entries()) {
      const r = await measure(withSlot(p.team, slot, id, swapCfg.level), foes, o, `교체 비교: ${id ? MONSTER_MAP[id].name : '빈 칸'} (${k + 1}/${cands.length})`);
      if (!r) break;
      rows.push({ defId: id, r });
    }
    setJob(null);
    setSwap({ partyId: p.id, slot, level: swapCfg.level, base, rows, noLeaders: !!o.noLeaders });
  };

  // 리그전: 체크한 파티끼리 모든 쌍을 라운드 수만큼(라운드마다 양 진영). 기록을 넣으면 기록 전체를 한 상대로 친다
  const runLeague = async (list: TestParty[]) => {
    cancel.current = false;
    setMsg('');
    const tables: LeagueTable[] = [];
    for (const ro of leaderRuns(opts)) {
      const t = await leagueOnce(list, ro);
      if (!t) return setJob(null);
      tables.push(t);
    }
    setJob(null);
    const o = opts;
    const nl = mode === 'none';
    const out: LeagueResult = {
      ...tables[0], at: new Date().toISOString(), rounds: leagueCfg.rounds, ids: list.map((p) => p.id), noLeaders: nl, alt: tables[1],
      label: `${o.day}일차 · 쌍마다 ${leagueCfg.rounds * 2}전${nl ? ' · 양쪽 리더 제외' : tables[1] ? ' · 리더 포함·제외 비교' : ''}`,
    };
    lastLeague = out;
    setLeague(out);
    setLeagueView('L');
  };

  const leagueOnce = async (list: TestParty[], o: PartyTestOpts): Promise<LeagueTable | null> => {
    const { rounds } = leagueCfg;
    const tag = o.noLeaders ? '리더 제외 · ' : '';
    const k = list.length;
    const cells: (number | null)[][] = list.map(() => list.map(() => null));
    const pairs: [number, number][] = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
    // 리더 빼기·영구 성장 누적은 파티마다 한 번만
    const teams: TeamSnapshot[] = [];
    for (const p of list) {
      if (cancel.current) return null;
      setJob({ label: `리그전: ${tag}${p.name} 준비`, done: teams.length, total: list.length });
      await tick();
      teams.push(prepareParty(p.team, o, accumCache.current).team);
    }
    const oPrepped = { ...o, accumFrom: 0 }; // 이미 누적한 팀이라 다시 쌓지 않는다
    for (const [n, [i, j]] of pairs.entries()) {
      if (cancel.current) return null;
      setJob({ label: `리그전: ${tag}${list[i].name} vs ${list[j].name}`, done: n, total: pairs.length });
      await tick();
      const m = runMatchup(teams[i], teams[j], oPrepped, rounds, `${list[i].id}|${list[j].id}`);
      cells[i][j] = (100 * m.winsA) / m.battles;
      cells[j][i] = 100 - cells[i][j]!;
    }
    let vsRecords: number[] | undefined;
    let records: number | undefined;
    if (leagueCfg.records) {
      const store = loadRecords();
      const recs = recordFoes(store, mod, o);
      records = recordTeams(store, mod, o).length;
      if (recs.length) {
        vsRecords = [];
        for (const [n, p] of list.entries()) {
          const r = await measure(teams[n], recs, oPrepped, `리그전: ${tag}${p.name} vs 플레이 기록 (${n + 1}/${k})`);
          if (!r) return null;
          vsRecords.push(winPct(r));
        }
      } else setMsg(`${foeLabel(o)}이 없어 기록 없이 리그전을 했습니다.`);
    }
    const t = { names: list.map((p) => p.name), cells, vsRecords, records };
    return { ...t, total: leagueTotals(t) };
  };

  // 장신구 비교: 파티마다 후보 없이 한 번 + 후보마다 한 번 (같은 상대들과)
  const runTrinkets = async (list: TestParty[]) => {
    cancel.current = false;
    setMsg('');
    const o = { ...opts, n: trinketCfg.n, noLeaders: mode === 'none' };
    const foes = await foesFor(o, '장신구 비교 준비');
    if (!foes) return setJob(null);
    const cands = trinketCandidates(trinketCfg.minGrade, trinketCfg.maxGrade, trinketCfg.shopOnly);
    const base: number[] = [];
    const rates = cands.map(() => [] as number[]);
    for (const [k, p] of list.entries()) {
      const tag = list.length > 1 ? `${p.name} (${k + 1}/${list.length}) · ` : '';
      const b = await measure(withTrinket(p.team, '', trinketCfg.mode), foes, o, `장신구 비교: ${tag}기준`);
      if (!b) return setJob(null);
      base.push(winPct(b));
      for (const [c, id] of cands.entries()) {
        const r = await measure(withTrinket(p.team, id, trinketCfg.mode), foes, o, `장신구 비교: ${tag}${TRINKET_MAP[id].name} (${c + 1}/${cands.length})`);
        if (!r) return setJob(null);
        rates[c].push(winPct(r));
      }
    }
    setJob(null);
    const out: TrinketResult = {
      at: new Date().toISOString(), mode: trinketCfg.mode, names: list.map((p) => p.name), ids: list.map((p) => p.id), base,
      rows: cands.map((id, c) => ({ id, rates: rates[c] })),
      label: `${o.day}일차 · 파티 ${list.length}개 · 후보마다 ${o.n * 2}전 · ${trinketCfg.mode === 'add' ? '지금 장신구에 더하기' : '이 장신구 하나만'}${o.noLeaders ? ' · 양쪽 리더 제외' : ''}`,
    };
    lastTrinkets = out;
    setTrinkets(out);
  };

  const ready = !job;
  const checkedIds = parties.filter((p) => !unchecked.has(p.id)).map((p) => p.id);
  const swapSlots = sel ? Array.from({ length: 9 }, (_, i) => i + 1).filter((s) => sel.team.board.find((e) => e.slot === s)?.kind !== 'leader') : [];
  const swapSlot = swapSlots.includes(swapCfg.slot) ? swapCfg.slot : (sel?.team.board.find((e) => e.kind === 'monster')?.slot ?? swapSlots[0] ?? 0);
  const resL = sel ? results[resKey(sel.id, false)] : undefined;
  const resN = sel ? results[resKey(sel.id, true)] : undefined;
  const res = mode === 'none' ? resN ?? resL : resL ?? resN;

  return (
    <div className="sandbox balance-test">
      {dirty && (
        <div className="banner warn">
          적용하지 않은 변경 사항이 있습니다. 테스트는 적용된 데이터로 계산합니다.
          <button className="btn small primary" onClick={applyAndReset}>초안 적용</button>
        </div>
      )}

      <section className="panel">
        <h3>측정 설정</h3>
        <div className="inline wrap">
          <Field label="상대">
            <Select value={opts.foeSource} options={[['bots', '봇 팀'], ['records', '플레이 기록']]} onChange={(v) => setOpt({ foeSource: v })} />
          </Field>
          <Field label="일차" hint={opts.foeSource === 'records' ? '이 일차에 저장된 플레이 기록과 붙습니다' : '상대 봇 팀이 이 일차까지 상점을 돈 팀이 됩니다'}><NumInput value={opts.day} min={1} width={60} onChange={(v) => setOpt({ day: v })} /></Field>
          {opts.foeSource === 'records' && (
            <Field label="일차 범위 ±" hint={`지금 조건의 기록 ${recordCount}개`}><NumInput value={opts.recordDays} min={0} width={50} onChange={(v) => setOpt({ recordDays: v })} /></Field>
          )}
          <Field label={opts.foeSource === 'records' ? '최소 상대 수' : '상대 팀 수'} hint={opts.foeSource === 'records' ? '기록이 이보다 적으면 반복해서 채웁니다 (빈 성장이 매번 다르게 뽑힘)' : '팀마다 양 진영으로 한 번씩 = 2배 전투. 150이면 오차 약 ±3%p'}>
            <NumInput value={opts.n} min={2} width={70} onChange={(v) => setOpt({ n: v })} />
          </Field>
          <Field label="노드"><Select value={opts.node} options={[['normal', '일반'], ['elite', '엘리트'], ['boss', '보스']]} onChange={(v) => setOpt({ node: v })} /></Field>
          <Field label="리더" hint="양쪽 리더 빼기: 내 파티와 상대 모두 리더 없이. 비교: 둘 다 재서 차이 = 리더의 몫">
            <Select value={mode} options={LEADER_MODES} onChange={(v) => setOpt({ leaderMode: v })} />
          </Field>
          {mode === 'keep' && <Check label="상대 리더 포함" value={opts.foeLeader} onChange={(v) => setOpt({ foeLeader: v })} />}
          <Check label="상대 장신구 포함" value={opts.foeTrinkets} onChange={(v) => setOpt({ foeTrinkets: v })} />
          <Check label="빈 성장은 전투마다 무작위" value={opts.fillGrowth} onChange={(v) => setOpt({ fillGrowth: v })} />
          <Check label="영구 성장 누적" value={!!opts.accumFrom} onChange={(v) => setOpt({ accumFrom: v ? Math.min(BALANCE.leader.levelUpDays[1] ?? 7, Math.max(1, opts.day - 1)) : 0 })} />
          {!!opts.accumFrom && (
            <Field label="누적 시작 일차" hint={accumOf(opts) ? `${accumOf(opts)}~${opts.day - 1}일차에 하루 한 전투씩 얻은 영구 강화를 쌓고 잽니다` : '기준 일차보다 앞이어야 합니다'}>
              <NumInput value={opts.accumFrom} min={1} width={50} onChange={(v) => setOpt({ accumFrom: v })} />
            </Field>
          )}
        </div>
        <p className="muted small">
          봇 팀 상대의 기준은 50% (봇 팀끼리 붙이면 평균 50%). 플레이 기록은 실제 플레이어가 만든 팀이라 보통 더 가혹합니다. 60% 초과는 빨강, 40% 미만은 파랑. 파티 구성이 강한 건지 리더가 강한 건지는 리더를 "비교"로 두고 재 보세요: 리더 제외 승률 = 파티 구성의 힘, 차이 = 리더의 몫.
          {' '}이 일차 봇의 리더 레벨은 Lv{leaderLevelOnDay(opts.day)}입니다.
          {' '}영구 성장 누적: 전직(7일차)이나 영구 강화 유닛을 산 날부터 기준 일차 전날까지, 날마다 그날의 봇 {ACCUM_FOES}팀과 붙여 얻은 영구 강화 평균을 쌓습니다 (실제 런처럼 승패 무관). 파티에 적어 둔 영구 강화 위에 더하고, 봇 상대는 스택이 없습니다.
        </p>
      </section>

      <section className="panel">
        <h3>테스트 파티 <span className="muted small">"{mod}" 모드 · {parties.length}개</span></h3>
        <div className="inline wrap">
          <button className="btn" disabled={!ready} onClick={() => {
            const leader = LEADERS[0]?.id ?? '';
            const t = toTeam({ ...emptySetup(leader), leaderLevel: leaderLevelOnDay(opts.day) }, '새 파티');
            add(t, `새 파티 ${parties.length + 1}`);
          }}>새 파티</button>
          <button className="btn" disabled={!ready} onClick={() => add(toTeam(emptySetup(''), ''), `리더 없는 파티 ${parties.length + 1}`)}>새 파티 (리더 없음)</button>
          <button className="btn" disabled={!ready} onClick={() => add(buildBotTeam(opts.day, hashSeed('bt-bot', Date.now())), `${opts.day}일차 봇 팀`)}>봇 팀 가져오기</button>
          <button className="btn" disabled={!ready || !sel} onClick={() => sel && add(structuredClone({ ...sel.team }), `${sel.name} 사본`)}>복제</button>
          <button className="btn" disabled={!ready || !sel || !hasLeader(sel.team)} onClick={() => {
            if (!sel) return;
            add({ ...sel.team, leaderId: '', leaderLevel: 1, growth: [], board: sel.team.board.filter((e) => e.kind !== 'leader') }, `${sel.name} (리더 없음)`);
          }}>리더 뺀 사본</button>
          <button className="btn ghost danger" disabled={!ready || !sel} onClick={() => {
            if (!sel || !confirm(`"${sel.name}" 파티를 지울까요?`)) return;
            write(parties.filter((p) => p.id !== sel.id));
            setSelId(null);
          }}>삭제</button>
          <div className="spacer" />
          {job ? (
            <>
              <span className="muted small">{job.label} {Math.round((100 * job.done) / Math.max(1, job.total))}%</span>
              <button className="btn" onClick={() => { cancel.current = true; }}>중지</button>
            </>
          ) : (
            <button className="btn primary" disabled={checkedIds.length === 0} onClick={() => void runParties(checkedIds)}>
              체크한 파티 측정 ({checkedIds.length}개 · {checkedIds.length * opts.n * 2 * (mode === 'both' ? 2 : 1)}전)
            </button>
          )}
        </div>
        {parties.length === 0 ? (
          <p className="muted">아직 파티가 없습니다. "새 파티"나 "봇 팀 가져오기"로 시작하세요.</p>
        ) : (
          <table className="table stats party-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={unchecked.size === 0} onChange={(e) => setUnchecked(e.target.checked ? new Set() : new Set(parties.map((p) => p.id)))} /></th>
                <th>파티</th><th>리더</th>
                {mode === 'both'
                  ? <><th>리더 포함</th><th>리더 제외</th><th>리더 몫</th></>
                  : <><th>최근 승률{mode === 'none' ? ' (리더 제외)' : ''}</th><th>이전 대비</th><th>평균 시간</th></>}
                <th>측정 기록 (같은 설정)</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => {
                const miss = missingIn(p.team);
                const hist = (p.history ?? []).filter((h) => sameSetup(h, opts, mode === 'none'));
                const last = hist[hist.length - 1];
                const prev = hist[hist.length - 2];
                const d = last && prev ? last.winPct - prev.winPct : null;
                const histN = (p.history ?? []).filter((h) => sameSetup(h, opts, true));
                const lastN = histN[histN.length - 1];
                const none = <td className="muted small">{p.history?.length ? '다른 설정으로만 측정' : '-'}</td>;
                return (
                  <tr key={p.id} className={p.id === selId ? 'selected' : ''} onClick={() => setSelId(p.id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!unchecked.has(p.id)} onChange={(e) => setUnchecked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })} />
                    </td>
                    <td>{p.name}{miss.length > 0 && <span className="bad-text small"> · 없는 유닛: {miss.join(', ')}</span>}</td>
                    <td className="muted small">{leaderLabel(p.team)}</td>
                    {mode === 'both' ? (
                      <>
                        {last ? <RateCell p={last.winPct} /> : none}
                        {lastN ? <RateCell p={lastN.winPct} /> : none}
                        <DiffCell d={last && lastN && hasLeader(p.team) ? last.winPct - lastN.winPct : null} />
                      </>
                    ) : (
                      <>
                        {last ? <RateCell p={last.winPct} /> : none}
                        <DiffCell d={d} />
                        <td>{last ? `${last.avgSec.toFixed(1)}초` : '-'}</td>
                      </>
                    )}
                    <td className="muted small">{hist.slice(-6).map((h) => h.winPct.toFixed(0)).join(' → ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {msg && <p className="warn-text small">{msg}</p>}
        <p className="muted small">측정 기록은 상대 종류·일차·상대 수·상대 리더·장신구·리더 설정이 지금과 같은 것만 보여 줍니다. 수치를 고친 뒤 다시 측정하면 이전 대비가 나옵니다. 리더 몫 = 리더 포함 승률 − 양쪽 리더를 뺀 승률. 상대도 리더를 잃으므로 "내 리더가 상대 리더들보다 얼마나 센가"를 뜻합니다 (음수 = 상대 리더들보다 약함). 리더 없는 파티는 비교하지 않습니다.</p>
      </section>

      <section className="panel">
        <h3>장신구 비교 <span className="muted small">파티에 후보 장신구를 하나씩 넣어 승률이 얼마나 오르는지 봅니다</span></h3>
        <div className="inline wrap">
          <Field label="대상">
            <Select value={trinketCfg.target} options={[['checked', '체크한 파티 전체 (평균)'], ['selected', '선택한 파티만']]} onChange={(v) => setTrinketCfg((c) => ({ ...c, target: v }))} />
          </Field>
          <Field label="넣는 방식" hint="더하기: 실제처럼 지금 장신구에 하나 더. 하나만: 다른 장신구 없이 그 장신구만의 힘">
            <Select value={trinketCfg.mode} options={TRINKET_MODES} onChange={(v) => setTrinketCfg((c) => ({ ...c, mode: v }))} />
          </Field>
          <Field label="등급">
            <span className="inline">
              <Select value={trinketCfg.minGrade} options={GRADE_NAMES.slice(1, MAX_GRADE + 1).map((g, i): [number, string] => [i + 1, g])} onChange={(v) => setTrinketCfg((c) => ({ ...c, minGrade: v }))} />
              ~
              <Select value={trinketCfg.maxGrade} options={GRADE_NAMES.slice(1, MAX_GRADE + 1).map((g, i): [number, string] => [i + 1, g])} onChange={(v) => setTrinketCfg((c) => ({ ...c, maxGrade: v }))} />
            </span>
          </Field>
          <Field label="상대 팀 수" hint="후보마다 2배 전투"><NumInput value={trinketCfg.n} min={2} width={60} onChange={(v) => setTrinketCfg((c) => ({ ...c, n: v }))} /></Field>
          <Check label="상점·보상에 나오는 것만" value={trinketCfg.shopOnly} onChange={(v) => setTrinketCfg((c) => ({ ...c, shopOnly: v }))} />
          {(() => {
            const list = trinketCfg.target === 'selected' ? (sel && missingIn(sel.team).length === 0 ? [sel] : []) : parties.filter((p) => !unchecked.has(p.id) && missingIn(p.team).length === 0);
            const nc = trinketCandidates(trinketCfg.minGrade, trinketCfg.maxGrade, trinketCfg.shopOnly).length;
            return (
              <button className="btn primary" disabled={!ready || list.length === 0 || nc === 0} onClick={() => void runTrinkets(list)}>
                비교 ({nc}개 장신구 · 파티 {list.length}개 · {list.length * (nc + 1) * trinketCfg.n * 2}전)
              </button>
            );
          })()}
          {job && <span className="muted small">{job.label} {Math.round((100 * job.done) / Math.max(1, job.total))}%</span>}
        </div>
        <p className="muted small">
          변화 = 그 장신구를 넣은 승률 − 넣기 전 승률. 같은 등급 대비 = 같은 등급 장신구들의 평균 변화와의 차이 (등급 안에서 너무 세거나 약한 것 찾기).
          {' '}일차·상대·리더·영구 성장 설정은 위 측정 설정을 씁니다 (리더 "비교"는 리더 포함으로). 전투 능력이 없는 장신구(수입·상점·진화의 돌·변이 등 {TRINKETS.filter((t) => !battleTrinket(t.id)).length}개)는 전투로 잴 수 없어 뺍니다.
        </p>
        {trinkets && (() => {
          const T = trinkets;
          const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
          const deltas = T.rows.map((r) => r.rates.map((x, k) => x - T.base[k]));
          const mean = deltas.map(avg);
          const gradeMean = new Map<number, number[]>();
          T.rows.forEach((r, i) => {
            const g = TRINKET_MAP[r.id]?.grade ?? 0;
            gradeMean.set(g, [...(gradeMean.get(g) ?? []), mean[i]]);
          });
          const order = T.rows.map((_, i) => i).sort((a, b) => mean[b] - mean[a]);
          const multi = T.names.length > 1;
          return (
            <div className="league-wrap">
              <p className="muted small">
                {T.label} · {new Date(T.at).toLocaleString()} · 넣기 전 승률 {multi ? `평균 ${avg(T.base).toFixed(1)}%` : `${T.base[0].toFixed(1)}%`}
                {multi && <> · <label className="check inline-check"><input type="checkbox" checked={trinketByParty} onChange={(e) => setTrinketByParty(e.target.checked)} />파티별 보기</label></>}
              </p>
              <table className="table stats league-matrix trinket-table">
                <thead>
                  <tr>
                    <th>장신구</th><th>등급</th><th>가격</th><th>{multi ? '평균 변화' : '승률'}</th>{!multi && <th>변화</th>}<th>같은 등급 대비</th>
                    {multi && !trinketByParty && <><th>가장 오른 파티</th><th>가장 덜 오른 파티</th></>}
                    {multi && trinketByParty && T.names.map((n, j) => <th key={j} title={n}>{j + 1}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {order.map((i) => {
                    const r = T.rows[i];
                    const def = TRINKET_MAP[r.id];
                    const g = def?.grade ?? 0;
                    const peers = gradeMean.get(g) ?? [];
                    const vsGrade = peers.length > 1 ? mean[i] - avg(peers) : null;
                    const d = deltas[i];
                    const hi = d.indexOf(Math.max(...d));
                    const lo = d.indexOf(Math.min(...d));
                    return (
                      <tr key={r.id}>
                        <td className="name" title={def?.desc}>{def?.name ?? r.id}</td>
                        <td className="muted small">{GRADE_NAMES[g]}</td>
                        <td className="muted small">{BALANCE.economy.trinketCost[g - 1] ?? '-'}G</td>
                        {multi ? <DiffCell d={mean[i]} /> : <><RateCell p={r.rates[0]} /><DiffCell d={d[0]} /></>}
                        <DiffCell d={vsGrade} />
                        {multi && !trinketByParty && (
                          <>
                            <td className="small">{T.names[hi]} {signed(d[hi])}</td>
                            <td className="small">{T.names[lo]} {signed(d[lo])}</td>
                          </>
                        )}
                        {multi && trinketByParty && d.map((x, j) => <td key={j} className={x > 5 ? 'up' : x < -5 ? 'down' : 'muted'}>{x > 0 ? '+' : ''}{x.toFixed(0)}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted small">
                {multi && trinketByParty ? '칸 = 그 파티에서의 변화(%p). 열 번호에 마우스를 올리면 파티 이름. ' : ''}
                장신구 효과는 파티와 맞아야 커집니다 (독 단검은 독 파티에서만 등). 평균이 낮아도 특정 파티에서 크게 오르면 "맞는 파티용" 장신구입니다.
              </p>
            </div>
          );
        })()}
      </section>

      <section className="panel">
        <h3>리그전 <span className="muted small">체크한 파티끼리 서로 붙여 상성표를 만듭니다</span></h3>
        <div className="inline wrap">
          <Field label="라운드" hint="쌍마다 라운드 × 2(양 진영)전. 빈 성장이 라운드마다 다시 뽑힘"><NumInput value={leagueCfg.rounds} min={1} width={60} onChange={(v) => setLeagueCfg((c) => ({ ...c, rounds: v }))} /></Field>
          <Check label={`플레이 기록도 상대로 넣기 (${recordCount}개)`} value={leagueCfg.records} onChange={(v) => setLeagueCfg((c) => ({ ...c, records: v }))} />
          {(() => {
            const list = parties.filter((p) => !unchecked.has(p.id) && missingIn(p.team).length === 0);
            const n = (list.length * (list.length - 1)) / 2;
            return (
              <button className="btn primary" disabled={!ready || list.length < 2} onClick={() => void runLeague(list)}>
                리그전 ({list.length}개 파티 · {n}쌍 · {n * leagueCfg.rounds * 2 * (mode === 'both' ? 2 : 1)}전{leagueCfg.records ? ' + 기록' : ''})
              </button>
            );
          })()}
          {job && <span className="muted small">{job.label} {Math.round((100 * job.done) / Math.max(1, job.total))}%</span>}
        </div>
        <p className="muted small">
          일차·노드·빈 성장·리더 설정은 위 측정 설정을 씁니다 (기록에는 상대 리더·장신구 설정과 일차 범위도). 리그 승률은 상대 하나하나(기록은 묶어서 하나)를 같은 비중으로 평균한 값입니다.
          {' '}테스트 파티가 실제로 많이 쓰이는 조합을 닮을수록 리그 승률이 의미 있어집니다.
        </p>
        {league && (
          <div className="league-wrap">
            <p className="muted small">
              {league.label} · {new Date(league.at).toLocaleString()}{league.records !== undefined ? ` · 플레이 기록 ${league.records}개` : ''}
              {league.alt && (
                <span className="inline league-view">
                  {' '}상성표:
                  <button className={`btn tiny ${leagueView === 'L' ? 'primary' : ''}`} onClick={() => setLeagueView('L')}>리더 포함</button>
                  <button className={`btn tiny ${leagueView === 'N' ? 'primary' : ''}`} onClick={() => setLeagueView('N')}>리더 제외</button>
                </span>
              )}
            </p>
            {(() => {
              const view = league.alt && leagueView === 'N' ? league.alt : league;
              const alt = league.alt;
              return (
            <table className="table stats league-matrix">
              <thead>
                <tr>
                  <th>#</th><th>파티</th><th>리그 승률{league.noLeaders ? ' (리더 제외)' : alt ? ' (리더 포함)' : ''}</th>
                  {alt && <><th>리더 제외</th><th>리더 몫</th></>}
                  {view.vsRecords && <th>기록 상대</th>}
                  {league.names.map((n, j) => <th key={j} title={n}>{j + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {league.names.map((_, i) => i).sort((a, b) => league.total[b] - league.total[a]).map((i) => (
                  <tr key={i} className={league.ids[i] === selId ? 'selected' : ''} onClick={() => setSelId(league.ids[i])}>
                    <td>{i + 1}</td>
                    <td className="name">{league.names[i]}</td>
                    <RateCell p={league.total[i]} />
                    {alt && <><RateCell p={alt.total[i]} /><DiffCell d={league.total[i] - alt.total[i]} /></>}
                    {view.vsRecords && <td className={rateClass(view.vsRecords[i])}>{view.vsRecords[i].toFixed(0)}</td>}
                    {view.cells[i].map((c, j) => (
                      <td key={j} className={c === null ? 'muted' : rateClass(c)} title={c === null ? '' : `${league.names[i]} vs ${league.names[j]}: ${c.toFixed(1)}%`}>
                        {c === null ? '·' : c.toFixed(0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
              );
            })()}
            <p className="muted small">칸 = 그 행의 파티가 열 번호 파티에게 이긴 비율(%). 열 번호에 마우스를 올리면 파티 이름이 보입니다. 행을 누르면 아래에서 그 파티를 편집합니다.</p>
          </div>
        )}
      </section>

      {sel && setup && (
        <section className="panel">
          <div className="inline wrap">
            <Field label="파티 이름"><TextInput value={sel.name} onChange={(v) => update(sel.id, (p) => ({ ...p, name: v }))} /></Field>
            <Field label="메모"><TextInput value={sel.note ?? ''} placeholder="의도, 비교 대상 등" onChange={(v) => update(sel.id, (p) => ({ ...p, note: v || undefined }))} /></Field>
            <button className="btn primary" disabled={!ready || missingIn(sel.team).length > 0} onClick={() => void runParties([sel.id])}>이 파티만 측정</button>
          </div>
          <SideSetup title="파티 구성" s={setup} onChange={(s) => {
            update(sel.id, (p) => ({ ...p, team: toTeam(s, p.name) }));
            setResults((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith(`${sel.id}|`)))); // 구성이 바뀌면 지난 결과는 맞지 않는다
            if (swap?.partyId === sel.id) setSwap(null);
          }} />

          {res && (
            <div className="stats">
              <h4>
                결과{res === resN ? ' (양쪽 리더 제외)' : ''}: 승률 <span className={rateClass(winPct(res))}>{pct1(winPct(res))}</span> · {res.battles}전 · 평균 {avgSec(res).toFixed(1)}초 · 서든데스 {share(res.sudden, res.battles)}
              </h4>
              {res.accum && (
                <p className="muted small">
                  영구 성장 누적 {res.accum[0]?.day ?? '-'}~{res.accum[res.accum.length - 1]?.day ?? '-'}일차:{' '}
                  {[...accumTotals(res.accum)].map(([slot, m]) => `${slot}번 ${unitLabel(sel.team, slot)} ${statModsText(m)}`).join(' · ') || '쌓인 것 없음'}
                </p>
              )}
              {resL && resN && hasLeader(sel.team) && (
                <p className="leader-split">
                  리더 포함 <b className={rateClass(winPct(resL))}>{pct1(winPct(resL))}</b>
                  {' · '}리더 제외(파티 구성의 힘) <b className={rateClass(winPct(resN))}>{pct1(winPct(resN))}</b>
                  {' · '}리더 몫 <b>{signed(winPct(resL) - winPct(resN))}</b>
                  <span className="muted small"> (아래 표는 {res === resN ? '리더 제외' : '리더 포함'} 결과)</span>
                </p>
              )}
              <div className="stats-cols">
                <table className="table">
                  <thead><tr><th>칸</th><th>유닛</th><th>피해 몫</th><th>회복</th><th>실드</th><th>평균 행동</th>{res.prepared?.board.some((e) => e.bonus) && <th>영구 강화</th>}</tr></thead>
                  <tbody>
                    {(() => {
                      const all = res.units.reduce((s, u) => s + u.damage, 0);
                      return res.units.map((u) => (
                        <tr key={u.slot}>
                          <td>{u.slot}</td>
                          <td>{unitLabel(sel.team, u.slot)}</td>
                          <td>{share(u.damage, all)}</td>
                          <td>{Math.round(u.heal / res.battles)}</td>
                          <td>{Math.round(u.shield / res.battles)}</td>
                          <td>{(u.acts / res.battles).toFixed(1)}</td>
                          {res.prepared?.board.some((e) => e.bonus) && (
                            <td className="small" title={res.accum ? `누적으로 더한 몫: ${statModsText(accumTotals(res.accum).get(u.slot)) || '없음'}` : ''}>
                              {statModsText(res.prepared.board.find((e) => e.slot === u.slot)?.bonus) || '-'}
                            </td>
                          )}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
                <table className="table">
                  <thead><tr><th>상대 리더</th><th>전투</th><th>승률</th></tr></thead>
                  <tbody>
                    {res.byFoeLeader.map((b) => (
                      <tr key={b.leaderId}>
                        <td>{b.leaderId ? LEADER_MAP[b.leaderId]?.name ?? b.leaderId : '(리더 없음)'}</td>
                        <td>{b.battles}</td>
                        <RateCell p={(100 * b.wins) / b.battles} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">회복·실드는 한 전투 평균. 피해 몫에는 팀 상태(독·화상 등)로 낸 몫과 다른 아군에게 건 전투 한정 버프가 낸 몫이 들어갑니다.</p>
            </div>
          )}

          <h4>교체 비교 (몬스터 밸런스)</h4>
          <div className="inline wrap">
            <Field label="바꿀 칸">
              <Select value={swapSlot} options={swapSlots.map((s): [number, string] => [s, `${s}번: ${unitLabel(sel.team, s)}`])} onChange={(v) => setSwapCfg((c) => ({ ...c, slot: v }))} />
            </Field>
            <Field label="후보 레벨"><Select value={swapCfg.level} options={[[1, 'Lv1'], [2, 'Lv2'], [3, 'Lv3']]} onChange={(v) => setSwapCfg((c) => ({ ...c, level: v }))} /></Field>
            <Field label="등급">
              <span className="inline">
                <Select value={swapCfg.minGrade} options={GRADE_NAMES.slice(1, MAX_GRADE + 1).map((g, i): [number, string] => [i + 1, g])} onChange={(v) => setSwapCfg((c) => ({ ...c, minGrade: v }))} />
                ~
                <Select value={swapCfg.maxGrade} options={GRADE_NAMES.slice(1, MAX_GRADE + 1).map((g, i): [number, string] => [i + 1, g])} onChange={(v) => setSwapCfg((c) => ({ ...c, maxGrade: v }))} />
              </span>
            </Field>
            <Field label="상대 팀 수" hint="후보마다 2배 전투"><NumInput value={swapCfg.n} min={2} width={60} onChange={(v) => setSwapCfg((c) => ({ ...c, n: v }))} /></Field>
            <Check label="상점에 나오는 몬스터만" value={swapCfg.shopOnly} onChange={(v) => setSwapCfg((c) => ({ ...c, shopOnly: v }))} />
            <button className="btn primary" disabled={!ready || !swapSlot || missingIn(sel.team).length > 0} onClick={() => void runSwap(sel)}>
              비교 ({swapCandidates(swapCfg.minGrade, swapCfg.maxGrade, swapCfg.shopOnly).length + (sel.team.board.some((e) => e.slot === swapSlot) ? 1 : 0)}개 후보)
            </button>
            {job && <span className="muted small">{job.label} {Math.round((100 * job.done) / Math.max(1, job.total))}%</span>}
          </div>
          <p className="muted small">고른 칸에 후보 몬스터를 하나씩 넣어(성장은 위 설정대로) 같은 상대들과 붙입니다. 같은 등급끼리의 차이가 크면 그 몬스터가 강하거나 약한 것입니다.{mode !== 'keep' && ' 리더 설정이 "그대로"가 아니면 양쪽 리더를 빼고 비교합니다 (몬스터만의 힘).'}</p>
          {swap && swap.partyId === sel.id && (
            <table className="table stats">
              <thead><tr><th>{swap.slot}번 칸 (Lv{swap.level}){swap.noLeaders ? ' · 양쪽 리더 제외' : ''}</th><th>등급</th><th>승률</th><th>지금 대비</th><th>그 칸의 피해 몫</th></tr></thead>
              <tbody>
                <tr className="selected">
                  <td>지금: {unitLabel(sel.team, swap.slot)}</td><td />
                  <RateCell p={winPct(swap.base)} />
                  <td>-</td>
                  <td>{(() => {
                    const all = swap.base.units.reduce((s, u) => s + u.damage, 0);
                    return share(swap.base.units.find((u) => u.slot === swap.slot)?.damage ?? 0, all);
                  })()}</td>
                </tr>
                {[...swap.rows].sort((a, b) => winPct(b.r) - winPct(a.r)).map(({ defId, r }) => {
                  const d = winPct(r) - winPct(swap.base);
                  const all = r.units.reduce((s, u) => s + u.damage, 0);
                  return (
                    <tr key={defId || '-'}>
                      <td>{defId ? MONSTER_MAP[defId]?.name ?? defId : '(빈 칸)'}</td>
                      <td className="muted small">{defId ? GRADE_NAMES[MONSTER_MAP[defId]?.grade ?? 0] : ''}</td>
                      <RateCell p={winPct(r)} />
                      <td className={d > 0 ? 'up' : d < 0 ? 'down' : ''}>{`${d > 0 ? '+' : ''}${d.toFixed(1)}%p`}</td>
                      <td>{share(r.units.find((u) => u.slot === swap.slot)?.damage ?? 0, all)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
      <p className="muted small">기준 {BALANCE.ticksPerSec} tick = 1초. 저장 위치: saves/balance-tests.json (터미널에서 같은 파티를 돌리려면 npm run sim -- party).</p>
    </div>
  );
}
