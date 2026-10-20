// 결정적 전투 엔진.
// - 시간은 정수 tick. 모든 계산은 정수이고 안전 한도에서 잘라낸다.
// - 같은 입력이면 항상 같은 결과가 나온다(난수를 쓰지 않으며, 쓰게 되더라도 input.seed만 쓴다).
// - 화면을 모르고 이벤트 로그만 출력한다.
//
// tick 처리 순서
//   (0) t=0 전투 시작 처리: 장신구(시스템) → 플레이어 유닛 → 상대 유닛, 각 진영은 슬롯 번호 순.
//       시작 효과가 끝난 뒤 남은 대기 시간 = 행동 간격, 3열은 0.
//   (1) 시스템 이벤트: 서든데스 → (진영, 슬롯, 등록 순번) 순으로 상태 주기 효과·N초 1회 효과.
//   (2) 남은 대기 시간이 0인 유닛 행동: 플레이어 우선 → 슬롯 번호 → 등록 순번.
//       행동마다 (1 + 추가발동)회 연속 행동하고, 끝나면 남은 대기 시간 = 행동 간격.
//   (3) 기절하지 않은 유닛의 남은 대기 시간 -1.
// HP가 0 이하가 되는 순간 즉시 종료하고 남은 처리는 하지 않는다. 양측 동시 사망은 플레이어 승리.
// 확정 사항: 기절은 남은 대기 시간의 감소만 막는다. 이미 대기 시간이 0이 되어 대기열에 든 행동은 그대로 실행된다.

import { BALANCE } from '../config/balance.ts';
import { synergyStates } from '../data/synergies.ts';
import { clampN, lv, mulDiv, mulDivRound } from '../core/num.ts';
import { baseStats, computeUnit, findUnitGrowth, monsterName } from '../data/growth.ts';
import { dummyLeaderDef, findGrowth, LEADER_MAP, leaderPath } from '../data/leaders.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import { DIR_OFFSETS, GRADE_NAMES, hasteInterval, MAX_GRADE, STATUS_IDS } from '../data/types.ts';
import type { Effect, GrowthDef, LNum, PermanentStat, Scale, Side, StatusId, Tag, Trigger, UnitFilter } from '../data/types.ts';
import type { BattleGains, BattleInput, BattleResult, BEvent, TeamSnapshot, TimelinePoint, UnitStats, UnitSummary } from './types.ts';

const TPS = BALANCE.ticksPerSec;
const TRINKET_ANCHOR = { row: 1, col: 1 }; // 장신구의 기준 칸 = 보드 중앙 (2행 2열, 5번 칸)

interface BUnit {
  uid: string;
  defId: string; // 몬스터·리더 id (태그 시너지는 같은 id를 한 번만 센다)
  inert?: boolean; // 더미 리더: 어떤 경우에도 행동하지 않는다 (지휘 같은 강제 행동 포함)
  side: Side;
  slot: number;
  row: number; // 0~2
  col: number; // 0~2
  name: string;
  level: number;
  isLeader: boolean;
  tags: Tag[];
  hp: number; // 합산 HP에 더해지는 이 유닛의 체력
  atk: number;
  startAtk: number;
  power: number; // 주문력
  startPower: number;
  baseInterval: number;
  haste: number; // 가속 합계 (성장·영구 강화·전투 중 효과)
  slotPermille: number; // 칸 효과의 행동 간격 배율 곱 (3열·3행). 1열 0.7배는 맨 마지막에 따로
  interval: number; // 행동 간격(tick)
  wait: number; // 남은 대기 시간(tick)
  extra: number; // 추가발동
  healShieldPct: number;
  stunUntil: number; // 이 tick 전까지 기절
  triggers: Trigger[];
  base: UnitStats;
  init: UnitStats;
  acts: number;
  damage: number;
  heal: number;
  shield: number;
  statusDamage: number; // 위 damage 중 팀 상태(독·화상·괴사·가시)로 낸 몫
  statusHeal: number; // 위 heal 중 재생으로 낸 몫
  buffDamage: number; // 위 damage 중 다른 유닛에게 건 전투 한정 버프(강화 상태·공격력·주문력)가 낸 몫
  buffHeal: number;
  buffShield: number;
  // 지금 공격력·주문력 중 이번 전투에서 다른 아군(유닛 uid, 장신구는 진영별)이 올려 준 몫. 나머지는 자기 몫 (영구 강화 포함)
  atkBy: Map<string, number>;
  powerBy: Map<string, number>;
}

interface BTeam {
  side: Side;
  hp: number;
  maxHp: number;
  shield: number;
  status: Record<StatusId, number>;
  // 팀 상태 기여 장부: 상태별로 "누가 몇 중첩을 걸었나" (유닛 uid, 장신구는 진영별로 묶음). 줄어들면 비율대로 같이 줄인다
  ledger: Record<StatusId, Map<string, number>>;
  lostMax: number; // 괴사처럼 최대 체력을 깎는 피해로 잃은 양 (시간 초과 판정은 원래 최대 체력 기준)
  gold: number; // 전투 시점 골드 (비례 출처)
  units: BUnit[];
  trinkets: string[];
}

interface Ctx {
  side: Side;
  unit: BUnit | null; // null = 시스템(장신구 등)
  consumed?: number; // 상태 소모 효과 안: 이번에 소모한 중첩 (비례 출처)
  paidHp?: number; // 체력 소모 효과 안: 이번에 소모한 아군 체력 (비례 출처)
  anchor?: { row: number; col: number }; // 유닛이 없을 때 위치 기준 대상의 기준 칸 (장신구 = 중앙)
  actor?: BUnit; // 반응 트리거 안: 반응한 그 유닛 (따라 하기)
  level: number;
  src: string;
  srcName: string;
}

interface QItem {
  side: number; // -1 = 양측 공통 시스템
  slot: number;
  seq: number;
  run: () => void;
}

const byQueueKey = (a: QItem, b: QItem) => a.side - b.side || a.slot - b.slot || a.seq - b.seq;

function dayIndex(arr: number[], day: number): number {
  return arr[Math.max(0, Math.min(day, arr.length) - 1)];
}

// "보스·엘리트전에서만" 같은 노드 조건 (boss는 최종 보스 포함). 조건이 없으면 항상
let battleNode: BattleInput['node'] = 'normal';
const activeHere = (t: Trigger) =>
  !t.onlyIn?.length || t.onlyIn.some((k) => k === battleNode || (k === 'boss' && battleNode === 'final'));

function buildTeam(snap: TeamSnapshot, side: Side, input: BattleInput): BTeam {
  const deployed = snap.board.length;
  const slotCfg = BALANCE.slot;
  const units: BUnit[] = [...snap.board].sort((a, b) => a.slot - b.slot).map((e) => {
    const isLeader = e.kind === 'leader';
    const def = isLeader ? (LEADER_MAP[e.defId] ?? dummyLeaderDef(e.defId)) : MONSTER_MAP[e.defId];
    if (!def) throw new Error(`unknown unit ${e.defId}`);
    const pct = isLeader
      ? 100 + BALANCE.leader.statPctPerLevel * (e.level - 1)
      : BALANCE.unit.levelStatPct[e.level - 1];
    const growths = (isLeader
      ? snap.growth.map((id) => findGrowth(snap.leaderId, id))
      : (e.growth ?? []).map((id) => findUnitGrowth(e.defId, id))
    ).filter((g): g is GrowthDef => !!g);
    const c = computeUnit(def, pct, growths, e.bonus);
    const u: BUnit = {
      uid: `${side}-${e.slot}`,
      defId: e.defId,
      side,
      slot: e.slot,
      row: Math.floor((e.slot - 1) / 3),
      col: (e.slot - 1) % 3,
      name: isLeader ? leaderPath(e.defId, snap.growth)?.name || def.name : monsterName(e.defId, e.growth), // 전직하면 전직 이름으로
      level: e.level,
      isLeader,
      ...(isLeader && !LEADER_MAP[e.defId] ? { inert: true } : {}),
      tags: c.tags,
      hp: c.hp,
      atk: c.atk,
      startAtk: 0,
      power: c.power,
      startPower: 0,
      baseInterval: def.intervalTicks,
      haste: c.haste,
      slotPermille: 1000,
      interval: def.intervalTicks,
      wait: 0,
      extra: c.extra,
      healShieldPct: c.healShieldPct,
      stunUntil: 0,
      triggers: c.triggers.filter(activeHere),
      base: baseStats(def, c),
      init: null as unknown as UnitStats, // 칸 효과 적용 뒤 채운다
      acts: 0,
      damage: 0,
      heal: 0,
      shield: 0,
      statusDamage: 0,
      statusHeal: 0,
      buffDamage: 0,
      buffHeal: 0,
      buffShield: 0,
      atkBy: new Map(),
      powerBy: new Map(),
    };
    // 칸 효과: 열
    if (u.col === 0) u.stunUntil = slotCfg.col1.stunTicks; // 0.7배는 recalcInterval에서 마지막에 적용
    if (u.col === 1) u.hp = mulDiv(u.hp, 100 + slotCfg.col2.hpPctPerDeployed * deployed, 100);
    if (u.col === 2) u.slotPermille = mulDiv(u.slotPermille, slotCfg.col3.intervalPermille, 1000);
    // 칸 효과: 행
    if (u.row === 0) u.atk += dayIndex(slotCfg.row1.atkBonusByDay, input.day);
    if (u.row === 1) u.healShieldPct += slotCfg.row2.healShieldPct;
    if (u.row === 2) {
      u.slotPermille = mulDiv(u.slotPermille, slotCfg.row3.intervalPermille, 1000);
      u.extra += slotCfg.row3.extra;
    }
    // 환경: 공격 증가
    if (input.env === 'atk') u.atk += dayIndex(BALANCE.env.atk.atkBonusByDay, input.day);
    recalcInterval(u);
    u.init = { hp: u.hp, atk: u.atk, power: u.power, interval: u.interval, haste: u.haste, extra: u.extra, healShieldPct: u.healShieldPct };
    return u;
  });
  let maxHp = units.reduce((s, u) => clampN(s + u.hp), 0);
  // 일차별 체력 배율: 양측 모두 같은 일차 기준이라 공평하다
  maxHp = mulDiv(maxHp, dayIndex(BALANCE.scaling.hpPctByDay, input.day), 100);
  if (input.env === 'hp') maxHp = mulDiv(maxHp, 100 + BALANCE.env.hp.maxHpPct, 100);
  return {
    side,
    hp: maxHp,
    maxHp,
    shield: 0,
    status: Object.fromEntries(STATUS_IDS.map((id) => [id, 0])) as Record<StatusId, number>,
    ledger: Object.fromEntries(STATUS_IDS.map((id) => [id, new Map<string, number>()])) as Record<StatusId, Map<string, number>>,
    lostMax: 0,
    gold: Math.max(0, snap.gold ?? 0),
    units,
    trinkets: snap.trinkets.filter((id) => TRINKET_MAP[id]), // 중복 보유분은 그대로 중첩된다
  };
}

// 행동 간격 = 기본 × 100 / (100 + 가속) → 칸 효과 배율 → 1열 0.7배 → 최소 간격
function recalcInterval(u: BUnit) {
  let v = mulDiv(hasteInterval(u.baseInterval, u.haste), u.slotPermille, 1000);
  if (u.col === 0) v = mulDiv(v, BALANCE.slot.col1.intervalPermille, 1000);
  u.interval = Math.max(BALANCE.engine.minIntervalTicks, v);
}

export function simulateBattle(input: BattleInput): BattleResult {
  battleNode = input.node ?? 'normal';
  const teams: [BTeam, BTeam] = [buildTeam(input.player, 0, input), buildTeam(input.enemy, 1, input)];
  const events: BEvent[] = [];
  const timeline: TimelinePoint[] = [];
  const totals = new Map<string, { src: string; srcName: string; side: Side; damage: number; heal: number; shield: number }>();
  const st = { t: 0, ended: null as Side | null, seq: 0, suddenDeath: false, sdDamage: BALANCE.suddenDeath.baseDamage };
  const gains: [BattleGains, BattleGains] = [
    { gold: 0, trinkets: [], permanent: [] },
    { gold: 0, trinkets: [], permanent: [] },
  ];

  const emit = (e: Omit<BEvent, 't'>) => {
    events.push({ t: st.t, ...e });
  };

  const credit = (ctx: Ctx, kind: 'damage' | 'heal' | 'shield', amount: number) => {
    let rec = totals.get(ctx.src);
    if (!rec) {
      rec = { src: ctx.src, srcName: ctx.srcName, side: ctx.side, damage: 0, heal: 0, shield: 0 };
      totals.set(ctx.src, rec);
    }
    rec[kind] = clampN(rec[kind] + amount);
    if (ctx.unit) ctx.unit[kind] = clampN(ctx.unit[kind] + amount);
  };

  const checkEnd = (): boolean => {
    if (st.ended !== null) return true;
    const d0 = teams[0].hp <= 0;
    const d1 = teams[1].hp <= 0;
    if (!d0 && !d1) return false;
    st.ended = d0 && !d1 ? 1 : 0; // 동시 사망은 플레이어(0) 승리
    return true;
  };

  // ── 팀 상태 기여 장부 ──
  // 시너지가 건 상태는 시너지 몫으로 (장신구와 따로)
  const contributor = (ctx: Ctx) => (ctx.unit ? ctx.unit.uid : ctx.src.startsWith('synergy:') ? ctx.src : `trinkets:${ctx.side}`);
  const keyName = (key: string) => (key.startsWith('synergy:') ? `<시너지> ${key.split(':')[2]}` : '장신구');
  const ledgerAdd = (team: BTeam, sid: StatusId, ctx: Ctx, n: number) => {
    const book = team.ledger[sid];
    const k = contributor(ctx);
    book.set(k, (book.get(k) ?? 0) + n);
  };
  // 중첩이 before → after로 줄면 모든 기여를 같은 비율로 줄인다 (감쇠·정화·해주·소모·상호작용)
  const ledgerScale = (team: BTeam, sid: StatusId, before: number, after: number) => {
    const book = team.ledger[sid];
    if (after <= 0) book.clear();
    else if (before > 0 && after !== before) for (const [k, v] of book) book.set(k, (v * after) / before);
  };
  const unitById = new Map<string, BUnit>();
  for (const team of teams) for (const u of team.units) unitById.set(u.uid, u);
  const creditKey = (key: string, kind: 'damage' | 'heal' | 'shield', amount: number, via: 'status' | 'buff' = 'status', from?: BUnit) => {
    if (amount <= 0) return;
    const u = unitById.get(key);
    const side = (u ? u.side : Number(key.split(':')[1])) as Side;
    let rec = totals.get(key);
    if (!rec) {
      rec = { src: key, srcName: u ? u.name : keyName(key), side, damage: 0, heal: 0, shield: 0 };
      totals.set(key, rec);
    }
    rec[kind] = clampN(rec[kind] + amount);
    if (u) {
      u[kind] = clampN(u[kind] + amount);
      if (via === 'buff') {
        const f = kind === 'damage' ? 'buffDamage' : kind === 'heal' ? 'buffHeal' : 'buffShield';
        u[f] = clampN(u[f] + amount);
      } else if (kind === 'damage') u.statusDamage = clampN(u.statusDamage + amount);
      else if (kind === 'heal') u.statusHeal = clampN(u.statusHeal + amount);
    }
    // from: 버프 몫은 행동한 유닛의 기록에서 옮겨 온다 (재생 화면이 그 유닛 몫에서 빼도록)
    if (u || from) emit({ type: 'credit', side, src: key, srcName: u ? u.name : keyName(key), amount, note: kind, target: from?.uid });
  };
  // 상태가 낸 피해·회복을 기여 비율대로 나눠 기록한다 (정수, 나머지는 큰 몫부터)
  const splitBook = (book: Map<string, number>, amount: number): [string, number][] => {
    const entries = [...book].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (amount <= 0 || total <= 0) return [];
    const shares = entries.map(([k, v]) => [k, Math.floor((amount * v) / total)] as [string, number]);
    let rest = amount - shares.reduce((s, [, n]) => s + n, 0);
    for (let i = 0; rest > 0; i = (i + 1) % shares.length, rest--) shares[i][1]++;
    return shares;
  };
  const attribute = (team: BTeam, sid: StatusId, kind: 'damage' | 'heal', amount: number, fallback: Ctx) => {
    if (amount <= 0) return;
    const shares = splitBook(team.ledger[sid], amount);
    if (!shares.length) return credit(fallback, kind, amount);
    for (const [k, n] of shares) creditKey(k, kind, n);
  };
  // 전투 한정 버프 몫: shares(전체 whole 기준)를 실제 들어간 amount 비율로 줄여 버프를 건 쪽에, 나머지는 행동한 쪽에 기록
  type Shares = { whole: number; list: [string, number][] };
  const creditSplit = (ctx: Ctx, kind: 'damage' | 'heal' | 'shield', amount: number, sh: Shares) => {
    let given = 0;
    for (const [k, n0] of sh.list) {
      if (ctx.unit && k === ctx.unit.uid) continue;
      const n = Math.min(amount - given, sh.whole > 0 && amount !== sh.whole ? Math.floor((n0 * amount) / sh.whole) : n0);
      if (n <= 0) continue;
      given += n;
      creditKey(k, kind, n, 'buff', ctx.unit ?? undefined);
    }
    credit(ctx, kind, amount - given);
  };
  // 전투 중 공격력·주문력이 before → 지금 값으로 바뀐 뒤 호출. 다른 아군이 올려 주면 그쪽 몫, 내려가면 모든 몫을 같은 비율로
  const shareStat = (x: BUnit, stat: 'atk' | 'power', before: number, ctx: Ctx | null) => {
    const book = stat === 'atk' ? x.atkBy : x.powerBy;
    const after = x[stat];
    if (after < before) {
      if (after <= 0) book.clear();
      else for (const [k, v] of book) book.set(k, (v * after) / before);
    } else if (after > before && ctx && ctx.side === x.side) {
      const k = contributor(ctx);
      if (k !== x.uid) book.set(k, (book.get(k) ?? 0) + after - before);
    }
  };
  // 능력치 비례 항(stat × pct%)을 그 능력치를 올려 준 쪽들에게 나눈 몫을 out에 더한다
  const statShares = (u: BUnit, stat: 'atk' | 'power', part: number, out: Map<string, number>) => {
    const book = stat === 'atk' ? u.atkBy : u.powerBy;
    if (part <= 0 || u[stat] <= 0) return;
    for (const [k, v] of book) {
      const n = Math.floor((part * Math.min(v, u[stat])) / u[stat]);
      if (n > 0) out.set(k, (out.get(k) ?? 0) + n);
    }
  };
  const toShares = (whole: number, out: Map<string, number>): Shares => ({ whole, list: [...out] });
  type Attr = { team: BTeam; sid: StatusId };

  // 체력에 실제로 들어간 피해(실드 흡수 뒤)를 돌려준다. by = 팀 상태가 낸 피해면 그 상태에 건 쪽들에게, 버프 몫이면 버프를 건 쪽들에게 나눠 기록
  const dealDamage = (target: Side, amount: number, ctx: Ctx, bypassShield: boolean, by?: Attr | Shares): number => {
    const team = teams[target];
    let rest = clampN(amount);
    if (rest <= 0) return 0;
    let absorbed = 0;
    if (!bypassShield && team.shield > 0) {
      absorbed = Math.min(team.shield, rest);
      team.shield -= absorbed;
      rest -= absorbed;
    }
    team.hp = clampN(team.hp - rest);
    if (by && 'sid' in by) attribute(by.team, by.sid, 'damage', amount, ctx);
    else if (by) creditSplit(ctx, 'damage', amount, by);
    else credit(ctx, 'damage', amount);
    emit({
      type: 'damage', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${target}`,
      amount, after: team.hp, shieldAfter: team.shield,
      note: [bypassShield && ctx.unit ? '관통' : '', absorbed > 0 ? `실드 ${absorbed} 흡수` : ''].filter(Boolean).join(', ') || undefined,
    });
    checkLow();
    checkEnd();
    return rest;
  };

  // ── "아군 체력 N% 이하가 될 때" 트리거 (1회) ──
  // 체력이 줄어든 순간 조건을 확인해 대기열에 넣고, 지금 처리 중인 항목이 끝난 직후에 발동한다 (같은 tick 안)
  const lowHp: { side: Side; pct: number; run: () => void; fired: boolean }[] = [];
  const lowPending: (() => void)[] = [];
  function checkLow() {
    for (const l of lowHp) {
      if (l.fired) continue;
      const team = teams[l.side];
      if (team.hp * 100 <= l.pct * team.maxHp) {
        l.fired = true;
        lowPending.push(l.run);
      }
    }
  }
  const drainLow = () => {
    while (lowPending.length > 0 && st.ended === null) lowPending.shift()!();
  };

  const healTeam = (side: Side, amount: number, ctx: Ctx, by?: Attr | Shares) => {
    const team = teams[side];
    const actual = Math.max(0, Math.min(clampN(amount), team.maxHp - team.hp));
    if (amount <= 0) return;
    team.hp = clampN(team.hp + actual);
    if (by && 'sid' in by) attribute(by.team, by.sid, 'heal', actual, ctx);
    else if (by) creditSplit(ctx, 'heal', actual, by);
    else credit(ctx, 'heal', actual);
    emit({ type: 'heal', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${side}`, amount: actual, after: team.hp });
  };

  // 대상 선택. 기준 칸 = 아군 대상이면 자신의 칸, 상대 대상이면 같은 번호의 칸(대칭 위치).
  // 장신구처럼 유닛이 없는 효과는 중앙 칸(2행 2열)이 기준 칸이다 (ctx.anchor). 기준 칸이 없으면 위치 기반 대상은 없다.
  const resolve = (f: UnitFilter, ctx: Ctx): BUnit[] => {
    const pool = teams[f.side === 'ally' ? ctx.side : 1 - ctx.side].units;
    const u = ctx.unit;
    const at = u ?? ctx.anchor;
    let list: BUnit[];
    if (f.area === 'all') list = pool;
    else if (!at) list = [];
    else if (f.area === 'sameRow') list = pool.filter((x) => x.row === at.row);
    else if (f.area === 'sameCol') list = pool.filter((x) => x.col === at.col);
    else {
      const cells = (f.dirs ?? []).map((d) => [at.row + DIR_OFFSETS[d][0], at.col + DIR_OFFSETS[d][1]]);
      list = pool.filter((x) => cells.some(([r, c]) => x.row === r && x.col === c));
    }
    return list.filter((x) =>
      (!f.tag || x.tags.includes(f.tag)) &&
      (!f.row || x.row === f.row - 1) &&
      (!f.col || x.col === f.col - 1) &&
      (!f.kind || (f.kind === 'leader') === x.isLeader) &&
      (!f.excludeSelf || x !== u));
  };

  const buffNote = (x: BUnit, stat: 'atk' | 'power' | 'interval' | 'extra', after: number, what: string) =>
    emit({ type: 'buff', side: x.side, src: x.uid, srcName: x.name, target: x.uid, stat, after, note: what, haste: stat === 'interval' ? x.haste : undefined });

  // 비례 출처의 지금 값 ("내 X만큼")
  const scaleSource = (sc: Scale, ctx: Ctx): number => {
    const u = ctx.unit;
    const ally = teams[ctx.side];
    const foe = teams[1 - ctx.side];
    switch (sc.src) {
      case 'atk': return u?.atk ?? 0;
      case 'power': return u?.power ?? 0;
      case 'hp': return u?.hp ?? 0;
      case 'haste': return u?.haste ?? 0;
      case 'extra': return u?.extra ?? 0;
      case 'acts': return u?.acts ?? 0;
      case 'consumed': return ctx.consumed ?? 0;
      case 'paidHp': return ctx.paidHp ?? 0;
      case 'gold': return ally.gold;
      case 'allyStatus': return ally.status[sc.status ?? 'poison'] ?? 0;
      case 'enemyStatus': return foe.status[sc.status ?? 'poison'] ?? 0;
      case 'allyShield': return ally.shield;
      case 'allyMissingHp': return Math.max(0, ally.maxHp - ally.hp);
      case 'enemyMissingHp': return Math.max(0, foe.maxHp - foe.hp);
      case 'allyCount':
      case 'enemyCount':
        return (sc.src === 'allyCount' ? ally : foe).units.filter((x) =>
          (!sc.tag || x.tags.includes(sc.tag)) && (!sc.kind || (sc.kind === 'leader') === x.isLeader)).length;
      default: return 0;
    }
  };
  // 비례 항의 합. 팀 상태 중첩은 반올림, 나머지는 내림 (기존 주문력 % 규칙과 같다)
  // out: 공격력·주문력 비례 항 중 다른 아군이 올려 준 몫을 모은다 (전투 기록 나누기용)
  const scaled = (scales: Scale[] | undefined, ctx: Ctx, round = false, out?: Map<string, number>) =>
    (scales ?? []).reduce((sum, sc) => {
      const v = scaleSource(sc, ctx);
      const pct = lv(sc.pct, ctx.level);
      const term = round ? mulDivRound(v, pct, 100) : mulDiv(v, pct, 100);
      if (out && ctx.unit && (sc.src === 'atk' || sc.src === 'power')) statShares(ctx.unit, sc.src, term, out);
      return clampN(sum + term);
    }, 0);

  // 공격력 x% + 주문력 x% + 고정값 + 비례 (유닛이 없는 시스템 효과는 유닛 능력치 항이 0)
  const baseAmount = (e: { atkPct?: LNum; powerPct?: LNum; flat?: LNum; scales?: Scale[] }, ctx: Ctx, out?: Map<string, number>) => {
    const u = ctx.unit;
    const L = ctx.level;
    let amount = lv(e.flat, L) + scaled(e.scales, ctx, false, out);
    if (u) {
      const a = mulDiv(u.atk, lv(e.atkPct, L), 100);
      const p = mulDiv(u.power, lv(e.powerPct, L), 100);
      if (out) {
        statShares(u, 'atk', a, out);
        statShares(u, 'power', p, out);
      }
      amount += a + p;
    }
    return amount;
  };

  // 영구 강화: 이번 전투에도 바로 적용한다 (전투 후 유닛에 남는 것은 gains로 따로 기록)
  const applyPermanent = (x: BUnit, stat: PermanentStat, amount: number, ctx: Ctx) => {
    const tag = `(영구, ${ctx.srcName})`;
    switch (stat) {
      case 'atk': {
        const before = x.atk;
        x.atk = Math.max(0, clampN(x.atk + amount));
        shareStat(x, 'atk', before, null);
        buffNote(x, 'atk', x.atk, `공격력 영구 +${amount} → ${x.atk} ${tag}`);
        break;
      }
      case 'power': {
        const before = x.power;
        x.power = Math.max(0, clampN(x.power + amount));
        shareStat(x, 'power', before, null);
        buffNote(x, 'power', x.power, `주문력 영구 +${amount} → ${x.power} ${tag}`);
        break;
      }
      case 'extra':
        x.extra = Math.max(0, clampN(x.extra + amount));
        buffNote(x, 'extra', x.extra, `추가발동 영구 +${amount} → ${x.extra} ${tag}`);
        break;
      case 'haste':
        x.haste = clampN(x.haste + amount);
        recalcInterval(x);
        buffNote(x, 'interval', x.interval, `가속 영구 ${amount > 0 ? '+' : ''}${amount} → ${x.haste} (${x.interval / TPS}s) ${tag}`);
        break;
      case 'hp': {
        // 유닛 체력은 합산 HP에 들어가므로 팀 최대 체력과 현재 체력을 함께 올린다
        const team = teams[x.side];
        x.hp = Math.max(1, clampN(x.hp + amount));
        team.maxHp = clampN(team.maxHp + amount);
        team.hp = clampN(team.hp + amount);
        emit({ type: 'buff', side: x.side, src: x.uid, srcName: x.name, target: `team${x.side}`, stat: 'maxHp', amount, after: team.maxHp, unit: x.uid, note: `${x.name} 체력 영구 +${amount} ${tag}` });
        break;
      }
    }
  };

  const applyEffect = (e: Effect, ctx: Ctx) => {
    const L = ctx.level;
    const u = ctx.unit;
    switch (e.type) {
      case 'damage': {
        const out = new Map<string, number>();
        let amount = baseAmount(e, ctx, out);
        if (u) {
          const fury = teams[ctx.side].status.fury * BALANCE.statuses.fury.perStack;
          amount += fury;
          for (const [k, n] of splitBook(teams[ctx.side].ledger.fury, fury)) out.set(k, (out.get(k) ?? 0) + n);
        }
        if (amount <= 0) break;
        const foe = (1 - ctx.side) as Side;
        dealDamage(foe, amount, ctx, !!e.pierce, out.size ? toShares(amount, out) : undefined);
        // 가시: 유닛의 피해 효과를 받을 때마다 공격한 쪽에 중첩만큼 되돌려 준다 (추가발동도 1회씩 따로 맞는다)
        const thorns = teams[foe].status.thorns;
        if (u && thorns > 0 && st.ended === null) {
          const cfg = BALANCE.statuses.thorns;
          const back: Ctx = { side: foe, unit: null, level: 1, src: `status:${foe}:thorns`, srcName: cfg.name };
          dealDamage(ctx.side, clampN(thorns * cfg.perStack), back, cfg.bypassShield, { team: teams[foe], sid: 'thorns' });
        }
        break;
      }
      case 'heal': {
        const out = new Map<string, number>();
        let amount = baseAmount(e, ctx, out);
        if (u) {
          amount = mulDiv(amount, u.healShieldPct, 100);
          for (const [k, n] of out) out.set(k, mulDiv(n, u.healShieldPct, 100));
        }
        healTeam(ctx.side, amount, ctx, out.size ? toShares(amount, out) : undefined);
        break;
      }
      case 'shield': {
        const out = new Map<string, number>();
        let amount = baseAmount(e, ctx, out);
        if (u) {
          amount += mulDiv(u.hp, lv(e.hpPct, L), 100);
          amount = mulDiv(amount, u.healShieldPct, 100);
          for (const [k, n] of out) out.set(k, mulDiv(n, u.healShieldPct, 100));
        }
        if (amount <= 0) break;
        const team = teams[ctx.side];
        team.shield = clampN(team.shield + amount);
        creditSplit(ctx, 'shield', amount, toShares(amount, out));
        emit({ type: 'shield', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${ctx.side}`, amount, after: team.shield });
        break;
      }
      case 'status': {
        // 중첩 = 주문력 x% (반올림) + 고정값 + 비례
        const n = (u ? mulDivRound(u.power, lv(e.powerPct, L), 100) : 0) + lv(e.flat, L) + scaled(e.scales, ctx, true);
        if (n <= 0) break;
        const target = (e.to === 'ally' ? ctx.side : 1 - ctx.side) as Side;
        const team = teams[target];
        team.status[e.status] = clampN(team.status[e.status] + n);
        ledgerAdd(team, e.status, ctx, n);
        emit({
          type: 'status', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${target}`,
          amount: n, after: team.status[e.status], note: BALANCE.statuses[e.status].name, status: e.status,
        });
        break;
      }
      case 'atkFlat': {
        const add = lv(e.amount, L) + scaled(e.scales, ctx); // 대상마다 다시 계산하지 않는다 (자기 강화 중 값이 바뀌지 않게)
        for (const x of resolve(e.target, ctx)) {
          const before = x.atk;
          x.atk = Math.max(0, clampN(x.atk + add));
          shareStat(x, 'atk', before, ctx);
          buffNote(x, 'atk', x.atk, `공격력 ${before}→${x.atk} (${ctx.srcName})`);
        }
        break;
      }
      case 'atkPct':
        for (const x of resolve(e.target, ctx)) {
          const before = x.atk;
          x.atk = Math.max(0, mulDiv(x.atk, 100 + lv(e.pct, L), 100));
          shareStat(x, 'atk', before, ctx);
          buffNote(x, 'atk', x.atk, `공격력 ${before}→${x.atk} (${ctx.srcName})`);
        }
        break;
      case 'powerFlat': {
        const add = lv(e.amount, L) + scaled(e.scales, ctx);
        for (const x of resolve(e.target, ctx)) {
          const before = x.power;
          x.power = Math.max(0, clampN(x.power + add));
          shareStat(x, 'power', before, ctx);
          buffNote(x, 'power', x.power, `주문력 ${before}→${x.power} (${ctx.srcName})`);
        }
        break;
      }
      case 'powerPct':
        for (const x of resolve(e.target, ctx)) {
          const before = x.power;
          x.power = Math.max(0, mulDiv(x.power, 100 + lv(e.pct, L), 100));
          shareStat(x, 'power', before, ctx);
          buffNote(x, 'power', x.power, `주문력 ${before}→${x.power} (${ctx.srcName})`);
        }
        break;
      case 'haste': {
        const add = lv(e.amount, L) + scaled(e.scales, ctx);
        for (const x of resolve(e.target, ctx)) {
          const before = x.interval;
          x.haste = clampN(x.haste + add);
          recalcInterval(x);
          buffNote(x, 'interval', x.interval, `가속 ${add > 0 ? '+' : ''}${add} → ${x.haste}, 행동 간격 ${before / TPS}s→${x.interval / TPS}s (${ctx.srcName})`);
        }
        break;
      }
      case 'extra': {
        const add = lv(e.amount, L) + scaled(e.scales, ctx);
        for (const x of resolve(e.target, ctx)) {
          x.extra = clampN(x.extra + add);
          buffNote(x, 'extra', x.extra, `추가발동 ${x.extra} (${ctx.srcName})`);
        }
        break;
      }
      case 'stun':
        for (const x of resolve(e.target, ctx)) {
          x.stunUntil = Math.max(x.stunUntil, st.t + lv(e.ticks, L));
          emit({ type: 'stun', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: x.uid, amount: lv(e.ticks, L), note: x.name });
        }
        break;
      case 'consume': {
        const team = teams[e.from === 'enemy' ? 1 - ctx.side : ctx.side];
        const have = team.status[e.status] ?? 0;
        const need = Math.max(1, lv(e.cost, L));
        if (have < need) break; // 모자라면 아무 일도 없다
        const spend = e.all ? have : need;
        team.status[e.status] = have - spend;
        ledgerScale(team, e.status, have, have - spend);
        emit({
          type: 'status', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${team.side}`,
          amount: -spend, after: team.status[e.status], note: `${BALANCE.statuses[e.status]?.name ?? e.status} 소모`, status: e.status,
        });
        say(e.say, ctx);
        runEffects(e.effects, { ...ctx, consumed: spend });
        break;
      }
      case 'hpCost': {
        const team = teams[ctx.side];
        const want = mulDiv(team.hp, lv(e.pct, L), 100) + lv(e.flat, L);
        const paid = Math.max(0, Math.min(want, team.hp - 1)); // 스스로 쓰러지지는 않는다
        if (paid <= 0) break;
        team.hp = clampN(team.hp - paid);
        emit({ type: 'hpCost', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${ctx.side}`, amount: paid, after: team.hp, note: '체력 소모' });
        say(e.say, ctx);
        checkLow();
        runEffects(e.effects ?? [], { ...ctx, paidHp: paid });
        break;
      }
      case 'cleanse':
      case 'dispel': {
        // 정화 = 아군의 해로운 상태, 해주 = 상대의 이로운 상태
        const cleanse = e.type === 'cleanse';
        const team = teams[cleanse ? ctx.side : 1 - ctx.side];
        let ids = STATUS_IDS.filter((id) => !!BALANCE.statuses[id]?.harmful === cleanse && team.status[id] > 0);
        if (e.scope === 'largest' && ids.length > 1) ids = [ids.reduce((a, b) => (team.status[b] > team.status[a] ? b : a))];
        for (const id of ids) {
          const have = team.status[id];
          const cut = Math.min(have, mulDiv(have, lv(e.pct, L), 100) + lv(e.flat, L));
          if (cut <= 0) continue;
          team.status[id] = have - cut;
          ledgerScale(team, id, have, have - cut);
          emit({
            type: 'status', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${team.side}`,
            amount: -cut, after: team.status[id], note: `${cleanse ? '정화' : '해주'}: ${BALANCE.statuses[id].name}`, status: id,
          });
        }
        break;
      }
      case 'maxHpPct': {
        const team = teams[ctx.side];
        const add = mulDiv(team.maxHp, lv(e.pct, L), 100);
        team.maxHp = clampN(team.maxHp + add);
        team.hp = clampN(team.hp + add);
        emit({ type: 'buff', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${ctx.side}`, stat: 'maxHp', amount: add, after: team.maxHp, note: `최대 체력 +${add}` });
        break;
      }
      // ── 전투 밖으로 이어지는 효과 ──
      case 'permanent': {
        const amount = lv(e.amount, L);
        if (!amount) break;
        for (const x of resolve(e.target, ctx)) {
          applyPermanent(x, e.stat, amount, ctx);
          const list = gains[x.side].permanent;
          const rec = list.find((p) => p.slot === x.slot && p.stat === e.stat);
          if (rec) rec.amount = clampN(rec.amount + amount);
          else list.push({ slot: x.slot, stat: e.stat, amount });
        }
        break;
      }
      case 'gold': {
        const g = gains[ctx.side];
        const add = Math.max(0, Math.min(lv(e.amount, L), BALANCE.battleGains.maxGoldPerBattle - g.gold));
        if (add <= 0) break;
        g.gold += add;
        emit({ type: 'gain', side: ctx.side, src: ctx.src, srcName: ctx.srcName, amount: add, note: `골드 +${add}` });
        break;
      }
      case 'mimic': {
        // 반응한 유닛의 행동 효과를 내 능력치·내 편 기준으로 (영구 강화·골드·장신구 획득도 내 편이 얻는다). 따라 하기만 빼서 연쇄가 없다
        const a = ctx.actor;
        if (!a) break;
        const copy: Ctx = { ...ctx, actor: undefined };
        for (const trig of a.triggers) {
          if (trig.on !== 'act') continue;
          for (const fx of trig.effects) {
            if (fx.type === 'mimic') continue;
            applyEffect(fx, copy);
            if (st.ended !== null) return;
          }
        }
        break;
      }
      case 'conduct': {
        // 태그가 있고, 자기 주변 8칸(같은 편)에 태그가 겹치는 유닛이 없는가
        const near = (a: BUnit, b: BUnit) => a !== b && Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
        const solo = (x: BUnit) => x.tags.length > 0 && !teams[x.side].units.some((y) => near(x, y) && y.tags.some((t) => x.tags.includes(t)));
        const players = resolve(e.target, ctx).filter((x) => !e.uniqueTag || solo(x));
        for (const x of players) {
          emit({ type: 'react', side: ctx.side, src: ctx.unit ? ctx.unit.uid : ctx.src, srcName: ctx.srcName, target: x.uid, note: `${x.name} 지휘` });
          act(x, true);
          if (st.ended !== null) return;
        }
        const n = players.length;
        if (n === 0) break;
        const goldPer = lv(e.goldPer, L);
        if (goldPer) applyEffect({ type: 'gold', amount: n * goldPer }, ctx);
        if (e.trinketPer && e.trinketGrade && Math.floor(n / e.trinketPer) > 0) applyEffect({ type: 'trinket', grade: e.trinketGrade, count: Math.floor(n / e.trinketPer) }, ctx);
        if (e.perfect && e.perfectTrinket && n >= e.perfect && TRINKET_MAP[e.perfectTrinket]) {
          (gains[ctx.side].named ??= []).push(e.perfectTrinket);
          emit({ type: 'gain', side: ctx.side, src: ctx.src, srcName: ctx.srcName, amount: 1, note: `완벽한 공연! ${TRINKET_MAP[e.perfectTrinket].name}` });
        }
        break;
      }
      case 'trinket': {
        const g = gains[ctx.side];
        const grade = Math.max(1, Math.min(MAX_GRADE, lv(e.grade, L)));
        const n = Math.max(0, Math.min(lv(e.count ?? 1, L), BALANCE.battleGains.maxTrinketsPerBattle - g.trinkets.length));
        if (n <= 0) break;
        for (let i = 0; i < n; i++) g.trinkets.push(grade);
        emit({ type: 'gain', side: ctx.side, src: ctx.src, srcName: ctx.srcName, amount: n, note: `${GRADE_NAMES[grade]} 장신구 +${n}` });
        break;
      }
    }
  };

  const runEffects = (effects: Effect[], ctx: Ctx) => {
    for (const e of effects) {
      applyEffect(e, ctx);
      if (st.ended !== null) return;
    }
  };

  // 능력 대사: 유닛이 낸 효과일 때만 (말풍선을 띄울 카드가 있어야 함)
  const say = (text: string | undefined, ctx: Ctx) => {
    if (text?.trim() && ctx.unit) emit({ type: 'say', side: ctx.side, src: ctx.unit.uid, srcName: ctx.unit.name, note: text });
  };

  const unitCtx = (u: BUnit): Ctx => ({ side: u.side, unit: u, level: u.level, src: u.uid, srcName: u.name });
  const trinketCtx = (side: Side, id: string): Ctx => ({ side, unit: null, anchor: TRINKET_ANCHOR, level: 1, src: `trinket:${side}:${id}`, srcName: TRINKET_MAP[id].name });

  // ── 반응 트리거: 지켜보는 유닛이 행동할 때마다 (행동 1번의 효과가 끝난 직후, 등록 순서대로) ──
  interface Reactor { trig: Trigger; owner: BUnit | null; ctx: () => Ctx; watch: Set<BUnit>; seen: number; fired: number }
  const reactors: Reactor[] = [];
  const react = (actor: BUnit) => {
    for (const r of reactors) {
      if (!r.watch.has(actor)) continue;
      if (r.owner && st.t < r.owner.stunUntil) continue; // 기절 중에는 반응하지 않는다 (세지도 않음)
      if (r.trig.limit && r.fired >= r.trig.limit) continue;
      r.seen++;
      if (r.seen % Math.max(1, r.trig.every ?? 1) !== 0) continue;
      r.fired++;
      const ctx = r.ctx();
      emit({ type: 'react', side: ctx.side, src: r.owner ? r.owner.uid : ctx.src, srcName: ctx.srcName, target: actor.uid, note: `${actor.name} 행동에 반응` });
      say(r.trig.say, ctx);
      runEffects(r.trig.effects, { ...ctx, actor });
      if (st.ended !== null) return;
    }
  };

  // forced = 지휘처럼 다른 효과가 시킨 행동: 쿨다운(대기 시간)은 건드리지 않는다
  const act = (u: BUnit, forced = false) => {
    if (u.inert) return;
    const times = 1 + Math.min(Math.max(0, u.extra), BALANCE.engine.maxExtraActs);
    const ctx = unitCtx(u);
    for (let k = 0; k < times; k++) {
      u.acts++;
      emit({ type: 'act', side: u.side, src: u.uid, srcName: u.name, note: k > 0 ? `추가발동 ${k}` : undefined });
      for (const trig of u.triggers) {
        if (trig.on !== 'act') continue;
        say(trig.say, ctx);
        runEffects(trig.effects, ctx);
        if (st.ended !== null) return;
      }
      react(u);
      if (st.ended !== null) return;
    }
    if (!forced) u.wait = u.interval;
  };

  // ── (0) 전투 시작 처리 ──
  emit({ type: 'start', side: -1, src: 'system', srcName: '전투 시작', note: input.env });
  const startQ: (QItem & { sys: number })[] = [];
  // 전투 시작 후 N초 (반복이면 N초마다, limit 회까지). every = 반복 간격 tick (0 = 1회)
  const timers: (QItem & { at: number; every: number; left: number })[] = [];
  const timerOf = (trig: Trigger, side: Side, slot: number, run: () => void) => {
    const at = (trig.atSec ?? 0) * TPS;
    return { at, every: trig.repeat && at > 0 ? at : 0, left: trig.repeat ? trig.limit ?? Infinity : 1, side, slot, seq: st.seq++, run };
  };
  for (const team of teams) {
    for (const id of team.trinkets) {
      for (const trig of TRINKET_MAP[id].triggers.filter(activeHere)) {
        const run = () => runEffects(trig.effects, trinketCtx(team.side, id));
        if (trig.on === 'battleStart') startQ.push({ sys: 0, side: team.side, slot: 0, seq: st.seq++, run });
        if (trig.on === 'timer') timers.push(timerOf(trig, team.side, 0, run));
        if (trig.on === 'lowHp') lowHp.push({ side: team.side, pct: trig.hpPct ?? 50, run, fired: false });
        if (trig.on === 'enemyLowHp') lowHp.push({ side: (1 - team.side) as Side, pct: trig.hpPct ?? 50, run, fired: false });
        if (trig.on === 'react' && trig.watch) {
          const ctx = () => trinketCtx(team.side, id);
          reactors.push({ trig, owner: null, ctx, watch: new Set(resolve(trig.watch, ctx())), seen: 0, fired: 0 });
        }
      }
    }
  }
  // 태그 시너지: 장신구처럼 시스템 효과 (기준 칸 = 중앙). 도달한 가장 높은 단계 하나만
  const synergies: NonNullable<BattleResult['synergies']> = [];
  for (const team of teams) {
    for (const st0 of synergyStates(team.units.map((u) => ({ id: u.defId, tags: u.tags })))) {
      if (st0.tier < 0) continue;
      const tier = st0.syn.tiers[st0.tier];
      const name = st0.syn.name?.trim() || st0.syn.tag;
      synergies.push({ side: team.side, tag: st0.syn.tag, name, count: st0.count, tier: st0.tier, need: tier.count });
      const ctxOf = (): Ctx => ({ side: team.side, unit: null, anchor: TRINKET_ANCHOR, level: 1, src: `synergy:${team.side}:${st0.syn.tag}`, srcName: `${name} (${st0.syn.tag} ${st0.count})` });
      for (const trig of tier.triggers.filter(activeHere)) {
        const run = () => runEffects(trig.effects, ctxOf());
        if (trig.on === 'battleStart') startQ.push({ sys: 0, side: team.side, slot: 0, seq: st.seq++, run });
        if (trig.on === 'timer') timers.push(timerOf(trig, team.side, 0, run));
        if (trig.on === 'lowHp') lowHp.push({ side: team.side, pct: trig.hpPct ?? 50, run, fired: false });
        if (trig.on === 'enemyLowHp') lowHp.push({ side: (1 - team.side) as Side, pct: trig.hpPct ?? 50, run, fired: false });
        if (trig.on === 'react' && trig.watch) reactors.push({ trig, owner: null, ctx: ctxOf, watch: new Set(resolve(trig.watch, ctxOf())), seen: 0, fired: 0 });
      }
    }
  }
  if (synergies.length) emit({ type: 'start', side: -1, src: 'system', srcName: '시너지', note: synergies.map((x) => `${x.side === 0 ? '아군' : '적군'} ${x.name} ${x.count}`).join(', ') });
  for (const team of teams) {
    for (const u of team.units) {
      for (const trig of u.triggers) {
        const run = () => {
          say(trig.say, unitCtx(u));
          runEffects(trig.effects, unitCtx(u));
        };
        if (trig.on === 'battleStart') startQ.push({ sys: 1, side: team.side, slot: u.slot, seq: st.seq++, run });
        // 전투 시작 후 N초 1회 효과는 행동이 아니라 시스템 이벤트로 처리한다.
        if (trig.on === 'timer') timers.push(timerOf(trig, team.side, u.slot, run));
        if (trig.on === 'lowHp') lowHp.push({ side: team.side, pct: trig.hpPct ?? 50, run, fired: false });
        if (trig.on === 'enemyLowHp') lowHp.push({ side: (1 - team.side) as Side, pct: trig.hpPct ?? 50, run, fired: false });
        if (trig.on === 'react' && trig.watch) {
          const ctx = () => unitCtx(u);
          reactors.push({ trig, owner: u, ctx, watch: new Set(resolve(trig.watch, ctx()).filter((x) => x !== u)), seen: 0, fired: 0 });
        }
      }
    }
  }
  startQ.sort((a, b) => a.sys - b.sys || byQueueKey(a, b));
  for (const q of startQ) {
    q.run();
    drainLow();
    if (st.ended !== null) break;
  }
  for (const team of teams) {
    for (const u of team.units) {
      u.startAtk = u.atk;
      u.startPower = u.power;
      u.wait = u.col === 2 ? 0 : u.interval; // 3열: 남은 대기 시간 0
    }
  }

  const sample = () => timeline.push({
    t: st.t, hp: [teams[0].hp, teams[1].hp], shield: [teams[0].shield, teams[1].shield],
  });
  sample();

  // ── 메인 루프 ──
  const maxTick = BALANCE.engine.maxBattleSec * TPS;
  const sd = BALANCE.suddenDeath;
  const sdStart = sd.startSec * TPS;
  const allUnits = [...teams[0].units, ...teams[1].units];
  let reason: 'ko' | 'timeout' = 'ko';

  for (st.t = 0; st.ended === null; st.t++) {
    const t = st.t;
    if (t > maxTick) {
      reason = 'timeout';
      st.t = maxTick;
      const r0 = mulDiv(Math.max(0, teams[0].hp), 1000, teams[0].maxHp + teams[0].lostMax);
      const r1 = mulDiv(Math.max(0, teams[1].hp), 1000, teams[1].maxHp + teams[1].lostMax);
      st.ended = r0 >= r1 ? 0 : 1;
      break;
    }

    // (1) 시스템 이벤트
    const sys: QItem[] = [];
    if (t >= sdStart && (t - sdStart) % TPS === 0) {
      sys.push({
        side: -1, slot: 0, seq: st.seq++, run: () => {
          st.suddenDeath = true;
          const dmg = st.sdDamage;
          for (const team of teams) {
            let rest = dmg;
            if (!sd.bypassShield) {
              const ab = Math.min(team.shield, rest);
              team.shield -= ab;
              rest -= ab;
            }
            team.hp = clampN(team.hp - rest);
          }
          emit({ type: 'sudden', side: -1, src: 'system', srcName: '서든데스', amount: dmg, note: `양측 ${dmg} 피해` });
          st.sdDamage = Math.max(1, mulDiv(st.sdDamage, sd.ratioNum, sd.ratioDen));
          checkLow();
          checkEnd(); // 양측이 동시에 쓰러지면 플레이어 승리
        },
      });
    }
    if (t > 0) {
      for (const team of teams) {
        for (const sid of STATUS_IDS) {
          const cfg = BALANCE.statuses[sid];
          if (cfg.periodTicks <= 0 || t % cfg.periodTicks !== 0 || team.status[sid] <= 0) continue;
          const source = (cfg.harmful ? 1 - team.side : team.side) as Side;
          sys.push({
            side: source, slot: 0, seq: st.seq++, run: () => {
              const stacks = team.status[sid];
              const amount = clampN(stacks * cfg.perStack);
              const ctx: Ctx = { side: source, unit: null, level: 1, src: `status:${source}:${sid}`, srcName: cfg.name };
              // 감쇠 후 중첩 수를 이벤트에 남긴다 (화면의 상태 표시용). 적용 순서는 그대로: 효과 → 감쇠
              const next = cfg.decay === 'minus1' ? Math.max(0, stacks - 1) : cfg.decay === 'half' ? Math.floor(stacks / 2) : stacks;
              emit({ type: 'statusTick', side: source, src: ctx.src, srcName: cfg.name, target: `team${team.side}`, amount: stacks, after: next, status: sid });
              if (cfg.harmful) {
                const lost = dealDamage(team.side, amount, ctx, cfg.bypassShield, { team, sid });
                if ((cfg as { maxHpLoss?: boolean }).maxHpLoss && lost > 0) {
                  // 들어간 피해만큼 최대 체력도 줄인다 (이번 전투 동안). 회복은 줄어든 최대 체력까지만 된다
                  const cut = Math.min(lost, team.maxHp - 1);
                  team.maxHp -= cut;
                  team.lostMax += cut;
                  team.hp = Math.min(team.hp, team.maxHp);
                  emit({ type: 'buff', side: source, src: ctx.src, srcName: cfg.name, target: `team${team.side}`, stat: 'maxHp', amount: -cut, after: team.maxHp, note: `최대 체력 -${cut}` });
                }
              }
              else healTeam(team.side, amount, ctx, { team, sid });
              team.status[sid] = next;
              ledgerScale(team, sid, stacks, next);
              // 상호작용: 터질 때마다 같은 팀의 다른 상태를 줄인다 (예: 화상 → 가시)
              const eroded = cfg.erodeStatus as StatusId | '';
              if (eroded && cfg.erodePct > 0 && team.status[eroded] > 0) {
                const cut = Math.min(team.status[eroded], mulDiv(stacks, cfg.erodePct, 100));
                if (cut > 0) {
                  ledgerScale(team, eroded, team.status[eroded], team.status[eroded] - cut);
                  team.status[eroded] -= cut;
                  emit({
                    type: 'status', side: source, src: ctx.src, srcName: cfg.name, target: `team${team.side}`,
                    amount: -cut, after: team.status[eroded], note: `${cfg.name}→${BALANCE.statuses[eroded]?.name ?? eroded}`, status: eroded,
                  });
                }
              }
            },
          });
        }
      }
    }
    for (const tm of timers) {
      if (tm.left <= 0 || t < tm.at || (tm.every ? (t - tm.at) % tm.every !== 0 : t !== tm.at)) continue;
      tm.left--;
      sys.push(tm);
    }
    sys.sort(byQueueKey);
    for (const q of sys) {
      q.run();
      drainLow();
      if (st.ended !== null) break;
    }
    if (st.ended !== null) break;

    // (2) 유닛 행동. 처리 중 새로 등록되는 항목은 큐 끝(등록 순번)에 붙고 되돌아가지 않는다.
    // 기절 중이면 준비가 끝났어도(대기 0) 행동하지 않고 기절이 풀리는 tick에 행동한다.
    // 같은 tick에 먼저 행동한 유닛이 건 기절도 막는다 (차례가 와도 그때 기절이면 넘긴다)
    const queue: QItem[] = allUnits
      .filter((u) => u.wait === 0 && t >= u.stunUntil)
      .map((u) => ({ side: u.side, slot: u.slot, seq: st.seq++, run: () => { if (st.t >= u.stunUntil) act(u); } }))
      .sort(byQueueKey);
    for (let i = 0; i < queue.length; i++) {
      queue[i].run();
      drainLow();
      if (st.ended !== null) break;
    }
    if (st.ended !== null) break;

    // (3) 남은 대기 시간 감소 (기절 중이면 정지)
    for (const u of allUnits) if (t >= u.stunUntil && u.wait > 0) u.wait--;
    if (t > 0 && t % TPS === 0) sample();
  }

  if (timeline[timeline.length - 1].t !== st.t) sample();
  const winner = st.ended as Side;
  emit({ type: 'end', side: winner, src: 'system', srcName: '전투 종료', note: winner === 0 ? 'player' : 'enemy' });

  const units: UnitSummary[] = allUnits.map((u) => ({
    uid: u.uid, side: u.side, slot: u.slot, name: u.name, level: u.level, isLeader: u.isLeader,
    base: u.base, init: u.init, initStun: u.col === 0 ? BALANCE.slot.col1.stunTicks : 0,
    startAtk: u.startAtk, endAtk: u.atk, startPower: u.startPower, endPower: u.power, interval: u.interval, extra: u.extra,
    acts: u.acts, damage: u.damage, heal: u.heal, shield: u.shield, statusDamage: u.statusDamage, statusHeal: u.statusHeal, buffDamage: u.buffDamage, buffHeal: u.buffHeal, buffShield: u.buffShield,
  }));

  return {
    synergies,
    winner,
    endTick: st.t,
    reason,
    suddenDeath: st.suddenDeath,
    maxHp: [teams[0].maxHp + teams[0].lostMax, teams[1].maxHp + teams[1].lostMax], // 괴사로 잃기 전 기준
    finalHp: [teams[0].hp, teams[1].hp],
    units,
    sourceTotals: [...totals.values()],
    timeline,
    events,
    gains,
  };
}
