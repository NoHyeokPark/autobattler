// LLM 에이전트용 플레이 모드: 짧은 관찰 텍스트 + 한 줄 명령 묶음.
// 규칙은 새로 만들지 않고 웹·터미널 버전이 쓰는 함수(shop.ts·run.ts·day.ts)를 그대로 부른다 → 같은 시드·같은 행동·같은 기록 풀이면 결과가 같다.
// 파일 저장은 session.ts, 실행 입구는 cli.ts(명령줄)·mcp.ts(MCP 서버).

import { BALANCE } from '../config/balance.ts';
import { describeGrowth, describeStatus, describeTriggers, statModsText } from '../data/describe.ts';
import { findUnitGrowth, monsterName } from '../data/growth.ts';
import { findGrowth, isPromotion, LEADER_MAP, LEADERS, leaderPath } from '../data/leaders.ts';
import { MONSTER_MAP, MONSTERS } from '../data/monsters.ts';
import { SYNERGIES, synergyStates } from '../data/synergies.ts';
import { TRINKET_MAP, TRINKETS } from '../data/trinkets.ts';
import { ENV_NAMES, GRADE_NAMES, LEADER_STAT_NAMES, LEADER_STATS, STATUS_IDS } from '../data/types.ts';
import type { GrowthDef, LeaderStat } from '../data/types.ts';
import { campfireOptionText, choiceBlock, describeChoice } from '../game/events.ts';
import type { DayBattle } from '../game/day.ts';
import { playBattle } from '../game/day.ts';
import type { RecordStore } from '../game/matching.ts';
import { beginDay, chooseExtend, chooseGrowth, chooseReward, incomePreview, rerollGrowth, selectNode, stopExtension } from '../game/run.ts';
import { buy, chooseForm, choosePromotion, chooseUnitGrowth, getAt, itemCost, move, reroll, rerollUnitGrowth, sell, sellPrice, shopTier } from '../game/shop.ts';
import type { Loc, OpResult } from '../game/shop.ts';
import type { OwnedUnit, RunState } from '../game/state.ts';
import { createRun, deployedCount, deployLimit, livesLeft, trinketCounts } from '../game/state.ts';
import { leaderView, monsterView, pathTags, boardTagCounts, statLine } from '../game/view.ts';
import { colEffectText, nodeLabel, rowEffectText } from '../ui/render.ts';
import { mapText } from '../game/map.ts';

const TPS = BALANCE.ticksPerSec;
const sec = (ticks: number) => `${(ticks / TPS).toFixed(1)}s`;

// 행동 기록: 상태를 바꿀 수 있는 명령 (info·state는 남기지 않는다). 같은 시드·runId에서 차례로 다시 실행하면 같은 런이 된다.
// 실패한 명령도 남긴다: 게임 함수가 실패하면서도 상태를 조금 바꾸는 경우가 있어서 (예: 벤치가 차서 못 산 구매도 유닛 번호는 하나 쓴다. 웹에서 누른 것과 같다)
export interface AgentAction {
  day: number;
  phase: RunState['phase'];
  cmd: string;
  failed?: true;
}

export function startRun(leaderId: string, seed: number, runId: string): RunState {
  const s = createRun(leaderId, seed, runId);
  beginDay(s);
  return s;
}

// 리더 지정: id·이름·번호(1부터)·'random'(시드로 고름)
export function resolveLeader(input: string | undefined, seed: number): string | null {
  const v = (input ?? '').trim();
  if (!v || v === 'random') return LEADERS[Math.abs(seed) % LEADERS.length]?.id ?? null;
  if (/^\d+$/.test(v)) return LEADERS[Number(v) - 1]?.id ?? null;
  return LEADERS.find((l) => l.id === v || l.name === v || l.name.includes(v))?.id ?? null;
}

// ─────────────────────────── 관찰 ───────────────────────────

const PHASE_NAMES: Record<RunState['phase'], string> = {
  growth: '리더 성장 선택', shop: '상점', unitGrowth: '몬스터 성장 선택', reward: '보상 선택', extendChoice: '연장 선택', ended: '런 종료',
};

function unitLabel(u: OwnedUnit, s: RunState): string {
  if (u.leader) {
    const def = LEADER_MAP[u.defId];
    const v = leaderView(def, s.leaderLevel, s.growth, u.bonus);
    return `[리더] ${v.name} Lv${s.leaderLevel} {${v.tags.join(',')}} ${statLine(v)}${v.bonusText ? ` 강화(${v.bonusText})` : ''}`;
  }
  const def = MONSTER_MAP[u.defId];
  if (!def) return `${u.defId}(데이터 없음)`;
  const v = monsterView(def, u.level, u.growth, u.bonus);
  const growth = v.growthNames.length ? ` 성장(${v.growthNames.join(',')})` : '';
  return `${v.name} Lv${u.level} {${GRADE_NAMES[def.grade]}·${v.tags.join(',') || '태그 없음'}} ${statLine(v)}${growth}${v.bonusText ? ` 강화(${v.bonusText})` : ''}${def.deploy ? ` 통솔+${def.deploy}` : ''} 판매${sellPrice(u)}G`;
}

function owned(s: RunState): OwnedUnit[] {
  return [...s.board, ...s.bench].filter((u): u is OwnedUnit => !!u);
}

// ── 합성 미리 보기 (에이전트 전용 편의) ──
// 상태를 복사해 실제로 사 본다. 상점·성장 선택지의 난수는 런 시드로 이어지므로, 지금 상태에서 바로 사면 똑같은 선택지가 나온다.
// (같은 묶음에서 다른 합성·리롤을 먼저 하면 난수가 달라져 번호가 바뀔 수 있다 → pick은 이름으로도 고를 수 있다)
function pendingText(c: RunState): string[] {
  const find = (uid: number) => owned(c).find((u) => u.uid === uid);
  const out: string[] = [];
  for (const p of c.unitGrowth ?? []) {
    const def = MONSTER_MAP[find(p.uid)?.defId ?? ''];
    out.push(`[${def?.name ?? '몬스터'} Lv${p.level} 성장] ${p.choices.map((id, k) => `${k + 1}.${growthOption(findUnitGrowth(def?.id ?? '', id), def?.triggers)}`).join(' / ')}`);
  }
  for (const p of c.formChoices ?? []) {
    const u = find(p.uid);
    out.push(`[${MONSTER_MAP[u?.defId ?? '']?.name ?? '몬스터'} 외형(능력 같음)] ${p.options.map((f, k) => `${k + 1}.${f ? findUnitGrowth(u?.defId ?? '', f)?.name ?? f : '기본 형태'}`).join(' / ')}`);
  }
  for (const p of c.unitPromotions ?? []) {
    const def = MONSTER_MAP[find(p.uid)?.defId ?? ''];
    out.push(`[${def?.name ?? '몬스터'} 전직] ${p.choices.map((id, k) => `${k + 1}.${growthOption(findUnitGrowth(def?.id ?? '', id), def?.triggers)}`).join(' / ')}`);
  }
  return out;
}

// 이 상점 칸을 사면 무슨 일이 생기는가 (합성·선택지·실패). 아무 일 없으면 ''
function buyPreview(s: RunState, i: number): string {
  const item = s.shop[i];
  if (!item || item.kind !== 'monster' || s.gold < itemCost(item)) return '';
  const c = structuredClone(s);
  // 리더 성장을 고르는 중이면 먼저 하나 고른 상태로 본다 (리더 성장 선택은 합성·난수와 무관)
  if (c.phase === 'growth') chooseGrowth(c, 0);
  if (c.phase !== 'shop') return '';
  const r = buy(c, i);
  if (!r.ok) return `      ↳ 못 삼: ${r.msg}`;
  const merged = /합성/.test(r.msg);
  if (!merged) return '';
  const u = owned(c).filter((x) => x.defId === item.defId).sort((a, b) => b.level - a.level)[0];
  const pend = pendingText(c);
  if (!pend.length) return `      ↳ 사면 Lv${u?.level ?? 2} 합성 (고를 것 없음)`;
  return [`      ↳ 사면 Lv${u?.level ?? 2} 합성 → 이 순서로 고름 (예: buy S${i + 1}; pick 1${pend.length > 1 ? '; pick 1' : ''}):`, ...pend.map((x) => `        ${x}`)].join('\n');
}

function shopLines(s: RunState): string[] {
  return s.shop.map((item, i) => {
    if (!item) return `  S${i + 1} (구매함)`;
    if (item.kind === 'monster') {
      const d = MONSTER_MAP[item.defId];
      const v = monsterView(d);
      const have = owned(s).filter((u) => !u.leader && u.defId === d.id);
      const lv = (n: number) => have.filter((u) => u.level === n).length;
      const own = have.length ? ` · 보유 ${[1, 2, 3].filter((n) => lv(n)).map((n) => `Lv${n}x${lv(n)}`).join(' ')}` : '';
      const preview = buyPreview(s, i);
      return `  S${i + 1} ${d.name} ${itemCost(item)}G {${GRADE_NAMES[d.grade]}·${d.tags.join(',') || '태그 없음'}} ${statLine(v)}${d.deploy ? ` 통솔+${d.deploy}` : ''} — ${v.desc}${own}${preview ? `\n${preview}` : ''}`;
    }
    const t = TRINKET_MAP[item.defId];
    const n = s.trinkets.filter((x) => x === item.defId).length;
    return `  S${i + 1} <장신구> ${t.name} ${itemCost(item)}G {${GRADE_NAMES[t.grade]}} — ${trinketText(t.id)}${n ? ` · 보유 x${n}` : ''}`;
  });
}

function trinketText(id: string): string {
  const t = TRINKET_MAP[id];
  if (!t) return id;
  return t.desc?.trim() || describeTriggers(t.triggers, undefined, true) || '(설명 없음)';
}

function synergyLine(s: RunState): string {
  const units = s.board.flatMap((u) => {
    if (!u) return [];
    if (u.leader) return LEADER_MAP[u.defId] ? [{ id: u.defId, tags: leaderView(LEADER_MAP[u.defId], s.leaderLevel, s.growth).tags }] : [];
    return MONSTER_MAP[u.defId] ? [{ id: u.defId, tags: monsterView(MONSTER_MAP[u.defId], u.level, u.growth).tags }] : [];
  });
  const st = synergyStates(units);
  if (!st.length) return '';
  return `시너지: ${st.map(({ syn, count, tier }) => `${syn.name?.trim() ? `${syn.name.trim()}[${syn.tag}]` : syn.tag} ${count}/${syn.tiers.map((t) => t.count).join('·')}${tier >= 0 ? `(${tier + 1}단계 발동)` : ''}`).join(' | ')}`;
}

function growthOption(g: GrowthDef | undefined, base?: Parameters<typeof describeGrowth>[1]): string {
  if (!g) return '(데이터 없음)';
  return `${g.name} — ${g.desc?.trim() || describeGrowth(g, base)}`;
}

// 지금 고를 수 있는 것 (선택 단계)
function choiceLines(s: RunState): string[] {
  const out: string[] = [];
  if (s.phase === 'growth') {
    const promo = s.growthChoices.length > 0 && s.growthChoices.every((id) => isPromotion(s.leaderId, id));
    const counts = boardTagCounts(s.board);
    out.push(promo ? `리더 Lv${s.leaderLevel} 전직: 하나를 고르세요 (런에 한 번)` : `리더 Lv${s.leaderLevel} 성장: 하나를 고르세요`);
    s.growthChoices.forEach((id, i) => {
      const g = findGrowth(s.leaderId, id);
      const tags = promo && g ? ` [태그 ${pathTags(s.leaderId, g).join('·') || '없음'}, 보드에 ${pathTags(s.leaderId, g).reduce((n, t) => n + (counts.get(t) ?? 0), 0)}장]` : '';
      out.push(`  ${i + 1}. ${growthOption(g, LEADER_MAP[s.leaderId]?.triggers)}${tags}`);
    });
    out.push(promo ? '명령: pick N' : `명령: pick N | reroll (남은 ${s.growthRerolls ?? 0}회)`);
  } else if (s.phase === 'unitGrowth') {
    const find = (uid: number) => owned(s).find((u) => u.uid === uid);
    if (s.unitGrowth.length === 0 && s.formChoices?.length) {
      const p = s.formChoices[0];
      const u = find(p.uid);
      out.push(`${u ? MONSTER_MAP[u.defId]?.name : '몬스터'} Lv3 진화 외형 선택 (능력은 같고 그림만 다름)`);
      p.options.forEach((f, i) => out.push(`  ${i + 1}. ${f ? `${findUnitGrowth(u?.defId ?? '', f)?.name ?? f} 형태` : '기본 형태'}`));
      out.push('명령: pick N');
    } else if (s.unitGrowth.length === 0 && s.unitPromotions?.length) {
      const p = s.unitPromotions[0];
      const u = find(p.uid);
      const def = u ? MONSTER_MAP[u.defId] : undefined;
      out.push(`${def?.name ?? '몬스터'} Lv3 전직: 하나를 고르세요`);
      p.choices.forEach((id, i) => out.push(`  ${i + 1}. ${growthOption(findUnitGrowth(def?.id ?? '', id), def?.triggers)}`));
      out.push('명령: pick N');
    } else if (s.unitGrowth.length) {
      const p = s.unitGrowth[0];
      const u = find(p.uid);
      const def = u ? MONSTER_MAP[u.defId] : undefined;
      out.push(`${def?.name ?? '몬스터'} Lv${p.level} 성장: 하나를 고르세요${u && u.level > p.level ? ` (바로 Lv${u.level}로 합성되어 물려받음)` : ''}`);
      p.choices.forEach((id, i) => out.push(`  ${i + 1}. ${growthOption(findUnitGrowth(def?.id ?? '', id), def?.triggers)}`));
      out.push(`명령: pick N | reroll (남은 ${p.rerolls ?? 0}회)`);
    }
  } else if (s.phase === 'reward') {
    const st = s.rewards[0];
    if (st.kind === 'event' && st.event) {
      out.push(`이벤트 "${st.event.name}": ${st.event.text}`);
      st.event.choices.forEach((c, i) => {
        const block = choiceBlock(s, c);
        out.push(`  ${i + 1}. ${c.text} — ${describeChoice(c)}${block ? ` (고를 수 없음: ${block})` : ''}`);
      });
      out.push('명령: pick N (골드로 받기 없음)');
    } else if (st.kind === 'campfire') {
      out.push(`모닥불: 휴식 또는 단련 하나 (지금 라이프 ${livesLeft(s)})`);
      st.options.forEach((o, i) => out.push(`  ${i + 1}. ${campfireOptionText(o)}`));
      out.push('명령: pick N (골드로 받기 없음)');
    } else if (st.kind === 'monster') {
      const have = (id: string) => owned(s).filter((u) => u.defId === id).length;
      out.push(`${st.label}: 몬스터 하나(다음 날 벤치로, 벤치가 가득 차면 골드) 또는 골드`);
      st.options.forEach((id, i) => out.push(`  ${i + 1}. ${monsterInfo(id).replace(/\n/g, '\n     ')}${have(id) ? ` (보유 ${have(id)})` : ''}`));
    } else {
      out.push(`${st.label}: 장신구 하나 또는 골드`);
      st.options.forEach((id, i) => out.push(`  ${i + 1}. ${TRINKET_MAP[id]?.name ?? id} {${GRADE_NAMES[TRINKET_MAP[id]?.grade ?? 1]}} — ${trinketText(id)}`));
    }
    if (st.kind !== 'event' && st.kind !== 'campfire') out.push(`명령: pick N | gold (${st.gold}G 받기)`);
  } else if (s.phase === 'extendChoice') {
    out.push(`${BALANCE.run.winTarget}승 달성! 연장하면 매일 멈출 수 있고 1패하면 끝 (연장 승리 보너스 ${BALANCE.rank.extensionBonus.slice(1).join('/')})`);
    out.push('명령: extend yes | extend no (우승 확정)');
  }
  return out;
}

export function observe(s: RunState): string {
  const L = LEADER_MAP[s.leaderId];
  const path = leaderPath(s.leaderId, s.growth);
  const out: string[] = [];
  if (s.phase === 'ended' && s.end) {
    out.push(`== 런 종료: ${s.end.reason} · ${s.wins}승 ${s.losses}패 · 점수 ${s.end.score} ==`);
    out.push(...s.log.map((l) => `  D${l.day} ${l.win ? '승' : '패'} ${l.node.kind}/${ENV_NAMES[l.node.env]} ${l.seconds.toFixed(1)}s vs ${l.opponent}${l.gains ? ` · ${l.gains}` : ''}`));
    out.push('새 런: new_game (명령줄: new)');
    return out.join('\n');
  }
  const inc = incomePreview(s);
  const tier = shopTier(s);
  out.push(`== ${s.day}일차 · ${PHASE_NAMES[s.phase]} == ${s.wins}승 ${s.losses}패 · 라이프 ${livesLeft(s)} (${BALANCE.run.winTarget}승 우승, 라이프 0이면 탈락${s.extension.active ? `, 연장 ${s.extension.wins}승` : ''})`);
  out.push(`리더 ${path?.name ?? L.name} Lv${s.leaderLevel} | 골드 ${s.gold}G (내일 수입 +${inc.base + inc.interest + inc.bonus}: 기본${inc.base} 이자${inc.interest}${inc.bonus ? ` 장신구${inc.bonus}` : ''}${inc.nextAt ? `, ${inc.nextAt}G 더 남기면 이자+1` : `, 이자 최대: ${BALANCE.economy.interestMax * BALANCE.economy.interestPer}G 넘게 남긴 골드는 이자가 더 붙지 않음`}) | 배치 ${deployedCount(s)}/${deployLimit(s)} | 상점Lv${tier.tier} 리롤${BALANCE.economy.rerollCost}G 잠금${s.shopLocked ? 'ON' : 'OFF'}`);
  for (const n of s.notices ?? []) out.push(`알림: ${n}`);
  out.push('보드 (1행=1·2·3, 2행=4·5·6, 3행=7·8·9 / 열: 1열 시작 기절, 2열 체력, 3열 즉시 행동):');
  s.board.forEach((u, i) => { if (u) out.push(`  ${i + 1} ${unitLabel(u, s)}`); });
  const empty = s.board.map((u, i) => (u ? 0 : i + 1)).filter(Boolean);
  if (empty.length) out.push(`  빈 칸: ${empty.join(',')}`);
  const bench = s.bench.map((u, i) => (u ? `  B${i + 1} ${unitLabel(u, s)}` : '')).filter(Boolean);
  out.push(bench.length ? '벤치:' : '벤치: 비어 있음');
  out.push(...bench);
  out.push(`장신구: ${s.trinkets.length ? trinketCounts(s.trinkets).map(([id, n]) => `${TRINKET_MAP[id]?.name ?? id}${n > 1 ? ` x${n}` : ''}`).join(', ') : '없음'}`);
  const syn = synergyLine(s);
  if (syn) out.push(syn);
  if (s.phase !== 'shop') out.push(...choiceLines(s));
  if (s.phase === 'shop' || s.phase === 'growth' || s.phase === 'unitGrowth') {
    out.push(s.phase === 'shop' ? '상점:' : '상점 (위에서 고른 뒤 같은 act에서 이어서 살 수 있음, 예: "pick 2; buy S3; move B1 5"):');
    out.push(...shopLines(s));
    out.push(`노드 (어제 노드와 이어진 것 중 하나, 지도 전체는 info map): ${s.nodes.map((n, i) => `${s.nodeIndex === i ? '▶' : ''}${i + 1}.${nodeLabel(n, s.day)}`).join(' | ')}`);
    out.push(`명령: buy S1 | sell 5/B1 | move B1 5 (자리 바꾸기도) | reroll | lock | node N | ready${s.extension.active ? ' | stop (연장 멈추기)' : ''} | info X`);
  }
  return out.join('\n');
}

// ─────────────────────────── 전투 요약 ───────────────────────────

export function battleSummary(b: DayBattle, s: RunState): string {
  const r = b.result;
  const out: string[] = [];
  out.push(`전투 ${b.win ? '승리' : '패배'} · ${sec(r.endTick)}${r.suddenDeath ? ' (서든데스)' : ''}${r.reason === 'timeout' ? ' (시간 초과 판정)' : ''} · ${b.node.kind}/${ENV_NAMES[b.node.env]} · vs ${b.match.team.name} [${b.match.stage}]`);
  out.push(`  체력: 나 ${Math.max(0, r.finalHp[0])}/${r.maxHp[0]} · 상대 ${Math.max(0, r.finalHp[1])}/${r.maxHp[1]}`);
  for (const side of [0, 1] as const) {
    const us = r.units.filter((u) => u.side === side).sort((a, b) => b.damage + b.heal + b.shield - (a.damage + a.heal + a.shield));
    const top = us.slice(0, 5).map((u) => {
      const parts = [u.damage && `피해${u.damage}`, u.heal && `회복${u.heal}`, u.shield && `실드${u.shield}`].filter(Boolean).join('/');
      return `${u.slot}.${u.isLeader ? '[리더]' : ''}${u.name} Lv${u.level} ${parts || '-'} (행동${u.acts})`;
    });
    out.push(`  ${side === 0 ? '내 기여' : '상대 기여'}: ${top.join(' · ')}`);
  }
  const foe = b.match.team;
  const board = [...foe.board].sort((a, c) => a.slot - c.slot).map((e) => {
    const name = e.kind === 'leader' ? `[리더]${leaderPath(foe.leaderId, foe.growth)?.name ?? LEADER_MAP[e.defId]?.name ?? e.defId}` : monsterName(e.defId, e.growth);
    return `${e.slot}.${name} Lv${e.level}`;
  });
  out.push(`  상대 보드: ${board.join(' · ')} | 장신구: ${foe.trinkets.map((id) => TRINKET_MAP[id]?.name ?? id).join(', ') || '없음'}`);
  if (b.gains) {
    const g = [b.gains.gold && `골드+${b.gains.gold}`, b.gains.trinkets.length && `장신구 ${b.gains.trinkets.map((id) => TRINKET_MAP[id]?.name ?? id).join(',')}`,
      ...b.gains.permanent.map((p) => `${MONSTER_MAP[p.defId]?.name ?? LEADER_MAP[p.defId]?.name ?? p.defId} ${statModsText({ [p.stat]: p.amount })}`)].filter(Boolean);
    if (g.length) out.push(`  전투 후 획득: ${g.join(' · ')}`);
  }
  out.push(`  → ${s.wins}승 ${s.losses}패`);
  return out.join('\n');
}

// ─────────────────────────── 명령 실행 ───────────────────────────

export interface ExecResult {
  lines: string[]; // 명령별 결과
  actions: AgentAction[]; // 이번에 상태를 바꾼 명령 (행동 기록에 붙일 것)
  battles: DayBattle[];
  stopped?: string; // 남은 명령을 건너뛴 이유
}

function parseLoc(t: string | undefined): Loc | null {
  if (!t) return null;
  const v = t.trim().toUpperCase();
  const b = /^B([1-9])$/.exec(v);
  if (b) return Number(b[1]) <= BALANCE.board.benchSize ? { area: 'bench', index: Number(b[1]) - 1 } : null;
  if (/^[1-9]$/.test(v)) return { area: 'board', index: Number(v) - 1 };
  return null;
}
const parseShop = (t: string | undefined) => {
  const m = /^S?([1-9])$/i.exec((t ?? '').trim());
  return m ? Number(m[1]) - 1 : null;
};
const parseNum = (t: string | undefined) => (/^\d+$/.test((t ?? '').trim()) ? Number(t) - 1 : null);
const bad = (msg: string): OpResult => ({ ok: false, msg });

const PHASE_CMDS: Record<RunState['phase'], string[]> = {
  shop: ['buy', 'sell', 'move', 'reroll', 'lock', 'node', 'ready', 'stop'],
  growth: ['pick', 'reroll'],
  unitGrowth: ['pick', 'reroll'],
  reward: ['pick', 'gold'],
  extendChoice: ['extend'],
  ended: [],
};
const ALIASES: Record<string, string> = { mv: 'move', r: 'reroll', go: 'ready', p: 'pick', choose: 'pick', b: 'buy', s: 'sell' };

// 명령 하나. 상태를 바꾸면 changed = true
function runOne(s: RunState, store: RecordStore, cmdRaw: string, out: ExecResult): { res: OpResult; changed: boolean; battle?: DayBattle } {
  const [head, a, b] = cmdRaw.trim().split(/\s+/);
  const cmd = ALIASES[head.toLowerCase()] ?? head.toLowerCase();
  if (cmd === 'info') return { res: { ok: true, msg: info(s, cmdRaw.trim().slice(head.length).trim()) }, changed: false };
  if (cmd === 'state') return { res: { ok: true, msg: '(상태는 아래)' }, changed: false };
  const allowed = PHASE_CMDS[s.phase];
  if (!allowed.includes(cmd)) {
    return { res: bad(`지금은 ${PHASE_NAMES[s.phase]} 단계라 "${head}"를 쓸 수 없습니다. 가능: ${allowed.join(', ') || '없음 (new_game)'}`), changed: false };
  }
  switch (cmd) {
    case 'buy': {
      const i = parseShop(a);
      return { res: i === null ? bad('예) buy S2') : buy(s, i), changed: true };
    }
    case 'sell': {
      const loc = parseLoc(a);
      return { res: loc ? sell(s, loc) : bad('예) sell 5, sell B1'), changed: true };
    }
    case 'move': {
      const from = parseLoc(a);
      const to = parseLoc(b);
      return { res: from && to ? move(s, from, to) : bad('예) move B1 5, move 5 7'), changed: true };
    }
    case 'reroll':
      if (s.phase === 'growth') return { res: rerollGrowth(s), changed: true };
      if (s.phase === 'unitGrowth') return { res: s.unitGrowth.length ? rerollUnitGrowth(s) : bad('외형·전직 선택은 다시 뽑을 수 없습니다'), changed: true };
      return { res: reroll(s), changed: true };
    case 'lock': {
      // 웹·터미널과 같은 방식 (상점 잠금 표시만 바꾼다). lock on/off로 지정도 가능
      const want = a?.toLowerCase() === 'on' ? true : a?.toLowerCase() === 'off' ? false : !s.shopLocked;
      s.shopLocked = want;
      return { res: { ok: true, msg: `상점 잠금 ${want ? 'ON (다음 날 상점 유지)' : 'OFF'}` }, changed: true };
    }
    case 'node': {
      const i = parseNum(a);
      return { res: i === null ? bad('예) node 2') : selectNode(s, i), changed: true };
    }
    case 'stop':
      return { res: stopExtension(s), changed: true };
    case 'ready': {
      try {
        const battle = playBattle(s, store);
        return { res: { ok: true, msg: battleSummary(battle, s) }, changed: true, battle };
      } catch (e) {
        return { res: bad(e instanceof Error ? e.message : String(e)), changed: false };
      }
    }
    case 'pick': {
      const arg = cmdRaw.trim().slice(head.length).trim();
      const i = parseNum(arg) ?? pickByName(s, arg);
      if (i === null) return { res: bad(arg ? `"${arg}"는 지금 선택지에 없습니다 (지금: ${choiceNames(s).map((n, k) => `${k + 1}.${n}`).join(' ')})` : '예) pick 1, pick 근력 강화'), changed: false };
      if (s.phase === 'growth') return { res: chooseGrowth(s, i), changed: true };
      if (s.phase === 'reward') return { res: chooseReward(s, i), changed: true };
      if (s.unitGrowth.length) return { res: chooseUnitGrowth(s, i), changed: true };
      if (s.formChoices?.length) return { res: chooseForm(s, i), changed: true };
      if (s.unitPromotions?.length) return { res: choosePromotion(s, i), changed: true };
      return { res: bad('고를 것이 없습니다'), changed: false };
    }
    case 'gold':
      return { res: chooseReward(s, 'gold'), changed: true };
    case 'extend': {
      const v = (a ?? '').toLowerCase();
      if (!['yes', 'y', 'no', 'n'].includes(v)) return { res: bad('예) extend yes / extend no'), changed: false };
      return { res: chooseExtend(s, v.startsWith('y')), changed: true };
    }
  }
  void out;
  return { res: bad(`알 수 없는 명령 "${head}"`), changed: false };
}

// 지금 고르는 선택지의 이름 (pick 이름용). pick 번호와 같은 순서
function choiceNames(s: RunState): string[] {
  const unit = (uid: number) => owned(s).find((u) => u.uid === uid)?.defId ?? '';
  if (s.phase === 'growth') return s.growthChoices.map((id) => findGrowth(s.leaderId, id)?.name ?? id);
  if (s.phase === 'reward') {
    const st = s.rewards[0];
    if (st?.kind === 'event') return (st.event?.choices ?? []).map((c) => c.text);
    if (st?.kind === 'campfire') return st.options.map((o) => (o === 'rest' ? '휴식' : LEADER_STAT_NAMES[o as LeaderStat] ?? o));
    return (st?.options ?? []).map((id) => (st.kind === 'monster' ? MONSTER_MAP[id]?.name : TRINKET_MAP[id]?.name) ?? id);
  }
  if (s.phase !== 'unitGrowth') return [];
  if (s.unitGrowth.length) return s.unitGrowth[0].choices.map((id) => findUnitGrowth(unit(s.unitGrowth[0].uid), id)?.name ?? id);
  if (s.formChoices?.length) return s.formChoices[0].options.map((f) => (f ? findUnitGrowth(unit(s.formChoices![0].uid), f)?.name ?? f : '기본 형태'));
  if (s.unitPromotions?.length) return s.unitPromotions[0].choices.map((id) => findUnitGrowth(unit(s.unitPromotions![0].uid), id)?.name ?? id);
  return [];
}
// 이름이 정확히 같거나, 그 글자를 포함하는 것이 하나뿐이면 그것
function pickByName(s: RunState, name: string): number | null {
  if (!name) return null;
  const names = choiceNames(s);
  const exact = names.indexOf(name);
  if (exact >= 0) return exact;
  const part = names.map((n, k) => (n.includes(name) ? k : -1)).filter((k) => k >= 0);
  return part.length === 1 ? part[0] : null;
}

// 명령 묶음: ';' 또는 줄바꿈으로 구분. 실패하면 거기서 멈추고(상황이 바뀌었으니 다시 판단), 전투(ready) 뒤에도 멈춘다 (결과를 보고 다음을 정하게)
export function execute(s: RunState, store: RecordStore, commands: string): ExecResult {
  const out: ExecResult = { lines: [], actions: [], battles: [] };
  const list = commands.split(/[;\n]/).map((c) => c.trim()).filter(Boolean);
  for (const [k, c] of list.entries()) {
    const day = s.day;
    const phase = s.phase;
    const { res, changed, battle } = runOne(s, store, c, out);
    out.lines.push(`${res.ok ? '✓' : '✗'} ${c}: ${res.msg}`);
    if (changed) out.actions.push({ day, phase, cmd: c, ...(res.ok ? {} : { failed: true as const }) });
    if (battle) out.battles.push(battle);
    const rest = list.length - k - 1;
    if (!res.ok) {
      if (rest) out.stopped = `실패해서 남은 명령 ${rest}개를 실행하지 않았습니다`;
      break;
    }
    if (battle) {
      if (rest) out.stopped = `전투가 끝나 남은 명령 ${rest}개를 실행하지 않았습니다 (결과를 보고 다시 정하세요)`;
      break;
    }
  }
  return out;
}

// ─────────────────────────── 정보 ───────────────────────────

function monsterInfo(id: string, level = 1, growth: string[] = [], bonus?: OwnedUnit['bonus']): string {
  const d = MONSTER_MAP[id];
  const v = monsterView(d, level, growth, bonus);
  const lines = [`${v.name} Lv${level} {${GRADE_NAMES[d.grade]}·${v.tags.join(',') || '태그 없음'}} ${statLine(v)} · 가격 ${BALANCE.economy.monsterCost[d.grade - 1]}G${d.shop === false ? ' (상점 미등장)' : ''}${d.deploy ? ` · 보드에 있으면 배치 인원 +${d.deploy}` : ''}`];
  lines.push(`  능력: ${v.desc}`);
  if (v.growthNames.length) lines.push(`  성장: ${v.growthNames.join(', ')}`);
  if (v.bonusText) lines.push(`  영구 강화: ${v.bonusText} (합성 시 계열별 최고값만 유지)`);
  if (d.growth?.length) lines.push(`  전용 성장 후보: ${d.growth.map((g) => `${g.name}(${g.desc?.trim() || describeGrowth(g, d.triggers)})`).join(' / ')}`);
  if (d.promotions?.length) lines.push(`  Lv3 전직 후보: ${d.promotions.map((g) => `${g.name}(${g.desc?.trim() || describeGrowth(g, d.triggers)})`).join(' / ')}`);
  return lines.join('\n');
}

function leaderInfo(id: string, s?: RunState): string {
  const L = LEADER_MAP[id];
  const mine = s && s.leaderId === id;
  const v = leaderView(L, mine ? s.leaderLevel : 1, mine ? s.growth : []);
  const lines = [`[리더] ${v.name} Lv${v.level} {${v.tags.join(',')}} ${statLine(v)}`, `  능력: ${v.desc}`];
  if (v.growthNames.length) lines.push(`  고른 성장: ${v.growthNames.join(', ')}`);
  lines.push(`  성장 후보: ${L.growth.map((g) => `${g.name}(${g.desc?.trim() || describeGrowth(g, L.triggers)})`).join(' / ')}`);
  if (L.promotions?.length) lines.push(`  전직(Lv${BALANCE.leader.promotionLevels.join('/')}): ${L.promotions.map((g) => `${g.name}[${pathTags(id, g).join('·')}](${g.desc?.trim() || describeGrowth(g, L.triggers)})`).join(' / ')}`);
  return lines.join('\n');
}

// info X: S1~S6(상점), 1~9(보드), B1~B6(벤치), 이름·id(몬스터·장신구·리더), monsters / trinkets / leaders / synergies (목록)
export function info(s: RunState | null, target: string): string {
  const t = target.trim();
  if (!t) return 'info 대상: S1~S6, 1~9, B1~B6, 이름(몬스터·장신구·리더), monsters, trinkets, leaders, synergies, slots, map';
  const low = t.toLowerCase();
  if (low === 'monsters') {
    return MONSTERS.filter((m) => m.shop !== false).sort((a, b) => a.grade - b.grade).map((m) => {
      const v = monsterView(m);
      return `${GRADE_NAMES[m.grade]} ${m.name} ${BALANCE.economy.monsterCost[m.grade - 1]}G {${m.tags.join(',') || '-'}} ${statLine(v)} — ${v.desc}`;
    }).join('\n');
  }
  if (low === 'trinkets') return TRINKETS.filter((x) => x.shop !== false).sort((a, b) => a.grade - b.grade).map((x) => `${GRADE_NAMES[x.grade]} ${x.name} — ${trinketText(x.id)}`).join('\n');
  if (low === 'leaders') return LEADERS.map((l, i) => `${i + 1}. ${leaderInfo(l.id)}`).join('\n');
  if (low === 'synergies') {
    return SYNERGIES.map((sy) => `${sy.name?.trim() || sy.tag}[${sy.tag}]: ${sy.tiers.map((tier) => `${tier.count}명 ${tier.desc?.trim() || describeTriggers(tier.triggers, undefined, true)}`).join(' / ')}`).join('\n') || '시너지 없음';
  }
  if (low === 'slots') return slotText(s?.day ?? 1);
  if (low === 'map') return s ? mapText(s) : '진행 중인 런이 없습니다';
  if (s) {
    const shop = /^S([1-9])$/i.exec(t);
    if (shop) {
      const item = s.shop[Number(shop[1]) - 1];
      if (!item) return '빈 칸입니다';
      return item.kind === 'monster' ? monsterInfo(item.defId) : `<장신구> ${TRINKET_MAP[item.defId].name} {${GRADE_NAMES[TRINKET_MAP[item.defId].grade]}} ${itemCost(item)}G — ${trinketText(item.defId)}`;
    }
    const loc = parseLoc(t);
    if (loc) {
      const u = getAt(s, loc);
      if (!u) return '빈 칸입니다';
      const where = loc.area === 'board' ? `\n  칸 ${loc.index + 1}: ${colEffectText(loc.index % 3)} / ${rowEffectText(Math.floor(loc.index / 3), s.day)}` : '';
      return (u.leader ? leaderInfo(u.defId, s) : monsterInfo(u.defId, u.level, u.growth, u.bonus)) + where;
    }
  }
  const m = MONSTERS.find((x) => x.id === t || x.name === t) ?? MONSTERS.find((x) => x.name.includes(t));
  if (m) return monsterInfo(m.id);
  const tr = TRINKETS.find((x) => x.id === t || x.name === t) ?? TRINKETS.find((x) => x.name.includes(t));
  if (tr) return `<장신구> ${tr.name} {${GRADE_NAMES[tr.grade]}} ${BALANCE.economy.trinketCost[tr.grade - 1]}G${tr.shop === false ? ' (상점·보상 미등장)' : ''} — ${trinketText(tr.id)}`;
  const l = LEADERS.find((x) => x.id === t || x.name === t) ?? LEADERS.find((x) => x.name.includes(t));
  if (l) return leaderInfo(l.id, s ?? undefined);
  return `"${t}"을(를) 찾지 못했습니다. ${info(s, '')}`;
}

function slotText(day: number): string {
  const lines = ['칸 효과 = 열 효과 + 행 효과 (칸 번호: 1행 1·2·3, 2행 4·5·6, 3행 7·8·9)'];
  for (let c = 0; c < 3; c++) lines.push(`  ${c + 1}열: ${colEffectText(c)}`);
  for (let r = 0; r < 3; r++) lines.push(`  ${r + 1}행: ${rowEffectText(r, day)}`);
  return lines.join('\n');
}

// 처음 한 번 읽는 규칙 요약 (지금 적용된 수치·데이터로 만든다)
export function rulesText(): string {
  const e = BALANCE.economy;
  const r = BALANCE.run;
  const lines = [
    '# 덱빌딩 오토배틀러 규칙 요약 (에이전트용)',
    `목표: 최대 ${r.maxDays}일. 하루 = (레벨업 날이면 리더 성장 선택) → 상점(구매·배치) → 지도에서 노드 선택 → ready(자동 전투) → 보상. ${r.winTarget}승이면 우승(연장 선택). 라이프 ${r.lossLimit}개로 시작해 질 때마다 1씩 줄고 0이면 탈락.`,
    `지도: 런을 시작할 때 ${r.maxDays}일치 지도가 정해진다 (슬레이 더 스파이어처럼 갈래가 나뉘고 이어진다). 매일 어제 고른 노드와 이어진 노드 중 하나를 고른다 (info map으로 전체 보기). 노드 = 종류 + 환경(일반·체력 증가·공격 증가).`,
    `  장신구 보상은 등급을 먼저 하나 뽑고 그 등급 장신구 ${r.rewardChoices}개 중 하나를 고른다 (또는 골드).
  일반: 이기든 지든 장신구 보상 · 엘리트: 일차+1 상대, 이기면 장신구 보상 하나 더 · 보스(${r.bossDays.join('·')}일차의 엘리트는 보스로 나온다): 일차+1 상대, 이기면 높은 등급 장신구`,
    `  모닥불(${BALANCE.map.campfireDays.join('·')}일차 선택지, 보스 뒤에 잘 이어짐): 전투 뒤(이기든 지든, 졌으면 탈락 판정이 먼저) 장신구 대신 휴식(라이프 +${BALANCE.campfire.restLives}) 또는 단련(리더 ${LEADER_STATS.map((k) => `${LEADER_STAT_NAMES[k]} +${BALANCE.campfire.train[k]}`).join(' / ')} 중 하나, 영구) 중 하나`,
    `  ?(이벤트): 전투 뒤 장신구 대신 이벤트 상황과 선택지. 선택지마다 결과(장신구·몬스터·리더 성장·골드·라이프·리더 능력치)가 적혀 있고, 골드를 내야 하거나 라이프가 모자라 고를 수 없는 선택지도 있다. 몬스터는 다음 날 벤치로.`,
    `  최종 보스(${r.finalBossDay}일차): 연장 플레이어 기록. 연장 중에는 엘리트·보스가 일반 전투로 진행된다.`,
    `  ${r.maxDays}일차가 시작될 때 남은 라이프(마지막 전투에 쓸 1개 빼고)는 하나당 ${r.spareLifeGold}골드로 바뀐다. 라이프가 남은 채 마지막 날이 끝나면 기한 종료.`,
    `상대: 같은 일차에 같은 환경을 고른 다른 플레이어의 기록(없으면 봇).`,
    `경제: 매일 기본 수입 ${e.baseIncome}G + 이자(남긴 골드 ${e.interestPer}G마다 1, 최대 ${e.interestMax}). 리롤 ${e.rerollCost}G. 몬스터 가격(등급순) ${e.monsterCost.join('/')}G, 장신구 ${e.trinketCost.slice(0, 6).join('/')}G. 판매 = 구매가 × 합성 장수 × ${e.sellPct}%.`,
    `상점: ${BALANCE.shop.slots}칸, 일차(+장신구)에 따라 높은 등급 확률 증가. 잠금(lock)하면 다음 날 상점 유지 (리롤하거나 다음 날이 되면 풀림).`,
    `합성: 이름과 레벨이 모두 같은 몬스터 ${BALANCE.unit.mergeCount}장이 보드·벤치 어디에든 모이면 자동으로 다음 레벨 (Lv1→2→3, 능력치 ${BALANCE.unit.levelStatPct.join('/')}%). Lv1 3장→Lv2, Lv2 3장→Lv3이며 다른 레벨끼리는 합쳐지지 않는다 (Lv2 1장 + Lv1 2장은 합성 안 됨). 리더는 재료가 될 수 없다. Lv2가 될 때 성장 하나 선택, Lv3는 재료 3장의 성장을 모두 가짐(+전직이 있는 몬스터는 반드시 전직). 영구 강화(전투 후 얻는 수치)는 합산되지 않고 재료 중 가장 높은 값만 남는다.`,
    `레벨업 장신구(각성의 쪽지·두루마리 / 진화의 조약돌·결정·보석 등)는 1회용이다. 쪽지·두루마리는 다음에 사는 몬스터가 곧바로 Lv2로 들어오는 것이라, 이미 2장 가진 몬스터의 3장째를 사도 합성 대신 별개의 Lv2 한 장이 생긴다 (합성을 노린다면 다른 몬스터를 살 때 쓸 것). 조약돌 계열은 보드·벤치의 Lv1 유닛 하나(등급 제한 있음)를 무작위로 Lv2로 올린다.`,
    `배치: 리더 포함 ${BALANCE.board.initialDeployLimit}명으로 시작해 최대 ${BALANCE.board.maxDeploy}명까지 늘어난다. 늘리는 방법은 통솔력(배치 인원 +1) 성장을 고르는 것뿐이며, 리더 성장 후보나 통솔력이 붙은 몬스터의 성장 후보에 무작위로 나타나므로 매번 나오지는 않는다 (나오면 고를지 판단할 것). 벤치 ${BALANCE.board.benchSize}칸은 배치 인원에 안 들어가고 전투에도 참여하지 않는다. 리더는 벤치로 못 감.`,
    `리더: ${BALANCE.leader.levelUpDays.join('·')}일차에 레벨업(능력치 +${BALANCE.leader.statPctPerLevel}%/레벨)하며 성장 선택, Lv${BALANCE.leader.promotionLevels.join('/')}에서 전직(태그·전투 방식이 바뀜).`,
    `전투: 자동. 양 팀 체력은 유닛 체력의 합(팀 체력 하나). 각 유닛은 행동 간격마다 능력 발동(추가발동 = 한 번에 더 발동). ${BALANCE.suddenDeath.startSec}초부터 서든데스(양쪽에 점점 커지는 피해).`,
    slotText(1),
    '팀 상태 효과 (팀 단위로 쌓임):',
    ...STATUS_IDS.filter((id) => BALANCE.statuses[id]).map((id) => `  ${BALANCE.statuses[id].name}: ${describeStatus(id)}`),
    `태그 시너지: 보드의 서로 다른 몬스터(+리더) 태그 수에 따라 보조 효과 (info synergies).`,
    '',
    '# 명령 (; 또는 줄바꿈으로 여러 개를 한 번에. 실패하거나 전투가 끝나면 거기서 멈춤)',
    '상점: buy S2 | sell 5 / sell B1 | move B1 5 (차 있으면 자리 바꾸기) | reroll | lock [on|off] | node 2 | ready | stop(연장 중 멈추기)',
    '선택: pick N 또는 pick 이름 (리더 성장·몬스터 성장·외형·전직·보상) | reroll (성장 선택지 다시 뽑기) | gold (보상 대신 골드) | extend yes/no',
    '합성 미리 보기: 상점에서 사면 합성되는 몬스터 아래에 그때 나올 성장·전직 선택지가 미리 나온다 → "buy S2; pick 강인함; move B1 5"처럼 한 번에 보내면 된다.',
    '  (같은 act에서 다른 합성·리롤을 먼저 하면 번호가 바뀔 수 있으니 그럴 때는 pick 이름을 쓰세요. 이름이 선택지에 없으면 거기서 멈춤)',
    '선택 단계(리더 성장 등)에서도 상점이 보이므로 "pick 2; buy S1; buy S3; node 1; ready"처럼 하루를 한 번에 보낼 수 있다.',
    '정보 (상태 변화 없음): info S1 | info 5 | info B2 | info 이름 | info monsters | info trinkets | info leaders | info synergies | info slots',
    '',
    '# 진행',
    '런은 끝까지 플레이합니다 (중간에 새로 시작하면 포기로 기록). act에는 note로 판단 이유를 한두 문장 남기세요.',
  ];
  return lines.join('\n');
}

// 행동 기록을 처음부터 다시 실행 (결과 동일성 확인용). store는 처음 런 때와 같은 기록 풀이어야 한다
export function replayActions(leaderId: string, seed: number, runId: string, log: AgentAction[], store: RecordStore): { state: RunState; failed: string[] } {
  const s = startRun(leaderId, seed, runId);
  const failed: string[] = [];
  for (const a of log) {
    const r = execute(s, store, a.cmd);
    const ok = r.lines[0]?.startsWith('✓');
    if (r.actions.length !== 1 || ok === !!a.failed) failed.push(`D${a.day} ${a.cmd}: ${r.lines.join(' / ')}`);
  }
  return { state: s, failed };
}
