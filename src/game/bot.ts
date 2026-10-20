// 봇 플레이어: 시드 봇 팀 생성과 시뮬레이터의 골드·빌드 전략 비교에 쓴다.
//  expand   (몬스터 확장형): 골드를 몬스터 구매·리롤에 모두 쓴다.
//  trinket  (장신구형): 장신구를 우선 산다.
//  interest (이자형): 이자를 위해 골드를 남기고 남는 만큼만 쓴다.
//  growth   (성장형): 영구 강화 유닛·성장을 우선하고, 스택이 쌓인 유닛을 끝까지 쓴다.
//  economy  (경제형): 초반에 골드·장신구를 주는 유닛을 모으고, 늘어난 골드로 리롤을 더 한다.

import { BALANCE } from '../config/balance.ts';
import { Rng } from '../core/rng.ts';
import { findUnitGrowth } from '../data/growth.ts';
import { findGrowth, isPromotion, LEADER_MAP, LEADERS } from '../data/leaders.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import type { Effect, GrowthDef, Trigger, UnitDef } from '../data/types.ts';
import type { TeamSnapshot } from '../battle/types.ts';
import { beginDay, buildRewards, chooseGrowth } from './run.ts';
import { buy, chooseForm, choosePromotion, chooseUnitGrowth, itemCost, reroll, sell, sellPrice } from './shop.ts';
import { choiceBlock } from './events.ts';
import type { OwnedUnit, RewardStage, RunState } from './state.ts';
import { baseDeployLimit, createRun, livesLeft, toSnapshot, unitDeploy } from './state.ts';
import { boardTagCounts, pathTags } from './view.ts';

export type Strategy = 'expand' | 'trinket' | 'interest' | 'growth' | 'economy';
export const STRATEGIES: Strategy[] = ['expand', 'trinket', 'interest', 'growth', 'economy'];
// 시드 봇은 전투 없이 상점만 돌려서 만들기 때문에 스택·골드가 쌓이지 않는 성장형·경제형은 쓰지 않는다
export const SEED_STRATEGIES: Strategy[] = ['expand', 'trinket', 'interest'];
export const STRATEGY_NAMES: Record<Strategy, string> = {
  expand: '몬스터 확장형', trinket: '장신구형', interest: '이자형', growth: '성장형', economy: '경제형',
};

const GROWTH_EFFECTS: Effect['type'][] = ['permanent'];
const ECONOMY_EFFECTS: Effect['type'][] = ['gold', 'trinket'];

// 주력(스택·경제) 유닛을 몇 개까지 일부러 모을지 (사람처럼 일부만 섞는다).
// 참고: 상한 없음 / 3·2 / 2·1로 바꿔 봐도 성적 차이는 거의 없었다 → 약세는 봇보다 수치·규칙 쪽 원인.
const FAVORED_CAP: Partial<Record<Strategy, number>> = { growth: 2, economy: 1 };

function triggersUse(triggers: Trigger[] | undefined, types: Effect['type'][]): boolean {
  return (triggers ?? []).some((t) => t.effects.some((e) => types.includes(e.type)));
}
const growthUses = (g: GrowthDef | undefined, types: Effect['type'][]) => !!g && triggersUse(g.triggers, types);

// 이 전략이 특히 원하는 유닛인가
function favored(defId: string, strategy: Strategy): boolean {
  const def = MONSTER_MAP[defId];
  if (!def) return false;
  if (strategy === 'growth') return triggersUse(def.triggers, GROWTH_EFFECTS);
  if (strategy === 'economy') return triggersUse(def.triggers, ECONOMY_EFFECTS);
  return false;
}

function unitDef(u: OwnedUnit): UnitDef {
  return u.leader ? LEADER_MAP[u.defId] : MONSTER_MAP[u.defId];
}

function ownedUnits(s: RunState): OwnedUnit[] {
  return [...s.board, ...s.bench].filter((u): u is OwnedUnit => u !== null);
}

function favoredCount(s: RunState, strategy: Strategy): number {
  return ownedUnits(s).filter((u) => favored(u.defId, strategy)).length;
}

// 배치·판매 판단용 가치. 쌓인 영구 강화도 가치로 친다 (스택을 버리지 않게)
function unitValue(u: OwnedUnit, strategy?: Strategy): number {
  if (u.leader) return Number.MAX_SAFE_INTEGER;
  const b = u.bonus ?? {};
  const stacked = (b.atk ?? 0) * 4 + Math.floor((b.hp ?? 0) / 3) + (b.power ?? 0) * 2 + (b.haste ?? 0) + (b.extra ?? 0) * 20;
  const fav = strategy && favored(u.defId, strategy) ? 25 : 0;
  return MONSTER_MAP[u.defId].grade * 10 * BALANCE.unit.mergeCount ** (u.level - 1) + stacked + fav;
}

// 벼랑 끝: 남은 목숨이 ALL_IN_LIVES 이하면 모아 둔 골드를 모두 써서 전력을 끌어올린다 (사람의 "올인 타이밍").
// 시뮬레이션: 이 규칙이 없을 때 이자형은 4패 상태에서도 평균 73골드를 들고 14%만 쓰고 탈락했다.
export const ALL_IN_LIVES = 2;
function allIn(s: RunState): boolean {
  return livesLeft(s) <= ALL_IN_LIVES;
}

function reserveGold(s: RunState, strategy: Strategy): number {
  if (strategy !== 'interest' || allIn(s)) return 0;
  return Math.min(BALANCE.economy.interestMax * BALANCE.economy.interestPer, Math.floor(s.day / 2) * 10);
}

export function botShop(s: RunState, strategy: Strategy, rng: Rng) {
  botUnitGrowth(s, rng, strategy); // 하루 시작에 진화의 돌 등으로 생긴 선택부터 처리
  const reserve = reserveGold(s, strategy);
  // 올인일 때는 합성을 찾아 리롤을 계속한다 (골드가 바닥날 때까지)
  const maxRerolls = allIn(s) ? 99 : strategy === 'economy' ? 6 : 3;
  // 올인일 때 경제형은 경제 유닛보다 전투력을 우선한다
  const buildStrategy: Strategy = allIn(s) && strategy === 'economy' ? 'expand' : strategy;
  let rerolls = 0;
  for (let guard = 0; guard < 300; guard++) {
    const owned = ownedUnits(s);
    const benchFree = s.bench.some((x) => x === null);
    const benchFreeCount = s.bench.filter((x) => x === null).length;
    let best = -1;
    let bestScore = 0;
    s.shop.forEach((item, i) => {
      if (!item || s.gold - itemCost(item) < reserve) return;
      let score: number;
      if (item.kind === 'trinket') {
        const t = TRINKET_MAP[item.defId];
        const econTrinket = strategy === 'economy' && (t.passive?.incomeBonus || triggersUse(t.triggers, ECONOMY_EFFECTS));
        score = strategy === 'trinket' ? 100 + t.grade * 10 : econTrinket ? 60 : s.gold >= 20 ? 5 + t.grade : 0;
      } else {
        const copies = owned.filter((u) => u.defId === item.defId && u.level === 1).length;
        if (!benchFree && copies < BALANCE.unit.mergeCount - 1) return;
        // 올인 리롤 중에는 벤치를 잡동사니로 채우지 않는다: 자리가 적으면 합성 재료나 3등급 이상만
        if (allIn(s) && benchFreeCount <= 2 && copies === 0 && MONSTER_MAP[item.defId].grade < 3) return;
        score = MONSTER_MAP[item.defId].grade * 10 + copies * 30 + rng.int(5);
        // 성장형은 끝까지, 경제형은 초반(8일차까지)에 주력 유닛을 선호. 이미 가진 주력 유닛의 합성 재료는 상한과 무관
        if (favored(item.defId, buildStrategy)) {
          const room = favoredCount(s, buildStrategy) < (FAVORED_CAP[buildStrategy] ?? 0) || copies > 0;
          if (room) score += buildStrategy === 'growth' || s.day <= 8 ? 45 : 10;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) {
      buy(s, best);
      botUnitGrowth(s, rng, strategy);
      continue;
    }
    // 벤치가 꽉 찼으면 가장 약한 벤치 유닛을 판다 (스택이 쌓인 유닛은 팔지 않는다)
    if (!benchFree) {
      const weakest = s.bench
        .map((u, i) => ({ u, i }))
        .filter((x): x is { u: OwnedUnit; i: number } => x.u !== null)
        .sort((a, b) => unitValue(a.u, buildStrategy) - unitValue(b.u, buildStrategy))[0];
      if (weakest && sellPrice(weakest.u) <= 2 && !weakest.u.bonus) {
        sell(s, { area: 'bench', index: weakest.i });
        continue;
      }
    }
    if ((strategy !== 'interest' || allIn(s)) && rerolls < maxRerolls && s.gold - BALANCE.economy.rerollCost >= reserve + 1) {
      reroll(s);
      rerolls++;
      continue;
    }
    break;
  }
  arrangeBoard(s, buildStrategy);
}

function hasEffect(def: UnitDef, types: string[]): boolean {
  return def.triggers.some((t) => t.on === 'act' && t.effects.some((e) => types.includes(e.type)));
}

// 주변 아군에게 효과를 주는 유닛 (가운데 쪽이 유리)
function usesAdjacency(def: UnitDef): boolean {
  return def.triggers.some((t) => t.effects.some((e) =>
    'target' in e && e.target.side === 'ally' && e.target.area === 'near' && (e.target.dirs ?? []).some((d) => d !== 'c')));
}

// 합성 레벨업 성장: 성장형·경제형은 맞는 성장을 우선, 나머지는 무작위
export function botUnitGrowth(s: RunState, rng: Rng, strategy?: Strategy) {
  while (s.phase === 'unitGrowth' && s.unitGrowth.length > 0) {
    const p = s.unitGrowth[0];
    const u = ownedUnits(s).find((x) => x.uid === p.uid);
    const types = strategy === 'growth' ? GROWTH_EFFECTS : strategy === 'economy' ? ECONOMY_EFFECTS : null;
    const fav = types && u ? p.choices.findIndex((id) => growthUses(findUnitGrowth(u.defId, id), types)) : -1;
    chooseUnitGrowth(s, fav >= 0 ? fav : rng.int(p.choices.length));
  }
  // Lv3 진화 외형은 능력과 무관하므로 무작위
  while (s.phase === 'unitGrowth' && (s.formChoices?.length ?? 0) > 0) chooseForm(s, rng.int(s.formChoices![0].options.length));
  // 몬스터 전직: 무작위
  while (s.phase === 'unitGrowth' && (s.unitPromotions?.length ?? 0) > 0) choosePromotion(s, rng.int(s.unitPromotions![0].choices.length));
}

// 칸 효과를 대략 고려한 배치 선호 점수 (봇 휴리스틱)
function slotScore(def: UnitDef, slot: number): number {
  const row = Math.floor((slot - 1) / 3);
  const col = (slot - 1) % 3;
  const acts = def.triggers.some((t) => t.on === 'act' && t.effects.length > 0);
  if (!acts) return col === 0 ? 3 : 0; // 행동하지 않는 유닛은 1열 기절이 손해가 아니다
  let sc = 0;
  const slow = def.intervalTicks >= 50;
  if (slow) sc += (col === 2 ? 4 : col === 0 ? -2 : 0) + (row === 2 ? 2 : 0);
  if (hasEffect(def, ['heal', 'shield']) && row === 1) sc += 2;
  if (usesAdjacency(def)) sc += (row === 1 ? 1 : 0) + (col === 1 ? 1 : 0);
  if (!slow && hasEffect(def, ['damage'])) sc += row === 0 || row === 2 ? 1 : 0;
  return sc;
}

const SLOT_TIEBREAK = [5, 2, 4, 6, 8, 1, 3, 7, 9];

export function arrangeBoard(s: RunState, strategy?: Strategy) {
  const units = ownedUnits(s).sort((a, b) => unitValue(b, strategy) - unitValue(a, strategy));
  // 가치 순으로 올리되, 통솔력 유닛(지휘자 등)은 올리면 그만큼 제한이 늘어난다
  const deploy: OwnedUnit[] = [];
  const rest: OwnedUnit[] = [];
  let limit = baseDeployLimit(s);
  for (const u of units) {
    const room = Math.min(BALANCE.board.maxDeploy, limit + unitDeploy(u));
    if (deploy.length < room) {
      deploy.push(u);
      limit += unitDeploy(u);
    } else rest.push(u);
  }
  s.board = Array(9).fill(null);
  for (const u of deploy) {
    const def = unitDef(u);
    let bestSlot = -1;
    let bestScore = -Infinity;
    for (const slot of SLOT_TIEBREAK) {
      if (s.board[slot - 1]) continue;
      const sc = slotScore(def, slot);
      if (sc > bestScore) {
        bestScore = sc;
        bestSlot = slot;
      }
    }
    s.board[bestSlot - 1] = u;
  }
  s.bench = Array(BALANCE.board.benchSize).fill(null);
  rest.slice(0, BALANCE.board.benchSize).forEach((u, i) => (s.bench[i] = u));
}

// 리더 성장: 변신 레벨에서는 보드에 가장 많이 모인 태그 쪽으로 (본질 강화 = 원래 태그). 성장형은 영구 강화 성장(예: 백전노장)을 우선, 나머지는 무작위
export function botGrowth(s: RunState, rng: Rng, strategy?: Strategy) {
  if (s.phase !== 'growth') return;
  const forms = s.growthChoices.map((id) => findGrowth(s.leaderId, id));
  if (forms.length > 0 && s.growthChoices.every((id) => isPromotion(s.leaderId, id))) {
    const counts = boardTagCounts(s.board);
    const score = forms.map((g) => pathTags(s.leaderId, g).reduce((n, t) => n + (counts.get(t) ?? 0), 0));
    const best = Math.max(...score);
    const top = score.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    chooseGrowth(s, top[rng.int(top.length)]);
    return;
  }
  const fav = strategy === 'growth' ? s.growthChoices.findIndex((id) => growthUses(findGrowth(s.leaderId, id), GROWTH_EFFECTS)) : -1;
  chooseGrowth(s, fav >= 0 ? fav : rng.int(s.growthChoices.length));
}

// 보상 선택: 장신구 index 또는 'gold'
export function botRewardChoice(options: string[], strategy: Strategy): number | 'gold' {
  if (options.length === 0) return 'gold';
  // 경제형은 수입·획득 장신구를 등급보다 우선
  if (strategy === 'economy') {
    const econ = options.findIndex((id) => TRINKET_MAP[id].passive?.incomeBonus || triggersUse(TRINKET_MAP[id].triggers, ECONOMY_EFFECTS));
    if (econ >= 0) return econ;
  }
  let best = 0;
  options.forEach((id, i) => {
    if (TRINKET_MAP[id].grade > TRINKET_MAP[options[best]].grade) best = i;
  });
  const g = TRINKET_MAP[options[best]].grade;
  const minGrade = strategy === 'trinket' ? 1 : strategy === 'interest' ? 4 : 3;
  return g >= minGrade ? best : 'gold';
}

// 이벤트·모닥불 선택: 이벤트는 고를 수 있는 첫 선택지, 모닥불은 라이프가 2 이하면 휴식, 아니면 체력 단련
export function botStageChoice(s: RunState, st: RewardStage): number {
  if (st.kind === 'campfire') return st.options.indexOf(livesLeft(s) <= 2 ? 'rest' : 'hp');
  return Math.max(0, (st.event?.choices ?? []).findIndex((c) => !choiceBlock(s, c)));
}

// 이벤트 떠돌이 몬스터 선택: 이미 가진 몬스터(합성 재료)를 먼저, 없으면 첫 번째
export function botMonsterChoice(s: RunState, options: string[]): number | 'gold' {
  if (options.length === 0) return 'gold';
  const have = new Set([...s.board, ...s.bench].filter((u): u is OwnedUnit => !!u).map((u) => u.defId));
  return Math.max(0, options.findIndex((id) => have.has(id)));
}

export function botNode(s: RunState, rng: Rng): number {
  // 모닥불은 패배가 쌓였을수록, 이벤트는 고르게
  const weights = s.nodes.map((n) => (n.kind === 'normal' ? 40 : n.kind === 'env' ? 35 : n.kind === 'final' ? 50 : n.kind === 'campfire' ? (s.losses >= 2 ? 60 : 20) : n.kind === 'event' ? 30 : 25));
  return rng.weighted(weights);
}

// 기록이 없을 때 쓰는 시드 봇 팀. 전투 없이 상점 단계만 day일까지 진행한다.
export function buildBotTeam(day: number, seed: number, opts: { strategy?: Strategy; incomePenalty?: number; leaderId?: string } = {}): TeamSnapshot {
  const rng = new Rng(seed);
  const leaderId = opts.leaderId ?? rng.pick(LEADERS).id;
  const strategy = opts.strategy ?? rng.pick(SEED_STRATEGIES);
  const s = createRun(leaderId, seed, `bot-${seed}`);
  for (let d = 1; d <= day; d++) {
    beginDay(s, { incomePenalty: opts.incomePenalty });
    botGrowth(s, rng, strategy);
    botShop(s, strategy, rng);
    if (d < day) {
      const stage = buildRewards(s, { kind: 'normal', env: 'normal' }, rng.chancePct(50), rng)[0]; // 시드 봇은 전투 없이 일반 보상만
      const pick = botRewardChoice(stage.options, strategy);
      if (pick === 'gold') s.gold += stage.gold;
      else s.trinkets.push(stage.options[pick]);
    }
  }
  return toSnapshot(s, `시드 봇(${LEADER_MAP[leaderId].name}·${STRATEGY_NAMES[strategy]})`);
}
