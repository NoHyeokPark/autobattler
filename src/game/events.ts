// 이벤트 노드(?)와 모닥불의 보상 단계 처리.
//  - 이벤트: 등장 일차 구간에 맞는 이벤트 중 비율대로 하나를 뽑아 상황 글과 선택지를 보여 주고(보상 단계 kind 'event'),
//    고른 선택지의 결과를 순서대로 처리한다. "등급에서 N개 중 고르기" 결과는 이어지는 보상 단계(장신구·몬스터)가 된다.
//  - 모닥불: 휴식(라이프 +) 또는 단련(리더 능력치 하나 영구 +) 중 하나 (슬레이 더 스파이어의 휴식·단련).

import { BALANCE } from '../config/balance.ts';
import type { Rng } from '../core/rng.ts';
import { EVENTS } from '../data/events.ts';
import { EVENT_GROWTH } from '../data/leaders.ts';
import { MONSTER_MAP, MONSTERS } from '../data/monsters.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import { GRADE_NAMES, LEADER_STAT_NAMES, LEADER_STATS, ORIGIN_GRADE } from '../data/types.ts';
import type { EventChoice, EventDef, EventOutcome, GrowthDef, LeaderStat } from '../data/types.ts';
import { hasShopTrinkets, oddsRow, rollGradeAmong, rollTrinketChoices } from './shop.ts';
import type { OwnedUnit, RewardStage, RunState } from './state.ts';
import { livesLeft, noteOrigin, shopLevel } from './state.ts';

const shopMonsters = (g: number) => MONSTERS.filter((m) => m.grade === g && m.shop !== false);

// 이 런에서 얻을 수 있는 리더 이벤트 성장 (id를 정하면 그것만). 반복 불가는 이미 가졌으면 제외
export function eventGrowthPool(s: RunState, id?: string): GrowthDef[] {
  return EVENT_GROWTH.filter((g) => (!id || g.id === id) && (g.repeatable || !s.growth.includes(g.id)));
}

const lifeChange = (c: EventChoice) => c.outcomes.reduce((a, o) => a + (o.type === 'life' ? o.amount : 0), 0);

// 지금 이 선택지를 고를 수 없는 이유 (고를 수 있으면 null)
export function choiceBlock(s: RunState, c: EventChoice): string | null {
  if ((c.cost ?? 0) > s.gold) return `골드 ${c.cost} 필요`;
  const life = lifeChange(c);
  if (life < 0 && !s.extension.active && livesLeft(s) + life <= 0) return '라이프가 모자랍니다';
  if (c.outcomes.some((o) => o.type === 'growth' && !eventGrowthPool(s, o.id).length)) return '더 얻을 성장이 없습니다';
  return null;
}

// 오늘 나올 수 있는 이벤트: 일차 구간에 맞고, 성장 결과가 막히지 않았고, 고를 수 있는 선택지가 하나 이상
export function eventCandidates(s: RunState): EventDef[] {
  return EVENTS.filter((e) =>
    (e.minDay ?? 1) <= s.day && s.day <= (e.maxDay ?? Infinity) && (e.weight ?? 1) > 0 && e.choices.length > 0 &&
    !e.choices.some((c) => c.outcomes.some((o) => o.type === 'growth' && !eventGrowthPool(s, o.id).length)) &&
    e.choices.some((c) => !choiceBlock(s, c)));
}

export function pickEventStage(s: RunState, rng: Rng): RewardStage | null {
  const list = eventCandidates(s);
  if (!list.length) return null;
  const ev = list[rng.weighted(list.map((e) => Math.max(0, e.weight ?? 1)))];
  return { label: ev.name, kind: 'event', options: [], gold: 0, event: structuredClone(ev) };
}

// 리더 능력치 영구 + (리더 유닛의 영구 강화에 더한다)
export function trainLeader(s: RunState, stat: LeaderStat, amount: number): string {
  const leader = [...s.board, ...s.bench].find((u): u is OwnedUnit => !!u?.leader);
  if (leader) leader.bonus = { ...leader.bonus, [stat]: (leader.bonus?.[stat] ?? 0) + amount };
  return `리더 ${LEADER_STAT_NAMES[stat]} ${amount >= 0 ? '+' : ''}${amount}`;
}

export function giveTrinket(s: RunState, id: string): string {
  s.trinkets.push(id);
  if (TRINKET_MAP[id].grade === ORIGIN_GRADE) noteOrigin(s, id, true);
  return `장신구 ${TRINKET_MAP[id].name}`;
}

export function giveMonster(s: RunState, id: string): string {
  s.pendingGifts = [...(s.pendingGifts ?? []), id];
  return `${MONSTER_MAP[id].name}(${GRADE_NAMES[MONSTER_MAP[id].grade]}) 다음 날 합류`;
}

// 결과 등급: 정했으면 그 등급, 아니면 일차 상점 확률표 (기원 제외, 뽑을 것이 있는 등급만)
function outcomeGrade(s: RunState, rng: Rng, o: { grade?: number }, has: (g: number) => boolean): number {
  if (o.grade) return o.grade;
  return rollGradeAmong(rng, oddsRow(s.day, shopLevel(s)), (g) => g !== ORIGIN_GRADE && has(g));
}

// 결과 하나 처리. 바로 얻은 것은 글로, "N개 중 고르기"는 보상 단계로 돌려준다
function applyOutcome(s: RunState, rng: Rng, o: EventOutcome, label: string): { line?: string; stage?: RewardStage } {
  switch (o.type) {
    case 'trinket': {
      if (o.id) return TRINKET_MAP[o.id] ? { line: giveTrinket(s, o.id) } : {};
      const g = outcomeGrade(s, rng, o, hasShopTrinkets);
      const n = Math.max(1, o.choices ?? 1);
      const ids = rollTrinketChoices(rng, g, n, g === ORIGIN_GRADE);
      if (!ids.length) return {};
      if (n === 1) return { line: giveTrinket(s, ids[0]) };
      return { stage: { label: `${label}: 장신구 고르기 (${GRADE_NAMES[TRINKET_MAP[ids[0]].grade]})`, options: ids, gold: BALANCE.economy.skipRewardGold } };
    }
    case 'monster': {
      if (o.id) return MONSTER_MAP[o.id] ? { line: giveMonster(s, o.id) } : {};
      const g = outcomeGrade(s, rng, o, (x) => shopMonsters(x).length > 0);
      const pool = shopMonsters(g).map((m) => m.id);
      if (!pool.length) return {};
      rng.shuffle(pool);
      const n = Math.max(1, o.choices ?? 1);
      if (n === 1) return { line: giveMonster(s, pool[0]) };
      // 고르지 않으면 그 등급 몬스터 값 (벤치가 가득 차서 못 받을 때와 같은 골드)
      return { stage: { label: `${label}: 몬스터 고르기 (${GRADE_NAMES[g]})`, kind: 'monster', options: pool.slice(0, n), gold: BALANCE.economy.monsterCost[g - 1] ?? 0 } };
    }
    case 'growth': {
      const pool = eventGrowthPool(s, o.id);
      if (!pool.length) return {};
      const g = rng.pick(pool);
      s.growth.push(g.id);
      const say = g.lines?.promote?.trim() || g.quote?.trim();
      return { line: `리더가 "${g.name}"을(를) 얻음${say ? ` “${say}”` : ''}` };
    }
    case 'gold': {
      const amount = o.amount + (o.perDay ?? 0) * s.day;
      const before = s.gold;
      s.gold = Math.max(0, s.gold + amount);
      return { line: `골드 ${s.gold >= before ? '+' : ''}${s.gold - before}` };
    }
    case 'life':
      s.extraLives = (s.extraLives ?? 0) + o.amount;
      return { line: `라이프 ${o.amount >= 0 ? '+' : ''}${o.amount}` };
    case 'leaderStat':
      return { line: trainLeader(s, o.stat, o.amount) };
  }
}

// 이벤트 선택지 처리: 비용을 내고 결과를 순서대로. 이어지는 보상 단계(고르기)와 결과 글을 돌려준다
export function applyEventChoice(s: RunState, ev: EventDef, index: number, rng: Rng): { ok: false; msg: string } | { ok: true; msg: string; stages: RewardStage[] } {
  const c = ev.choices[index];
  if (!c) return { ok: false, msg: '없는 선택지입니다.' };
  const block = choiceBlock(s, c);
  if (block) return { ok: false, msg: `고를 수 없습니다: ${block}` };
  const lines: string[] = [];
  if (c.cost) {
    s.gold -= c.cost;
    lines.push(`골드 -${c.cost}`);
  }
  const stages: RewardStage[] = [];
  for (const o of c.outcomes) {
    const r = applyOutcome(s, rng, o, ev.name);
    if (r.line) lines.push(r.line);
    if (r.stage) stages.push(r.stage);
  }
  const head = c.result?.trim() || c.text;
  return { ok: true, msg: `이벤트 ${ev.name}: ${head}${lines.length ? ` (${lines.join(', ')})` : ''}`, stages };
}

// ── 모닥불 ──
export const CAMPFIRE_OPTIONS = ['rest', ...LEADER_STATS] as const;
export function campfireStage(): RewardStage {
  return { label: '모닥불', kind: 'campfire', options: [...CAMPFIRE_OPTIONS], gold: 0 };
}
export function campfireOptionText(opt: string): string {
  if (opt === 'rest') return `휴식: 라이프 +${BALANCE.campfire.restLives}`;
  const stat = opt as LeaderStat;
  return `단련: 리더 ${LEADER_STAT_NAMES[stat]} +${BALANCE.campfire.train[stat]}`;
}
export function applyCampfire(s: RunState, opt: string): string | null {
  if (opt === 'rest') {
    s.extraLives = (s.extraLives ?? 0) + BALANCE.campfire.restLives;
    return `모닥불에서 쉬었습니다: 라이프 +${BALANCE.campfire.restLives}`;
  }
  if (!(LEADER_STATS as string[]).includes(opt)) return null;
  return `모닥불에서 단련했습니다: ${trainLeader(s, opt as LeaderStat, BALANCE.campfire.train[opt as LeaderStat])}`;
}

// 결과 한 줄 설명 (에디터·화면·에이전트용)
export function describeOutcome(o: EventOutcome): string {
  const pickN = (n?: number) => ((n ?? 1) > 1 ? ` ${n}개 중 하나 고르기` : '');
  const gradeText = (g?: number) => (g ? `${GRADE_NAMES[g]} 등급` : '일차 확률표 등급');
  switch (o.type) {
    case 'trinket': return o.id ? `장신구 ${TRINKET_MAP[o.id]?.name ?? o.id}` : `${gradeText(o.grade)} 장신구${pickN(o.choices)}`;
    case 'monster': return o.id ? `몬스터 ${MONSTER_MAP[o.id]?.name ?? o.id} (다음 날 합류)` : `${gradeText(o.grade)} 몬스터${pickN(o.choices)} (다음 날 합류)`;
    case 'growth': return o.id ? `리더 성장 "${EVENT_GROWTH.find((g) => g.id === o.id)?.name ?? o.id}"` : '리더 이벤트 성장 무작위';
    case 'gold': {
      const sign = (n: number) => (n >= 0 ? '+' : '');
      return `골드 ${sign(o.amount)}${o.amount}${o.perDay ? ` ${sign(o.perDay)}일차×${o.perDay}` : ''}`;
    }
    case 'life': return `라이프 ${o.amount >= 0 ? '+' : ''}${o.amount}`;
    case 'leaderStat': return `리더 ${LEADER_STAT_NAMES[o.stat]} ${o.amount >= 0 ? '+' : ''}${o.amount}`;
  }
}
export function describeChoice(c: EventChoice): string {
  const parts = [...(c.cost ? [`골드 ${c.cost} 지불`] : []), ...c.outcomes.map(describeOutcome)];
  return parts.join(', ') || '아무 일도 없음';
}
