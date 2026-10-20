// 상점 단계·선택 화면 텍스트 렌더링.

import { BALANCE } from '../config/balance.ts';
import { describeGrowth, tagChangeText } from '../data/describe.ts';
import { findUnitGrowth } from '../data/growth.ts';
import { findGrowth, isPromotion, LEADER_MAP } from '../data/leaders.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { isOneShot, TRINKET_MAP } from '../data/trinkets.ts';
import { ENV_NAMES, GRADE_NAMES } from '../data/types.ts';
import type { GrowthDef, Trigger } from '../data/types.ts';
import type { TeamSnapshot } from '../battle/types.ts';
import { campfireOptionText, choiceBlock, describeChoice } from '../game/events.ts';
import { itemCost, sellPrice, shopTier } from '../game/shop.ts';
import type { NodeOption, OwnedUnit, RunState } from '../game/state.ts';
import { deployedCount, deployLimit, shopLevel, trinketCounts, livesLeft } from '../game/state.ts';
import { boardTagCounts, leaderView, monsterView, pathTags, statLine } from '../game/view.ts';
import type { Profile } from '../game/profile.ts';
import { topCombos } from '../game/profile.ts';
import { cell, padEnd } from './text.ts';

const TPS = BALANCE.ticksPerSec;
const CELL = 20;

export const NODE_NAMES: Record<NodeOption['kind'], string> = { normal: '일반', env: '환경', elite: '엘리트', boss: '보스', final: '최종 보스', campfire: '모닥불', event: '?' };

export function rowEffectText(row: number, day: number): string {
  const s = BALANCE.slot;
  const x = s.row1.atkBonusByDay[Math.min(day, s.row1.atkBonusByDay.length) - 1] ?? s.row1.atkBonusByDay[0];
  return [
    `공격력 +${x}`,
    `회복·실드 +${s.row2.healShieldPct}%`,
    `간격 x${s.row3.intervalPermille / 1000}, 추가발동 +${s.row3.extra}`,
  ][row];
}

export function colEffectText(col: number): string {
  const s = BALANCE.slot;
  return [
    `시작 ${s.col1.stunTicks / TPS}초 기절, 간격 x${s.col1.intervalPermille / 1000}`,
    `배치 인원당 체력 +${s.col2.hpPctPerDeployed}%`,
    `간격 x${s.col3.intervalPermille / 1000}, 시작 즉시 행동`,
  ][col];
}

export function renderSlotHelp(day: number): string {
  const lines = ['[칸 효과] 칸의 효과 = 열 효과 + 행 효과 (행동 간격 보정은 곱연산)'];
  for (let c = 0; c < 3; c++) lines.push(`  ${c + 1}열: ${colEffectText(c)}`);
  for (let r = 0; r < 3; r++) lines.push(`  ${r + 1}행: ${rowEffectText(r, day)}`);
  lines.push('  슬롯 번호: 1행 = 1 2 3 / 2행 = 4 5 6 / 3행 = 7 8 9 (동률 시 번호가 작은 쪽 먼저)');
  return lines.join('\n');
}

export function unitName(u: OwnedUnit, s: RunState): string {
  if (u.leader) return `[L]${LEADER_MAP[u.defId].name} Lv${s.leaderLevel}`;
  return `${MONSTER_MAP[u.defId].name} Lv${u.level}${u.growth?.length ? '+' : ''}`;
}

export function renderUnitInfo(u: OwnedUnit, s: RunState, slot: number | null): string {
  const lines: string[] = [];
  if (u.leader) {
    const v = leaderView(LEADER_MAP[u.defId], s.leaderLevel, s.growth, u.bonus);
    lines.push(`${v.name} (리더 Lv${v.level}) [${v.tags.join(', ')}] ${statLine(v)}`);
    lines.push(`  ${v.desc}`);
    if (v.growthNames.length) lines.push(`  성장: ${v.growthNames.join(', ')}`);
    if (v.bonusText) lines.push(`  영구 강화: ${v.bonusText}`);
  } else {
    const def = MONSTER_MAP[u.defId];
    const v = monsterView(def, u.level, u.growth, u.bonus);
    lines.push(`${v.name} Lv${v.level} [${GRADE_NAMES[def.grade]} / ${v.tags.join(', ')}] ${statLine(v)} | 판매 ${sellPrice(u)}G`);
    lines.push(`  ${v.desc}`);
    if (v.growthNames.length) lines.push(`  성장: ${v.growthNames.join(', ')}`);
    if (v.bonusText) lines.push(`  영구 강화: ${v.bonusText} (합성 시 계열별 최고값만 유지)`);
  }
  if (slot !== null) {
    const r = Math.floor((slot - 1) / 3);
    const c = (slot - 1) % 3;
    lines.push(`  칸 ${slot} (${r + 1}행 ${c + 1}열): ${colEffectText(c)} / ${rowEffectText(r, s.day)}`);
  }
  return lines.join('\n');
}

function boardGrid(labels: string[]): string[] {
  const lines = [`        ${padEnd('1열', CELL)}${padEnd('2열', CELL)}3열`];
  for (let r = 0; r < 3; r++) {
    let line = `  ${r + 1}행  `;
    for (let c = 0; c < 3; c++) line += cell(`${r * 3 + c + 1} ${labels[r * 3 + c]}`, CELL);
    lines.push(line.trimEnd());
  }
  return lines;
}

export function renderSnapshotBoard(team: TeamSnapshot): string {
  const labels = Array(9).fill('.');
  for (const e of team.board) {
    labels[e.slot - 1] = e.kind === 'leader'
      ? `[L]${LEADER_MAP[e.defId].name} Lv${e.level}`
      : `${MONSTER_MAP[e.defId].name} Lv${e.level}${e.growth?.length ? '+' : ''}`;
  }
  const lines = boardGrid(labels);
  const growth = team.growth.map((g) => findGrowth(team.leaderId, g)?.name).filter(Boolean).join(', ');
  if (growth) lines.push(`  리더 성장: ${growth}`);
  lines.push(`  장신구: ${trinketListText(team.trinkets)}`);
  return lines.join('\n');
}

// "녹슨 반지 x2, 망원경"
export function trinketListText(ids: string[]): string {
  if (ids.length === 0) return '없음';
  return trinketCounts(ids).map(([id, n]) => `${TRINKET_MAP[id]?.name ?? id}${n > 1 ? ` x${n}` : ''}`).join(', ');
}

export function nodeText(n: NodeOption, day: number): string {
  const env = `환경: ${ENV_NAMES[n.env]}`;
  switch (n.kind) {
    case 'normal': return `일반 노드 - ${env}`;
    case 'env': return `환경 노드 - ${env}`;
    case 'elite': return `엘리트 - ${env} (일차+1 상대, 승리 시 장신구 보상 추가)`;
    case 'boss': {
      const g = BALANCE.run.bossRewardGrade[day];
      return `보스 - ${env} (일차+1 상대, 승리 시 ${GRADE_NAMES[g ?? 3]} 장신구 보상)`;
    }
    case 'final': return `최종 보스 - ${env} (연장 플레이어 기록, 승리 시 우승 +${BALANCE.rank.finalBossBonus}점)`;
    case 'campfire': return `모닥불 - ${env} (장신구 대신 라이프 +1, 승패 무관)`;
    case 'event': return `? 이벤트 - ${env} (장신구 대신 무작위 이벤트: 골드·몬스터·리더 성장, 승패 무관)`;
  }
}

// 지도에는 엘리트·보스인데 연장 중이라 일반 전투로 진행되는 노드 표시를 붙인 설명
export function nodeLabel(n: NodeOption, day: number): string {
  return n.mapKind ? `${nodeText(n, day)} [지도: ${NODE_NAMES[n.mapKind]} → 연장 중이라 일반 전투]` : nodeText(n, day);
}

export function renderHeader(s: RunState): string {
  const leader = LEADER_MAP[s.leaderId];
  const inc = s.lastIncome;
  const ext = s.extension.active ? ` | 연장 ${s.extension.wins}승` : '';
  return [
    `==================== ${s.day}일차 ====================`,
    `리더 ${leader.name} Lv${s.leaderLevel} | ${s.wins}승 ${s.losses}패 (라이프 ${livesLeft(s)})${ext} | 골드 ${s.gold}G (오늘 수입 +${inc.base + inc.interest + inc.bonus}: 기본 ${inc.base}·이자 ${inc.interest}${inc.bonus ? `·장신구 ${inc.bonus}` : ''})`,
  ].join('\n');
}

export function renderShopPhase(s: RunState): string {
  const out: string[] = [renderHeader(s)];
  const labels = s.board.map((u) => (u ? unitName(u, s) : '.'));
  out.push(`[보드] 배치 ${deployedCount(s)}/${deployLimit(s)}   (칸 효과: slots)`);
  out.push(...boardGrid(labels));
  out.push(`[벤치] ${s.bench.map((u, i) => `b${i + 1} ${u ? unitName(u, s) : '-'}`).join(' | ')}`);
  out.push(`[장신구] ${s.trinkets.length}개 ${s.trinkets.length ? '(목록: t)' : ''}`);
  const tier = shopTier(s);
  out.push(`[상점] 리롤 ${BALANCE.economy.rerollCost}G | 잠금 ${s.shopLocked ? 'ON' : 'OFF'} | 상점 레벨 ${tier.tier}${tier.bonus ? ` (${tier.day}일차 + 장신구 ${tier.bonus})` : ''}`);
  s.shop.forEach((item, i) => {
    if (!item) {
      out.push(`  ${i + 1}) (구매함)`);
      return;
    }
    if (item.kind === 'monster') {
      const d = MONSTER_MAP[item.defId];
      const v = monsterView(d);
      out.push(`  ${i + 1}) ${padEnd(d.name, 14)} ${itemCost(item)}G [${GRADE_NAMES[d.grade]}/${d.tags.join(',')}] ${statLine(v)} - ${v.desc}`);
    } else {
      const t = TRINKET_MAP[item.defId];
      const owned = s.trinkets.filter((x) => x === item.defId).length;
      out.push(`  ${i + 1}) ${padEnd('<장신구>' + t.name, 14)} ${itemCost(item)}G [${GRADE_NAMES[t.grade]}] ${t.desc}${owned ? ` (보유 x${owned})` : ''}`);
    }
  });
  out.push(`[노드] 선택: ${s.nodeIndex === null ? '없음' : s.nodeIndex + 1}   (지도 전체: map)`);
  s.nodes.forEach((n, i) => out.push(`  ${s.nodeIndex === i ? '>' : ' '}${i + 1}. ${nodeLabel(n, s.day)}`));
  const stop = s.extension.active ? ' | stop(여기서 멈추기)' : '';
  out.push(`명령: buy N | sell b1/5 | mv b1 5 | r(리롤) | lock | node N | map | i 5 | t | slots | go(준비 완료)${stop} | help`);
  return out.join('\n');
}

export const HELP = `
[명령어]
  buy N        상점 N번 구매 (몬스터는 벤치로, 같은 몬스터 3장이면 자동 합성)
  sell X       유닛 판매. X = 보드 칸 1~9 또는 벤치 b1~b6 (장신구는 판매 불가)
  mv X Y       유닛 이동/교체. 예) mv b1 5, mv 5 7
  r            리롤 (상점 새로 뽑기)
  lock         상점 잠금 켜기/끄기 (켜면 다음 날 상점이 유지됨. 다음 날 도착하거나 리롤하면 풀림)
  node N       노드 선택 (어제 노드와 이어진 것 중. 환경을 보고 배치를 바꿀 수 있음)
  map          지도 전체 (14일치 노드와 이어진 길)
  i X          유닛 정보. X = 1~9, b1~b6, s1~s6(상점)
  t            보유 장신구 목록
  slots        칸 효과 표
  speed 1|3|skip   전투 재생 속도
  go           준비 완료 → 상대 매칭 → 전투
  stop         (연장 중) 여기서 멈추고 점수 확정
  quit         저장하고 종료
`;

export function renderTrinkets(ids: string[]): string {
  if (ids.length === 0) return '보유한 장신구가 없습니다.';
  const lines: string[] = [];
  for (const oneShot of [false, true]) {
    const group = trinketCounts(ids).filter(([id]) => isOneShot(TRINKET_MAP[id]) === oneShot);
    if (group.length === 0) continue;
    lines.push(oneShot
      ? '[일회성 장신구] 조건이 맞는 순간 발동하고 사라집니다. 대상이 없으면 기다립니다.'
      : '[지속 장신구] 같은 장신구는 개수만큼 효과가 중첩됩니다.');
    for (const [id, n] of group) {
      const t = TRINKET_MAP[id];
      lines.push(`  - ${t?.name ?? id}${n > 1 ? ` x${n}` : ''} [${GRADE_NAMES[t?.grade ?? 1]}] ${t?.desc ?? ''}`);
    }
  }
  return lines.join('\n');
}

const rerollLine = (left: number) => (left > 0 ? `  r. 선택지 다시 뽑기 (${left}회 남음)` : '  (다시 뽑기 사용함)');

function growthLine(g: GrowthDef, base?: Trigger[]): string {
  return `${g.name} - ${g.desc || describeGrowth(g, base)}`;
}

export function renderGrowth(s: RunState): string {
  const growths = s.growthChoices.map((id) => findGrowth(s.leaderId, id)!);
  const transform = growths.length > 0 && s.growthChoices.every((id) => isPromotion(s.leaderId, id));
  const counts = boardTagCounts(s.board);
  const lines = [renderHeader(s), transform
    ? `리더가 Lv${s.leaderLevel}이 되었습니다! 길을 고르세요 (리더당 한 번. 변신 = 태그와 싸우는 방식이 바뀜, 본질 강화 = 태그 유지).`
    : `리더가 Lv${s.leaderLevel}이 되었습니다! 성장을 하나 고르세요.`];
  if (transform) lines.push(`  보드 태그: ${[...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ') || '없음'}`);
  const base = LEADER_MAP[s.leaderId]?.triggers;
  growths.forEach((g, i) => {
    const what = g.transform ? tagChangeText(g) : `본질 강화 · ${(LEADER_MAP[s.leaderId]?.tags ?? []).join('·')} 유지`;
    const match = transform ? ` [${what} · 보드 ${pathTags(s.leaderId, g).reduce((n, t) => n + (counts.get(t) ?? 0), 0)}장]` : '';
    const say = transform ? g.lines?.promote || g.quote : undefined;
    lines.push(`  ${i + 1}. ${growthLine(g, base)}${match}${say ? `\n       “${say}”` : ''}`);
  });
  if (!transform && BALANCE.leader.growthRerolls > 0) lines.push(rerollLine(s.growthRerolls ?? 0));
  return lines.join('\n');
}

export function renderFormChoice(s: RunState): string {
  const p = s.formChoices![0];
  const u = [...s.board, ...s.bench].find((x) => x?.uid === p.uid);
  const def = u ? MONSTER_MAP[u.defId] : undefined;
  const lines = [`${def?.name ?? '몬스터'} Lv${u?.level ?? 3} 진화! 합성한 유닛들의 모습이 달라 고를 수 있습니다 (능력은 모두 유지, 일러스트만 바뀜).`];
  p.options.forEach((form, i) => {
    lines.push(`  ${i + 1}. ${form ? `${findUnitGrowth(def?.id ?? '', form)?.name ?? form} 형태` : '기본 형태'}`);
  });
  return lines.join('\n');
}

export function renderPromotionChoice(s: RunState): string {
  const p = s.unitPromotions![0];
  const u = [...s.board, ...s.bench].find((x) => x?.uid === p.uid);
  const def = u ? MONSTER_MAP[u.defId] : undefined;
  const lines = [`${def?.name ?? '몬스터'} Lv${u?.level ?? 3} 전직! 길을 하나 고르세요 (반드시 하나).`];
  p.choices.forEach((id, i) => {
    const g = findUnitGrowth(def?.id ?? '', id);
    if (g) lines.push(`  ${i + 1}. ${growthLine(g, def?.triggers)}${g.quote ? ` “${g.quote}”` : ''}`);
  });
  return lines.join('\n');
}

export function renderUnitGrowth(s: RunState): string {
  const p = s.unitGrowth[0];
  const u = [...s.board, ...s.bench].find((x) => x?.uid === p.uid);
  const def = u ? MONSTER_MAP[u.defId] : undefined;
  const head = u && u.level > p.level
    ? `${def?.name ?? '몬스터'} Lv${p.level} 성장을 고르세요. (바로 Lv${u.level}로 합성되어 그대로 물려받습니다)`
    : `${def?.name ?? '몬스터'}가 Lv${p.level}이 되었습니다! 성장을 하나 고르세요.`;
  const lines = [head];
  p.choices.forEach((id, i) => {
    const g = findUnitGrowth(def?.id ?? '', id);
    if (g) lines.push(`  ${i + 1}. ${growthLine(g, def?.triggers)}`);
  });
  if (BALANCE.unit.growthRerolls > 0) lines.push(rerollLine(p.rerolls ?? 0));
  return lines.join('\n');
}

export function renderReward(s: RunState): string {
  const stage = s.rewards[0];
  if (stage.kind === 'event' && stage.event) {
    const lines = [`[이벤트: ${stage.event.name}] ${stage.event.text}`];
    stage.event.choices.forEach((c, i) => {
      const block = choiceBlock(s, c);
      lines.push(`  ${i + 1}. ${c.text} — ${describeChoice(c)}${block ? ` (고를 수 없음: ${block})` : ''}`);
    });
    return lines.join('\n');
  }
  if (stage.kind === 'campfire') {
    return [`[모닥불] 휴식 또는 단련 중 하나를 고르세요. (지금 라이프 ${livesLeft(s)})`, ...stage.options.map((o, i) => `  ${i + 1}. ${campfireOptionText(o)}`)].join('\n');
  }
  if (stage.kind === 'monster') {
    const lines = [`[${stage.label}] 데려갈 몬스터 하나를 고르거나 골드로 받으세요. 다음 날 벤치에 합류합니다 (벤치가 가득 차면 골드).`];
    stage.options.forEach((id, i) => {
      const d = MONSTER_MAP[id];
      const v = monsterView(d);
      lines.push(`  ${i + 1}. ${d.name} [${GRADE_NAMES[d.grade]}/${d.tags.join(',')}] ${statLine(v)} - ${v.desc}`);
    });
    lines.push(`  g. 받지 않고 ${stage.gold}골드`);
    return lines.join('\n');
  }
  const lines = [`[${stage.label}] 장신구 하나를 고르거나 골드로 받으세요.`];
  stage.options.forEach((id, i) => {
    const t = TRINKET_MAP[id];
    lines.push(`  ${i + 1}. ${t.name} [${GRADE_NAMES[t.grade]}] ${t.desc}`);
  });
  lines.push(`  g. 받지 않고 ${stage.gold}골드`);
  return lines.join('\n');
}

const END_TEXT: Record<string, string> = {
  champion: '우승!',
  eliminated: '탈락',
  outOfDays: '기한 종료',
  extensionStop: '연장 중 멈춤',
  extensionLost: '연장 패배',
  extensionDone: '연장 완주',
};

export function renderEnd(s: RunState, profile: Profile): string {
  const end = s.end!;
  const lines = [
    '==================== 런 종료 ====================',
    `${END_TEXT[end.reason]} | ${s.wins}승 ${s.losses}패 | 랭크 점수 ${end.score >= 0 ? '+' : ''}${end.score}`,
    '[일자별 기록]',
    ...s.log.map((l) => `  ${String(l.day).padStart(2)}일차 ${l.win ? '승' : '패'} | ${NODE_NAMES[l.node.kind]} 노드(${ENV_NAMES[l.node.env]}) | ${l.seconds.toFixed(1)}s | vs ${l.opponent} [${l.matchStage}]${l.gains ? ` | 획득: ${l.gains}` : ''}`),
  ];
  const r = profile.leaders[s.leaderId];
  if (r) {
    lines.push(`[${LEADER_MAP[s.leaderId].name} 기록] ${r.runs}판 | 우승 ${r.championships} | 최고 ${r.bestWins}승 | 누적 점수 ${r.totalScore}`);
    for (const [k, n] of topCombos(r)) lines.push(`  자주 쓴 조합(${n}회): ${k}`);
  }
  return lines.join('\n');
}

export function renderProfile(profile: Profile): string {
  const lines = ['[리더별 기록]'];
  for (const leader of Object.values(LEADER_MAP)) {
    const r = profile.leaders[leader.id];
    lines.push(r
      ? `  ${padEnd(leader.name, 10)} ${r.runs}판 | 우승 ${r.championships} | 최고 ${r.bestWins}승 | 누적 점수 ${r.totalScore}`
      : `  ${padEnd(leader.name, 10)} 기록 없음`);
  }
  return lines.join('\n');
}
