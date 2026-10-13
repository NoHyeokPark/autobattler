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
import { clampN, lv, mulDiv, mulDivRound } from '../core/num.ts';
import { computeUnit, findUnitGrowth } from '../data/growth.ts';
import { findGrowth, LEADER_MAP } from '../data/leaders.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import { DIR_OFFSETS, GRADE_NAMES } from '../data/types.ts';
import type { Effect, GrowthDef, LNum, PermanentStat, Side, StatusId, Tag, Trigger, UnitFilter } from '../data/types.ts';
import type { BattleGains, BattleInput, BattleResult, BEvent, TeamSnapshot, TimelinePoint, UnitSummary } from './types.ts';

const TPS = BALANCE.ticksPerSec;
const STATUS_IDS: StatusId[] = ['poison', 'regen', 'fury'];

interface BUnit {
  uid: string;
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
  intervalMul: number; // permille. 칸 효과·능력의 행동 간격 보정 곱 (1열 0.7배는 별도)
  interval: number; // 행동 간격(tick)
  wait: number; // 남은 대기 시간(tick)
  extra: number; // 추가발동
  healShieldPct: number;
  stunUntil: number; // 이 tick 전까지 기절
  triggers: Trigger[];
  acts: number;
  damage: number;
  heal: number;
  shield: number;
}

interface BTeam {
  side: Side;
  hp: number;
  maxHp: number;
  shield: number;
  status: Record<StatusId, number>;
  units: BUnit[];
  trinkets: string[];
}

interface Ctx {
  side: Side;
  unit: BUnit | null; // null = 시스템(장신구 등)
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

function buildTeam(snap: TeamSnapshot, side: Side, input: BattleInput): BTeam {
  const deployed = snap.board.length;
  const slotCfg = BALANCE.slot;
  const units: BUnit[] = [...snap.board].sort((a, b) => a.slot - b.slot).map((e) => {
    const isLeader = e.kind === 'leader';
    const def = isLeader ? LEADER_MAP[e.defId] : MONSTER_MAP[e.defId];
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
      side,
      slot: e.slot,
      row: Math.floor((e.slot - 1) / 3),
      col: (e.slot - 1) % 3,
      name: def.name,
      level: e.level,
      isLeader,
      tags: c.tags,
      hp: c.hp,
      atk: c.atk,
      startAtk: 0,
      power: c.power,
      startPower: 0,
      baseInterval: def.intervalTicks,
      intervalMul: c.intervalMul,
      interval: def.intervalTicks,
      wait: 0,
      extra: c.extra,
      healShieldPct: c.healShieldPct,
      stunUntil: 0,
      triggers: c.triggers,
      acts: 0,
      damage: 0,
      heal: 0,
      shield: 0,
    };
    // 칸 효과: 열
    if (u.col === 0) u.stunUntil = slotCfg.col1.stunTicks; // 0.7배는 recalcInterval에서 마지막에 적용
    if (u.col === 1) u.hp = mulDiv(u.hp, 100 + slotCfg.col2.hpPctPerDeployed * deployed, 100);
    if (u.col === 2) u.intervalMul = mulDiv(u.intervalMul, slotCfg.col3.intervalPermille, 1000);
    // 칸 효과: 행
    if (u.row === 0) u.atk += dayIndex(slotCfg.row1.atkBonusByDay, input.day);
    if (u.row === 1) u.healShieldPct += slotCfg.row2.healShieldPct;
    if (u.row === 2) {
      u.intervalMul = mulDiv(u.intervalMul, slotCfg.row3.intervalPermille, 1000);
      u.extra += slotCfg.row3.extra;
    }
    // 환경: 공격 증가
    if (input.env === 'atk') u.atk += dayIndex(BALANCE.env.atk.atkBonusByDay, input.day);
    recalcInterval(u);
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
    status: { poison: 0, regen: 0, fury: 0 },
    units,
    trinkets: snap.trinkets.filter((id) => TRINKET_MAP[id]), // 중복 보유분은 그대로 중첩된다
  };
}

function recalcInterval(u: BUnit) {
  let v = mulDiv(u.baseInterval, u.intervalMul, 1000);
  if (u.col === 0) v = mulDiv(v, BALANCE.slot.col1.intervalPermille, 1000);
  u.interval = Math.max(BALANCE.engine.minIntervalTicks, v);
}

export function simulateBattle(input: BattleInput): BattleResult {
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

  const dealDamage = (target: Side, amount: number, ctx: Ctx, bypassShield: boolean) => {
    const team = teams[target];
    let rest = clampN(amount);
    if (rest <= 0) return;
    let absorbed = 0;
    if (!bypassShield && team.shield > 0) {
      absorbed = Math.min(team.shield, rest);
      team.shield -= absorbed;
      rest -= absorbed;
    }
    team.hp = clampN(team.hp - rest);
    credit(ctx, 'damage', amount);
    emit({
      type: 'damage', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${target}`,
      amount, after: team.hp, shieldAfter: team.shield, note: absorbed > 0 ? `실드 ${absorbed} 흡수` : undefined,
    });
    checkEnd();
  };

  const healTeam = (side: Side, amount: number, ctx: Ctx) => {
    const team = teams[side];
    const actual = Math.max(0, Math.min(clampN(amount), team.maxHp - team.hp));
    if (amount <= 0) return;
    team.hp = clampN(team.hp + actual);
    credit(ctx, 'heal', actual);
    emit({ type: 'heal', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${side}`, amount: actual, after: team.hp });
  };

  // 대상 선택. 기준 칸 = 아군 대상이면 자신의 칸, 상대 대상이면 같은 번호의 칸(대칭 위치).
  // 위치 기반(near·sameRow·sameCol)은 유닛이 없는 시스템 효과(장신구)에서는 대상이 없다.
  const resolve = (f: UnitFilter, ctx: Ctx): BUnit[] => {
    const pool = teams[f.side === 'ally' ? ctx.side : 1 - ctx.side].units;
    const u = ctx.unit;
    let list: BUnit[];
    if (f.area === 'all') list = pool;
    else if (!u) list = [];
    else if (f.area === 'sameRow') list = pool.filter((x) => x.row === u.row);
    else if (f.area === 'sameCol') list = pool.filter((x) => x.col === u.col);
    else {
      const cells = (f.dirs ?? []).map((d) => [u.row + DIR_OFFSETS[d][0], u.col + DIR_OFFSETS[d][1]]);
      list = pool.filter((x) => cells.some(([r, c]) => x.row === r && x.col === c));
    }
    return list.filter((x) =>
      (!f.tag || x.tags.includes(f.tag)) &&
      (!f.row || x.row === f.row - 1) &&
      (!f.col || x.col === f.col - 1) &&
      (!f.excludeSelf || x !== u));
  };

  const buffNote = (x: BUnit, stat: 'atk' | 'power' | 'interval' | 'extra', after: number, what: string) =>
    emit({ type: 'buff', side: x.side, src: x.uid, srcName: x.name, target: x.uid, stat, after, note: what });

  // 공격력 x% + 주문력 x% + 고정값 (유닛이 없는 시스템 효과는 고정값만)
  const baseAmount = (e: { atkPct?: LNum; powerPct?: LNum; flat?: LNum }, ctx: Ctx) => {
    const u = ctx.unit;
    const L = ctx.level;
    let amount = lv(e.flat, L);
    if (u) amount += mulDiv(u.atk, lv(e.atkPct, L), 100) + mulDiv(u.power, lv(e.powerPct, L), 100);
    return amount;
  };

  // 영구 강화: 이번 전투에도 바로 적용한다 (전투 후 유닛에 남는 것은 gains로 따로 기록)
  const applyPermanent = (x: BUnit, stat: PermanentStat, amount: number, ctx: Ctx) => {
    const tag = `(영구, ${ctx.srcName})`;
    switch (stat) {
      case 'atk':
        x.atk = Math.max(0, clampN(x.atk + amount));
        buffNote(x, 'atk', x.atk, `공격력 영구 +${amount} → ${x.atk} ${tag}`);
        break;
      case 'power':
        x.power = Math.max(0, clampN(x.power + amount));
        buffNote(x, 'power', x.power, `주문력 영구 +${amount} → ${x.power} ${tag}`);
        break;
      case 'extra':
        x.extra = Math.max(0, clampN(x.extra + amount));
        buffNote(x, 'extra', x.extra, `추가발동 영구 +${amount} → ${x.extra} ${tag}`);
        break;
      case 'intervalPct':
        x.intervalMul = Math.max(1, mulDiv(x.intervalMul, 1000 + amount * 10, 1000));
        recalcInterval(x);
        buffNote(x, 'interval', x.interval, `행동 간격 영구 ${amount}% → ${x.interval / TPS}s ${tag}`);
        break;
      case 'hp': {
        // 유닛 체력은 합산 HP에 들어가므로 팀 최대 체력과 현재 체력을 함께 올린다
        const team = teams[x.side];
        x.hp = Math.max(1, clampN(x.hp + amount));
        team.maxHp = clampN(team.maxHp + amount);
        team.hp = clampN(team.hp + amount);
        emit({ type: 'buff', side: x.side, src: x.uid, srcName: x.name, target: `team${x.side}`, stat: 'maxHp', amount, after: team.maxHp, note: `${x.name} 체력 영구 +${amount} ${tag}` });
        break;
      }
    }
  };

  const applyEffect = (e: Effect, ctx: Ctx) => {
    const L = ctx.level;
    const u = ctx.unit;
    switch (e.type) {
      case 'damage': {
        let amount = baseAmount(e, ctx);
        if (u) amount += teams[ctx.side].status.fury * BALANCE.statuses.fury.perStack;
        if (amount > 0) dealDamage((1 - ctx.side) as Side, amount, ctx, false);
        break;
      }
      case 'heal': {
        let amount = baseAmount(e, ctx);
        if (u) amount = mulDiv(amount, u.healShieldPct, 100);
        healTeam(ctx.side, amount, ctx);
        break;
      }
      case 'shield': {
        let amount = baseAmount(e, ctx);
        if (u) {
          amount += mulDiv(u.hp, lv(e.hpPct, L), 100);
          amount = mulDiv(amount, u.healShieldPct, 100);
        }
        if (amount <= 0) break;
        const team = teams[ctx.side];
        team.shield = clampN(team.shield + amount);
        credit(ctx, 'shield', amount);
        emit({ type: 'shield', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${ctx.side}`, amount, after: team.shield });
        break;
      }
      case 'status': {
        // 중첩 = 주문력 x% (반올림) + 고정값
        const n = (u ? mulDivRound(u.power, lv(e.powerPct, L), 100) : 0) + lv(e.flat, L);
        if (n <= 0) break;
        const target = (e.to === 'ally' ? ctx.side : 1 - ctx.side) as Side;
        const team = teams[target];
        team.status[e.status] = clampN(team.status[e.status] + n);
        emit({
          type: 'status', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: `team${target}`,
          amount: n, after: team.status[e.status], note: BALANCE.statuses[e.status].name,
        });
        break;
      }
      case 'atkFlat':
        for (const x of resolve(e.target, ctx)) {
          const before = x.atk;
          x.atk = Math.max(0, clampN(x.atk + lv(e.amount, L)));
          buffNote(x, 'atk', x.atk, `공격력 ${before}→${x.atk} (${ctx.srcName})`);
        }
        break;
      case 'atkPct':
        for (const x of resolve(e.target, ctx)) {
          const before = x.atk;
          x.atk = Math.max(0, mulDiv(x.atk, 100 + lv(e.pct, L), 100));
          buffNote(x, 'atk', x.atk, `공격력 ${before}→${x.atk} (${ctx.srcName})`);
        }
        break;
      case 'powerFlat':
        for (const x of resolve(e.target, ctx)) {
          const before = x.power;
          x.power = Math.max(0, clampN(x.power + lv(e.amount, L)));
          buffNote(x, 'power', x.power, `주문력 ${before}→${x.power} (${ctx.srcName})`);
        }
        break;
      case 'powerPct':
        for (const x of resolve(e.target, ctx)) {
          const before = x.power;
          x.power = Math.max(0, mulDiv(x.power, 100 + lv(e.pct, L), 100));
          buffNote(x, 'power', x.power, `주문력 ${before}→${x.power} (${ctx.srcName})`);
        }
        break;
      case 'intervalPct':
        for (const x of resolve(e.target, ctx)) {
          const before = x.interval;
          x.intervalMul = Math.max(1, mulDiv(x.intervalMul, 1000 + lv(e.pct, L) * 10, 1000));
          recalcInterval(x);
          buffNote(x, 'interval', x.interval, `행동 간격 ${before / TPS}s→${x.interval / TPS}s (${ctx.srcName})`);
        }
        break;
      case 'extra':
        for (const x of resolve(e.target, ctx)) {
          x.extra = clampN(x.extra + lv(e.amount, L));
          buffNote(x, 'extra', x.extra, `추가발동 ${x.extra} (${ctx.srcName})`);
        }
        break;
      case 'stun':
        for (const x of resolve(e.target, ctx)) {
          x.stunUntil = Math.max(x.stunUntil, st.t + lv(e.ticks, L));
          emit({ type: 'stun', side: ctx.side, src: ctx.src, srcName: ctx.srcName, target: x.uid, amount: lv(e.ticks, L), note: x.name });
        }
        break;
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
      case 'trinket': {
        const g = gains[ctx.side];
        const grade = Math.max(1, Math.min(6, lv(e.grade, L)));
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

  const unitCtx = (u: BUnit): Ctx => ({ side: u.side, unit: u, level: u.level, src: u.uid, srcName: u.name });
  const trinketCtx = (side: Side, id: string): Ctx => ({ side, unit: null, level: 1, src: `trinket:${side}:${id}`, srcName: TRINKET_MAP[id].name });

  const act = (u: BUnit) => {
    const times = 1 + Math.min(Math.max(0, u.extra), BALANCE.engine.maxExtraActs);
    const ctx = unitCtx(u);
    for (let k = 0; k < times; k++) {
      u.acts++;
      emit({ type: 'act', side: u.side, src: u.uid, srcName: u.name, note: k > 0 ? `추가발동 ${k}` : undefined });
      for (const trig of u.triggers) {
        if (trig.on !== 'act') continue;
        runEffects(trig.effects, ctx);
        if (st.ended !== null) return;
      }
    }
    u.wait = u.interval;
  };

  // ── (0) 전투 시작 처리 ──
  emit({ type: 'start', side: -1, src: 'system', srcName: '전투 시작', note: input.env });
  const startQ: (QItem & { sys: number })[] = [];
  const timers: (QItem & { at: number })[] = [];
  for (const team of teams) {
    for (const id of team.trinkets) {
      for (const trig of TRINKET_MAP[id].triggers) {
        const run = () => runEffects(trig.effects, trinketCtx(team.side, id));
        if (trig.on === 'battleStart') startQ.push({ sys: 0, side: team.side, slot: 0, seq: st.seq++, run });
        if (trig.on === 'timer') timers.push({ at: (trig.atSec ?? 0) * TPS, side: team.side, slot: 0, seq: st.seq++, run });
      }
    }
  }
  for (const team of teams) {
    for (const u of team.units) {
      for (const trig of u.triggers) {
        const run = () => runEffects(trig.effects, unitCtx(u));
        if (trig.on === 'battleStart') startQ.push({ sys: 1, side: team.side, slot: u.slot, seq: st.seq++, run });
        // 전투 시작 후 N초 1회 효과는 행동이 아니라 시스템 이벤트로 처리한다.
        if (trig.on === 'timer') timers.push({ at: (trig.atSec ?? 0) * TPS, side: team.side, slot: u.slot, seq: st.seq++, run });
      }
    }
  }
  startQ.sort((a, b) => a.sys - b.sys || byQueueKey(a, b));
  for (const q of startQ) {
    q.run();
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
      const r0 = mulDiv(Math.max(0, teams[0].hp), 1000, teams[0].maxHp);
      const r1 = mulDiv(Math.max(0, teams[1].hp), 1000, teams[1].maxHp);
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
              emit({ type: 'statusTick', side: source, src: ctx.src, srcName: cfg.name, target: `team${team.side}`, amount: stacks });
              if (cfg.harmful) dealDamage(team.side, amount, ctx, cfg.bypassShield);
              else healTeam(team.side, amount, ctx);
              if (cfg.decay === 'minus1') team.status[sid] = Math.max(0, stacks - 1);
              if (cfg.decay === 'half') team.status[sid] = Math.floor(stacks / 2);
            },
          });
        }
      }
    }
    for (const tm of timers) if (tm.at === t) sys.push(tm);
    sys.sort(byQueueKey);
    for (const q of sys) {
      q.run();
      if (st.ended !== null) break;
    }
    if (st.ended !== null) break;

    // (2) 유닛 행동. 처리 중 새로 등록되는 항목은 큐 끝(등록 순번)에 붙고 되돌아가지 않는다.
    const queue: QItem[] = allUnits
      .filter((u) => u.wait === 0)
      .map((u) => ({ side: u.side, slot: u.slot, seq: st.seq++, run: () => act(u) }))
      .sort(byQueueKey);
    for (let i = 0; i < queue.length; i++) {
      queue[i].run();
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
    startAtk: u.startAtk, endAtk: u.atk, startPower: u.startPower, endPower: u.power, interval: u.interval, extra: u.extra,
    acts: u.acts, damage: u.damage, heal: u.heal, shield: u.shield,
  }));

  return {
    winner,
    endTick: st.t,
    reason,
    suddenDeath: st.suddenDeath,
    maxHp: [teams[0].maxHp, teams[1].maxHp],
    finalHp: [teams[0].hp, teams[1].hp],
    units,
    sourceTotals: [...totals.values()],
    timeline,
    events,
    gains,
  };
}
