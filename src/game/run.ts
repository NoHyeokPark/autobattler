// 한 판(런)의 진행: 하루 = 상점 단계 → 준비 완료 → 매칭 → 전투 → 보상.
// 이 파일은 상태 전이만 다룬다. 매칭과 전투 실행은 호출하는 쪽(UI, 시뮬레이터)이 맡는다.

import { BALANCE } from '../config/balance.ts';
import type { Rng } from '../core/rng.ts';
import { findGrowth, LEADER_MAP } from '../data/leaders.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import type { EnvId, PermanentStat, StatMods } from '../data/types.ts';
import type { BattleGains, TeamSnapshot } from '../battle/types.ts';
import { GRADE_NAMES } from '../data/types.ts';
import { statModsText } from '../data/describe.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { oddsRow, rollGrade, rollShop, rollTrinket, withRng } from './shop.ts';
import type { OpResult } from './shop.ts';
import type { NodeOption, RewardStage, RunEnd, RunState } from './state.ts';
import { deployLimit, shopLevel } from './state.ts';

const R = BALANCE.run;

export function beginDay(s: RunState, opts: { incomePenalty?: number } = {}) {
  s.day++;
  const eco = BALANCE.economy;
  const interest = Math.min(eco.interestMax, Math.floor(s.gold / eco.interestPer));
  const bonus = s.trinkets.reduce((n, id) => n + (TRINKET_MAP[id]?.passive?.incomeBonus ?? 0), 0);
  const base = Math.max(0, eco.baseIncome - (opts.incomePenalty ?? 0));
  s.gold += base + interest + bonus;
  s.lastIncome = { base, interest, bonus };
  withRng(s, (rng) => {
    if (!s.shopLocked || s.shop.length === 0) rollShop(s, rng);
    rollNodes(s, rng);
    s.growthChoices = [];
    if (BALANCE.leader.levelUpDays.includes(s.day)) {
      s.leaderLevel++;
      s.growthChoices = rollGrowth(s, rng);
    }
  });
  s.nodeIndex = 0;
  s.phase = s.growthChoices.length > 0 ? 'growth' : 'shop';
}

function rollNodes(s: RunState, rng: Rng) {
  const envRand: EnvId = rng.pick(['hp', 'atk'] as const);
  const anyEnv: EnvId = rng.pick(['normal', 'hp', 'atk'] as const);
  const nodes: NodeOption[] = [{ kind: 'normal', env: 'normal' }, { kind: 'env', env: envRand }];
  if (s.extension.active) {
    // 연장 중에는 일반·환경 노드만
  } else if (s.day === R.finalBossDay) {
    nodes.push({ kind: 'final', env: anyEnv }); // 9승 이후 미등장 규칙의 예외
  } else if (s.wins >= R.winTarget - 1) {
    // 9승 이후 10승 도전: 엘리트·보스 없음
  } else if (R.bossDays.includes(s.day)) {
    nodes.push({ kind: 'boss', env: anyEnv });
  } else {
    nodes.push({ kind: 'elite', env: anyEnv });
  }
  s.nodes = nodes;
}

function rollGrowth(s: RunState, rng: Rng): string[] {
  const leader = LEADER_MAP[s.leaderId];
  const pool = leader.growth.filter((g) => {
    // 통솔력(배치 인원 증가)은 9칸이 가득 차면 나오지 않는다.
    if (g.deploy && deployLimit(s) >= BALANCE.board.maxDeploy) return false;
    return g.repeatable || !s.growth.includes(g.id);
  });
  rng.shuffle(pool);
  return pool.slice(0, BALANCE.leader.growthChoices).map((g) => g.id);
}

export function chooseGrowth(s: RunState, idx: number): OpResult {
  const id = s.growthChoices[idx];
  if (s.phase !== 'growth' || !id) return { ok: false, msg: '고를 수 없는 선택지입니다.' };
  s.growth.push(id);
  s.growthChoices = [];
  s.phase = 'shop';
  return { ok: true, msg: `${findGrowth(s.leaderId, id)?.name} 습득!` };
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
      const id = rollTrinket(rng, grade, new Set(), grade === 6);
      if (id) {
        s.trinkets.push(id);
        out.trinkets.push(id);
      }
    }
  });
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
  if (win) s.wins++;
  else s.losses++;

  if (s.extension.active) {
    if (!win) return endRun(s, 'extensionLost', BALANCE.rank.extensionLossScore);
    s.extension.wins++;
    if (s.day >= R.maxDays) return endRun(s, 'extensionDone', extensionScore(s.extension.wins));
  } else {
    if (s.losses >= R.lossLimit) return endRun(s, 'eliminated', s.wins - 5);
    if (s.wins >= R.winTarget && s.day >= R.maxDays) {
      return endRun(s, 'champion', BALANCE.rank.championScore + (node.kind === 'final' ? BALANCE.rank.finalBossBonus : 0));
    }
  }
  withRng(s, (rng) => {
    s.rewards = buildRewards(s, node, win, rng);
  });
  s.phase = 'reward';
}

export function buildRewards(s: RunState, node: NodeOption, win: boolean, rng: Rng): RewardStage[] {
  // 이미 가진 장신구도 다시 나올 수 있다(중첩). 한 번의 선택지 안에서만 겹치지 않게 한다.
  const roll = (gradeFn: () => number, allowOrigin = false) => {
    const opts: string[] = [];
    const exclude = new Set<string>();
    for (let i = 0; i < R.rewardChoices; i++) {
      const id = rollTrinket(rng, gradeFn(), exclude, allowOrigin);
      if (id) {
        opts.push(id);
        exclude.add(id);
      }
    }
    return opts;
  };
  const row = oddsRow(s.day, shopLevel(s));
  const stages: RewardStage[] = [
    { label: '전투 보상', options: roll(() => Math.min(5, rollGrade(rng, row))), gold: BALANCE.economy.skipRewardGold },
  ];
  if (win && node.kind === 'elite') {
    stages.push({ label: '엘리트 승리 보너스', options: roll(() => Math.min(5, rollGrade(rng, row))), gold: BALANCE.economy.skipEliteBonusGold });
  }
  if (win && node.kind === 'boss') {
    const grade = R.bossRewardGrade[s.day] ?? 3;
    stages.push({ label: '보스 승리 보상', options: roll(() => grade, grade === 6), gold: BALANCE.economy.skipBossRewardGold });
  }
  return stages;
}

// choice: 장신구 번호(0부터) 또는 'gold'
export function chooseReward(s: RunState, choice: number | 'gold'): OpResult {
  const stage = s.rewards[0];
  if (s.phase !== 'reward' || !stage) return { ok: false, msg: '보상 단계가 아닙니다.' };
  let msg: string;
  if (choice === 'gold') {
    s.gold += stage.gold;
    msg = `${stage.gold}골드를 받았습니다.`;
  } else {
    const id = stage.options[choice];
    if (!id) return { ok: false, msg: '없는 선택지입니다.' };
    s.trinkets.push(id);
    msg = `장신구 ${TRINKET_MAP[id].name} 획득!`;
  }
  s.rewards.shift();
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
