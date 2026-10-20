// 한 판(런)의 진행: 하루 = 상점 단계 → 지도에서 노드 선택 → 준비 완료 → 매칭 → 전투 → 보상 (모닥불: 휴식·단련, 이벤트: 상황과 선택지).
// 이 파일은 상태 전이만 다룬다. 매칭과 전투 실행은 호출하는 쪽(UI, 시뮬레이터)이 맡는다.

import { BALANCE } from '../config/balance.ts';
import type { Rng } from '../core/rng.ts';
import { rerollPick } from '../data/growth.ts';
import { findGrowth, isPromotion, LEADER_MAP, leaderPath } from '../data/leaders.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import type { PermanentStat, StatMods } from '../data/types.ts';
import type { BattleGains, TeamSnapshot } from '../battle/types.ts';
import { GRADE_NAMES, inLevelRange, ORIGIN_GRADE } from '../data/types.ts';
import { statModsText } from '../data/describe.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { applyCampfire, applyEventChoice, campfireStage, giveMonster, giveTrinket, pickEventStage } from './events.ts';
import { generateMap, mapOptions } from './map.ts';
import { applyOneShotTrinkets, enterChoicePhase, giftMonster, hasShopTrinkets, oddsRow, rollGradeAmong, rollShop, rollTrinket, rollTrinketChoices, withRng } from './shop.ts';
import type { OpResult } from './shop.ts';
import type { NodeOption, RewardStage, RunEnd, RunState } from './state.ts';
import { baseDeployLimit, livesLeft, shopLevel, noteOrigin } from './state.ts';

const R = BALANCE.run;

// 내일 받을 수입 (지금 골드를 그대로 남기면). nextAt = 이자를 1 더 받으려면 더 남길 골드 (최대면 없음)
export function incomePreview(s: RunState): { base: number; interest: number; bonus: number; nextAt?: number } {
  const eco = BALANCE.economy;
  const interest = Math.min(eco.interestMax, Math.floor(Math.max(0, s.gold) / eco.interestPer));
  const bonus = s.trinkets.reduce((n, id) => n + (TRINKET_MAP[id]?.passive?.incomeBonus ?? 0), 0);
  return { base: eco.baseIncome, interest, bonus, nextAt: interest < eco.interestMax ? (interest + 1) * eco.interestPer - s.gold : undefined };
}

export function beginDay(s: RunState, opts: { incomePenalty?: number } = {}) {
  s.day++;
  const eco = BALANCE.economy;
  const interest = Math.min(eco.interestMax, Math.floor(s.gold / eco.interestPer));
  const bonus = s.trinkets.reduce((n, id) => n + (TRINKET_MAP[id]?.passive?.incomeBonus ?? 0), 0);
  const base = Math.max(0, eco.baseIncome - (opts.incomePenalty ?? 0));
  s.gold += base + interest + bonus;
  s.lastIncome = { base, interest, bonus, saved: s.gold - base - interest - bonus };
  // 마지막 날: 남은 라이프(마지막 전투에 쓸 1개 빼고)를 골드로
  if (s.day === R.maxDays && !s.extension.active) {
    const spare = livesLeft(s) - 1;
    if (spare > 0 && R.spareLifeGold > 0) {
      s.gold += spare * R.spareLifeGold;
      s.notices = [...(s.notices ?? []), `마지막 날: 남은 라이프 ${spare}개를 ${spare * R.spareLifeGold}골드로 바꿨습니다.`];
    }
  }
  withRng(s, (rng) => {
    if (!s.shopLocked || s.shop.length === 0) rollShop(s, rng);
    s.shopLocked = false; // 잠금은 다음 날 상점 하나만 지킨다 (도착하면 풀림, 필요하면 다시 건다)
    if (!s.map) s.map = generateMap(rng); // 첫날 (지도 이전 저장이면 지금)
    s.nodes = mapOptions(s);
    s.growthChoices = [];
    s.growthRerolls = 0;
    if (BALANCE.leader.levelUpDays.includes(s.day)) {
      s.leaderLevel++;
      s.growthChoices = rollGrowth(s, rng);
      // 전직은 모든 선택지가 이미 나와 있으므로 다시 뽑기가 없다
      s.growthRerolls = isPromotionChoice(s) ? 0 : BALANCE.leader.growthRerolls;
    }
  });
  s.nodeIndex = 0;
  s.phase = s.growthChoices.length > 0 ? 'growth' : 'shop';
  // 이벤트로 받은 몬스터는 상점이 열릴 때 벤치로
  const gifts = [...(s.pendingGift ? [s.pendingGift] : []), ...(s.pendingGifts ?? [])];
  delete s.pendingGift;
  delete s.pendingGifts;
  for (const id of gifts) {
    const msg = giftMonster(s, id);
    if (msg) s.notices = [...(s.notices ?? []), msg];
  }
  // 보상 등 상점 밖에서 얻은 진화의 돌·황금 지휘봉은 상점 단계가 시작될 때 발동한다 (메시지는 화면 알림으로)
  const used = applyOneShotTrinkets(s);
  if (used.length) s.notices = [...(s.notices ?? []), ...used];
}

// 리더 성장 선택지.
// 전직 레벨(promotionLevels)이고 아직 전직하지 않았으면 전직 목록만 제시한다: 본질 강화가 맨 앞 고정 자리, 변신은 뒤에 무작위 순서.
// 그 외에는 일반 성장 목록에서 등장 레벨 구간(minLevel·maxLevel)에 맞는 것 중 무작위로 고른다.
function rollGrowth(s: RunState, rng: Rng): string[] {
  const leader = LEADER_MAP[s.leaderId];
  const promotions = leader.promotions ?? [];
  if (promotions.length > 0 && !leaderPath(s.leaderId, s.growth) && BALANCE.leader.promotionLevels.includes(s.leaderLevel)) {
    const mastery = promotions.find((g) => g.mastery && !g.transform);
    const forms = promotions.filter((g) => g !== mastery);
    rng.shuffle(forms);
    return [...(mastery ? [mastery] : []), ...forms].map((g) => g.id);
  }
  const pool = leaderGrowthPool(s);
  rng.shuffle(pool);
  return pool.slice(0, BALANCE.leader.growthChoices).map((g) => g.id);
}

// 지금 리더 레벨에서 나올 수 있는 일반 성장
function leaderGrowthPool(s: RunState) {
  return LEADER_MAP[s.leaderId].growth.filter((g) => {
    if (!inLevelRange(g, s.leaderLevel)) return false;
    // 통솔력(배치 인원 증가)은 9칸이 가득 차면 나오지 않는다. (지휘자처럼 보드 유닛이 주는 몫은 빼고 본다: 빼면 줄어드니까)
    if (g.deploy && baseDeployLimit(s) >= BALANCE.board.maxDeploy) return false;
    return g.repeatable || !s.growth.includes(g.id);
  });
}

const isPromotionChoice = (s: RunState) => s.growthChoices.length > 0 && s.growthChoices.every((id) => isPromotion(s.leaderId, id));

// 리더 성장 선택지 다시 뽑기 (증강 리롤처럼 레벨업마다 BALANCE.leader.growthRerolls회). 지금 보이는 것과 다른 성장을 우선으로 뽑는다
export function rerollGrowth(s: RunState): OpResult {
  if (s.phase !== 'growth') return { ok: false, msg: '성장을 고르는 중이 아닙니다.' };
  if (isPromotionChoice(s)) return { ok: false, msg: '전직은 모든 선택지가 나와 있어 다시 뽑을 수 없습니다.' };
  if ((s.growthRerolls ?? 0) <= 0) return { ok: false, msg: '다시 뽑기를 이미 썼습니다.' };
  const pool = leaderGrowthPool(s).map((g) => g.id);
  const next = withRng(s, (rng) => rerollPick(pool, s.growthChoices, BALANCE.leader.growthChoices, rng));
  if (!next) return { ok: false, msg: '다른 성장이 없어 다시 뽑을 수 없습니다.' };
  s.growthChoices = next;
  s.growthRerolls = (s.growthRerolls ?? 0) - 1;
  return { ok: true, msg: '성장 선택지를 다시 뽑았습니다.' };
}

export function chooseGrowth(s: RunState, idx: number): OpResult {
  const id = s.growthChoices[idx];
  if (s.phase !== 'growth' || !id) return { ok: false, msg: '고를 수 없는 선택지입니다.' };
  s.growth.push(id);
  s.growthChoices = [];
  s.growthRerolls = 0;
  s.phase = 'shop';
  const used = applyOneShotTrinkets(s);
  enterChoicePhase(s); // 하루 시작에 생긴 몬스터 성장 선택(이벤트 몬스터 합성 등)이 기다리고 있으면 이어서
  const g = findGrowth(s.leaderId, id);
  const say = g?.lines?.promote?.trim() || g?.quote?.trim();
  const got = (g?.transform ? `리더가 ${g.name}(으)로 변신했습니다!` : g?.mastery ? `리더가 ${g.name}의 길을 걷습니다!` : `${g?.name} 습득!`) + (say ? ` “${say}”` : '');
  return { ok: true, msg: [got, ...used].join(' ') };
}

export function selectNode(s: RunState, idx: number): OpResult {
  if (!s.nodes[idx]) return { ok: false, msg: '없는 노드입니다.' };
  s.nodeIndex = idx;
  return { ok: true, msg: '노드를 선택했습니다.' };
}

export function canReady(s: RunState): OpResult {
  if (s.phase !== 'shop') return { ok: false, msg: '상점 단계가 아닙니다.' };
  if (s.nodeIndex === null || !s.nodes[s.nodeIndex]) return { ok: false, msg: '노드를 먼저 선택하세요.' };
  return { ok: true, msg: '' };
}

function endRun(s: RunState, reason: RunEnd['reason'], score: number) {
  s.end = { reason, score };
  s.phase = 'ended';
  s.rewards = [];
}

function extensionScore(wins: number): number {
  const bonus = BALANCE.rank.extensionBonus;
  return BALANCE.rank.championScore + bonus[Math.min(wins, bonus.length - 1)];
}

export interface GainSummary {
  gold: number;
  trinkets: string[]; // 획득한 장신구 id
  permanent: { uid: number; defId: string; stat: PermanentStat; amount: number }[];
}

export function gainSummaryText(g: GainSummary): string {
  const parts: string[] = [];
  if (g.gold) parts.push(`골드 +${g.gold}`);
  if (g.trinkets.length) parts.push(`장신구 ${g.trinkets.map((id) => TRINKET_MAP[id]?.name ?? id).join(', ')}`);
  for (const p of g.permanent) {
    const name = MONSTER_MAP[p.defId]?.name ?? LEADER_MAP[p.defId]?.name ?? p.defId;
    parts.push(`${name} ${statModsText({ [p.stat]: p.amount })}`);
  }
  return parts.join(' · ');
}

// 런에 반영하기 전의 획득 요약 (테스트 전투 등). 장신구는 등급만 알 수 있다.
export function rawGainsText(g: BattleGains, team: TeamSnapshot): string {
  const parts: string[] = [];
  if (g.gold) parts.push(`골드 +${g.gold}`);
  if (g.trinkets.length) parts.push(`장신구 ${g.trinkets.map((grade) => `무작위 ${GRADE_NAMES[grade]}`).join(', ')}`);
  if (g.named?.length) parts.push(`장신구 ${g.named.map((id) => TRINKET_MAP[id]?.name ?? id).join(', ')}`);
  for (const p of g.permanent) {
    const e = team.board.find((x) => x.slot === p.slot);
    const name = e ? (e.kind === 'leader' ? LEADER_MAP[e.defId]?.name : MONSTER_MAP[e.defId]?.name) : `${p.slot}번 칸`;
    parts.push(`${name} ${statModsText({ [p.stat]: p.amount })}`);
  }
  return parts.join(' · ');
}

// 전투 밖으로 이어지는 획득을 런에 반영한다 (플레이어 쪽만, 승패와 무관).
//  - 골드: 바로 더한다 (다음 날 이자 계산에도 들어간다)
//  - 장신구: 지정 등급에서 런의 난수로 뽑는다 (중첩 가능)
//  - 영구 강화: 그 칸의 유닛 bonus에 더한다 (같은 유닛에 쌓이는 건 합산, 합성 때는 계열별 최고값)
export function applyGains(s: RunState, g: BattleGains): GainSummary {
  const out: GainSummary = { gold: g.gold, trinkets: [], permanent: [] };
  s.gold += g.gold;
  withRng(s, (rng) => {
    for (const grade of g.trinkets) {
      const id = rollTrinket(rng, grade, new Set(), grade === ORIGIN_GRADE);
      if (id) {
        s.trinkets.push(id);
        out.trinkets.push(id);
        if (TRINKET_MAP[id]?.grade === ORIGIN_GRADE) noteOrigin(s, id, true);
      }
    }
  });
  for (const id of g.named ?? []) {
    if (!TRINKET_MAP[id]) continue;
    s.trinkets.push(id);
    out.trinkets.push(id);
    if (TRINKET_MAP[id].grade === ORIGIN_GRADE) noteOrigin(s, id, true);
  }
  for (const p of g.permanent) {
    const u = s.board[p.slot - 1];
    if (!u) continue;
    const bonus: StatMods = { ...(u.bonus ?? {}) };
    bonus[p.stat] = (bonus[p.stat] ?? 0) + p.amount;
    if (!bonus[p.stat]) delete bonus[p.stat];
    if (Object.keys(bonus).length) u.bonus = bonus;
    else delete u.bonus;
    out.permanent.push({ uid: u.uid, defId: u.defId, stat: p.stat, amount: p.amount });
  }
  return out;
}

// 전투 결과 반영. 런이 끝나지 않으면 보상 단계로 넘어간다.
export function applyBattle(s: RunState, node: NodeOption, win: boolean, info: { opponent: string; matchStage: string; seconds: number; gains?: string }) {
  s.log.push({ day: s.day, node, win, ...info });
  if (node.mapId !== undefined) s.mapPath = [...(s.mapPath ?? []), node.mapId];
  if (win) s.wins++;
  else s.losses++;

  if (s.extension.active) {
    if (!win) return endRun(s, 'extensionLost', BALANCE.rank.extensionLossScore);
    s.extension.wins++;
    if (s.day >= R.maxDays) return endRun(s, 'extensionDone', extensionScore(s.extension.wins));
  } else {
    if (livesLeft(s) <= 0) return endRun(s, 'eliminated', s.wins - 5);
    if (s.wins >= R.winTarget && s.day >= R.maxDays) {
      return endRun(s, 'champion', BALANCE.rank.championScore + (node.kind === 'final' ? BALANCE.rank.finalBossBonus : 0));
    }
    // 라이프가 남은 채 마지막 날이 끝남 (모닥불·이벤트로 라이프를 늘리면 생길 수 있다)
    if (s.day >= R.maxDays && s.wins < R.winTarget) return endRun(s, 'outOfDays', s.wins - 5);
  }
  withRng(s, (rng) => {
    // 이벤트(?): 장신구 보상 대신 이벤트 상황·선택지 (나올 수 있는 이벤트가 없으면 보상 없이 넘어간다)
    const event = node.kind === 'event' ? pickEventStage(s, rng) : null;
    s.rewards = [...(event ? [event] : []), ...buildRewards(s, node, win, rng)];
  });
  s.phase = 'reward';
  if (s.rewards.length === 0) afterRewards(s);
}

// 오늘 기록(log)의 얻은 것에 한 줄 덧붙인다
function addGains(s: RunState, msg: string) {
  const last = s.log[s.log.length - 1];
  if (last) last.gains = [last.gains, msg].filter(Boolean).join(' · ');
}

export function buildRewards(s: RunState, node: NodeOption, win: boolean, rng: Rng): RewardStage[] {
  // 등급을 먼저 하나 뽑고, 그 등급의 서로 다른 장신구 rewardChoices개를 보여 준다. 이미 가진 장신구도 다시 나올 수 있다(중첩).
  // 모닥불: 이기든 지든 휴식(라이프) 또는 단련(리더 능력치) 하나. 이벤트: 장신구 보상 없음 (이벤트 단계는 applyBattle에서)
  if (node.kind === 'campfire') return [campfireStage()];
  if (node.kind === 'event') return [];
  const row = oddsRow(s.day, shopLevel(s));
  const rollRow = () => rollTrinketChoices(rng, rollGradeAmong(rng, row, (g) => g !== ORIGIN_GRADE && hasShopTrinkets(g)), R.rewardChoices);
  const stages: RewardStage[] = [{ label: '전투 보상', options: rollRow(), gold: BALANCE.economy.skipRewardGold }];
  if (win && node.kind === 'elite') {
    stages.push({ label: '엘리트 승리 보너스', options: rollRow(), gold: BALANCE.economy.skipEliteBonusGold });
  }
  if (win && node.kind === 'boss') {
    const grade = R.bossRewardGrade[s.day] ?? 3;
    stages.push({ label: '보스 승리 보상', options: rollTrinketChoices(rng, grade, R.rewardChoices, grade === ORIGIN_GRADE), gold: BALANCE.economy.skipBossRewardGold });
  }
  return stages;
}

// choice: 선택지 번호(0부터) 또는 'gold' (장신구·몬스터 고르기만. 이벤트·모닥불은 골드로 받기가 없다)
export function chooseReward(s: RunState, choice: number | 'gold'): OpResult {
  const stage = s.rewards[0];
  if (s.phase !== 'reward' || !stage) return { ok: false, msg: '보상 단계가 아닙니다.' };
  let msg: string;
  let next: RewardStage[] = [];
  if (stage.kind === 'event' || stage.kind === 'campfire') {
    if (choice === 'gold') return { ok: false, msg: '골드로 받을 수 없습니다. 선택지 하나를 고르세요.' };
    if (stage.kind === 'campfire') {
      const done = applyCampfire(s, stage.options[choice] ?? '');
      if (!done) return { ok: false, msg: '없는 선택지입니다.' };
      msg = done;
    } else {
      if (!stage.event) return { ok: false, msg: '이벤트 정보가 없습니다.' };
      const r = withRng(s, (rng) => applyEventChoice(s, stage.event!, choice, rng));
      if (!r.ok) return r;
      msg = r.msg;
      next = r.stages;
    }
    addGains(s, msg);
  } else if (choice === 'gold') {
    s.gold += stage.gold;
    msg = `${stage.gold}골드를 받았습니다.`;
    if (stage.kind === 'monster') addGains(s, `${stage.label}: 몬스터 대신 ${stage.gold}골드`);
  } else if (stage.kind === 'monster') {
    const id = stage.options[choice];
    if (!id || !MONSTER_MAP[id]) return { ok: false, msg: '없는 선택지입니다.' };
    msg = `${stage.label}: ${giveMonster(s, id)}`;
    addGains(s, msg);
  } else {
    const id = stage.options[choice];
    if (!id) return { ok: false, msg: '없는 선택지입니다.' };
    msg = `${giveTrinket(s, id)} 획득!`;
  }
  s.rewards.shift();
  s.rewards.unshift(...next);
  if (s.rewards.length === 0) afterRewards(s);
  return { ok: true, msg };
}

function afterRewards(s: RunState) {
  if (!s.extension.active && !s.extension.declined && s.wins >= R.winTarget) {
    s.phase = 'extendChoice';
    return;
  }
  beginDay(s);
}

export function chooseExtend(s: RunState, extend: boolean): OpResult {
  if (s.phase !== 'extendChoice') return { ok: false, msg: '연장 선택 단계가 아닙니다.' };
  if (!extend) {
    s.extension.declined = true;
    endRun(s, 'champion', BALANCE.rank.championScore);
    return { ok: true, msg: '우승으로 런을 마칩니다.' };
  }
  s.extension.active = true;
  beginDay(s);
  return { ok: true, msg: '연장에 도전합니다! 1패하면 끝납니다.' };
}

export function stopExtension(s: RunState): OpResult {
  if (!s.extension.active || s.phase !== 'shop') return { ok: false, msg: '연장 중일 때만 멈출 수 있습니다.' };
  endRun(s, 'extensionStop', extensionScore(s.extension.wins));
  return { ok: true, msg: '여기서 멈춥니다.' };
}
