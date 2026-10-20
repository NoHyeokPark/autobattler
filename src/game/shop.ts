import { BALANCE } from '../config/balance.ts';
import { Rng } from '../core/rng.ts';
import { findUnitGrowth, mergeBonus, monsterName, monsterPromotion, rerollPick, rollUnitGrowth, unitGrowthCandidates } from '../data/growth.ts';
import { MONSTER_MAP, MONSTERS } from '../data/monsters.ts';
import { GRADE_NAMES, MAX_GRADE, ORIGIN_GRADE } from '../data/types.ts';
import { TRINKET_MAP, TRINKETS } from '../data/trinkets.ts';
import type { OwnedUnit, RunState, ShopItem } from './state.ts';
import { deployedCount, deployLimit, shopLevel, noteOrigin, unitDeploy } from './state.ts';

export type Loc = { area: 'board' | 'bench'; index: number };
export interface OpResult {
  ok: boolean;
  msg: string;
}

const ok = (msg: string): OpResult => ({ ok: true, msg });
const fail = (msg: string): OpResult => ({ ok: false, msg });

export function withRng<T>(s: RunState, fn: (rng: Rng) => T): T {
  const rng = new Rng(s.rng);
  const r = fn(rng);
  s.rng = rng.state;
  return r;
}

export function oddsRow(day: number, level: number, shift = 0): number[] {
  const rows = BALANCE.shop.odds;
  return rows[Math.max(0, Math.min(rows.length - 1, day - 1 + level + shift))];
}

export function rollGrade(rng: Rng, row: number[]): number {
  return rng.weighted(row) + 1;
}

// 쓸 수 없는 등급(뽑을 것이 없는 등급)의 칸은 빼고 나머지 비율대로 뽑는다. 다 빠지면 원래 표대로
export function rollGradeAmong(rng: Rng, row: number[], usable: (grade: number) => boolean): number {
  const masked = row.map((w, i) => (usable(i + 1) ? w : 0));
  return rollGrade(rng, masked.some((w) => w > 0) ? masked : row);
}
const hasMonsters = (g: number) => MONSTERS.some((m) => m.grade === g && m.shop !== false); // 상점에 나올 수 있는 몬스터가 있는 등급

// 지금 상점이 쓰는 확률표 줄 = 일차 + 상점 레벨 장신구 (표 끝을 넘으면 마지막 줄). 화면의 "상점 레벨"
export function shopTier(s: RunState): { tier: number; day: number; bonus: number; row: number[] } {
  const rows = BALANCE.shop.odds;
  const bonus = shopLevel(s);
  const tier = Math.max(1, Math.min(rows.length, s.day + bonus));
  return { tier, day: s.day, bonus, row: rows[tier - 1] };
}

// 장신구 하나를 뽑는다. 이미 가진 장신구도 다시 나올 수 있다(중첩).
// exclude는 같은 진열(상점 한 번, 보상 선택지 한 번) 안에서 겹치지 않게 할 때만 쓴다.
// 해당 등급에 남은 게 없으면 낮은 등급으로 내려간다.
export function rollTrinket(rng: Rng, grade: number, exclude: Set<string>, allowOrigin = false): string | null {
  for (let g = grade; g >= 1; g--) {
    if (g === ORIGIN_GRADE && !allowOrigin) continue;
    const pool = TRINKETS.filter((t) => t.grade === g && t.shop !== false && !exclude.has(t.id));
    if (pool.length > 0) return rng.pick(pool).id;
  }
  return null;
}

// 보상 선택지: 모두 같은 등급의 서로 다른 장신구 n개 (그 등급에 n개가 안 되면 있는 만큼).
// 그 등급에 하나도 없으면 rollTrinket처럼 낮은 등급으로 내려가 그 등급에서 고른다.
export function rollTrinketChoices(rng: Rng, grade: number, n: number, allowOrigin = false): string[] {
  for (let g = grade; g >= 1; g--) {
    if (g === ORIGIN_GRADE && !allowOrigin) continue;
    const pool = TRINKETS.filter((t) => t.grade === g && t.shop !== false).map((t) => t.id);
    if (!pool.length) continue;
    rng.shuffle(pool);
    return pool.slice(0, n);
  }
  return [];
}
export const hasShopTrinkets = (g: number) => TRINKETS.some((t) => t.grade === g && t.shop !== false);

export function rollShop(s: RunState, rng: Rng) {
  const row = oddsRow(s.day, shopLevel(s));
  const items: ShopItem[] = [];
  const exclude = new Set<string>();
  const maxed = maxedMonsters(s);
  let trinkets = 0;
  for (let i = 0; i < BALANCE.shop.slots; i++) {
    const grade = rollGradeAmong(rng, row, hasMonsters);
    if (trinkets < BALANCE.shop.maxTrinkets && rng.chancePct(BALANCE.shop.trinketChancePct)) {
      const id = rollTrinket(rng, Math.min(grade, ORIGIN_GRADE - 1), exclude);
      if (id) {
        exclude.add(id);
        trinkets++;
        items.push({ kind: 'trinket', defId: id });
        continue;
      }
    }
    items.push({ kind: 'monster', defId: rng.pick(monsterPool(grade, maxed)).id });
  }
  s.shop = items;
}

// 최고 레벨로 가진 몬스터 (보드·벤치). 상점에 더 나오지 않는다 (장르 관례: 한 유닛 도배 방지)
export function maxedMonsters(s: RunState): Set<string> {
  const out = new Set<string>();
  if (!BALANCE.shop.hideMaxLevelOwned) return out;
  for (const u of [...s.board, ...s.bench]) if (u && !u.leader && u.level >= BALANCE.unit.maxLevel) out.add(u.defId);
  return out;
}

// 이 등급에서 나올 수 있는 몬스터. 빠진 것 때문에 비면 낮은 등급 → 높은 등급 순으로 찾는다
function monsterPool(grade: number, maxed: Set<string>) {
  const at = (g: number) => MONSTERS.filter((m) => m.grade === g && m.shop !== false && !maxed.has(m.id));
  for (let g = grade; g >= 1; g--) if (at(g).length) return at(g);
  for (let g = grade + 1; g <= MAX_GRADE; g++) if (at(g).length) return at(g);
  const any = MONSTERS.filter((m) => m.grade === grade && m.shop !== false);
  return any.length ? any : MONSTERS.filter((m) => m.grade === 1 && m.shop !== false);
}

export function itemCost(item: NonNullable<ShopItem>): number {
  if (item.kind === 'monster') return BALANCE.economy.monsterCost[MONSTER_MAP[item.defId].grade - 1];
  return BALANCE.economy.trinketCost[TRINKET_MAP[item.defId].grade - 1];
}

export function sellPrice(u: OwnedUnit): number {
  const cost = BALANCE.economy.monsterCost[MONSTER_MAP[u.defId].grade - 1];
  const copies = BALANCE.unit.mergeCount ** (u.level - 1);
  return Math.floor((cost * copies * BALANCE.economy.sellPct) / 100);
}

export function getAt(s: RunState, loc: Loc): OwnedUnit | null {
  return (loc.area === 'board' ? s.board : s.bench)[loc.index] ?? null;
}

function setAt(s: RunState, loc: Loc, u: OwnedUnit | null) {
  (loc.area === 'board' ? s.board : s.bench)[loc.index] = u;
}

function allLocs(s: RunState): Loc[] {
  return [
    ...s.board.map((_, i) => ({ area: 'board' as const, index: i })),
    ...s.bench.map((_, i) => ({ area: 'bench' as const, index: i })),
  ];
}

// 레벨업: 레벨을 올리고, 성장 선택 레벨(기본 Lv2)이면 선택지를 대기열에 넣는다 (상점 단계에서 바로 고른다).
// 몬스터 대사 이벤트 (대사가 있을 때만, 최근 몇 개만 남긴다)
function voice(s: RunState, defId: string, kind: 'buy' | 'maxLevel') {
  if (!MONSTER_MAP[defId]?.lines?.[kind]?.trim()) return;
  s.voices = [...(s.voices ?? []), { defId, kind }].slice(-4);
}

function levelUp(s: RunState, u: OwnedUnit) {
  u.level++;
  if (u.level === BALANCE.unit.maxLevel) {
    if (MONSTER_MAP[u.defId]?.promotions?.length) promote(s, u);
    else voice(s, u.defId, 'maxLevel');
  }
  if (!BALANCE.unit.growthChoiceLevels.includes(u.level)) return;
  const choices = withRng(s, (rng) => rollUnitGrowth(u.defId, u.growth ?? [], rng, u.level));
  if (choices.length > 0) (s.unitGrowth ??= []).push({ uid: u.uid, level: u.level, choices, rerolls: BALANCE.unit.growthRerolls });
}

// 몬스터 전직: 최고 레벨이 되면 반드시. 길이 하나면 바로, 여럿이면 고르는 대기열에 넣는다 (이미 전직했으면 없음)
function promote(s: RunState, u: OwnedUnit) {
  const list = MONSTER_MAP[u.defId]?.promotions ?? [];
  if (list.length === 0 || monsterPromotion(u.defId, u.growth) || s.unitPromotions?.some((p) => p.uid === u.uid)) return;
  if (list.length === 1) applyPromotion(s, u, list[0].id);
  else (s.unitPromotions ??= []).push({ uid: u.uid, choices: list.map((g) => g.id) });
}

function applyPromotion(s: RunState, u: OwnedUnit, id: string) {
  const g = MONSTER_MAP[u.defId]?.promotions?.find((p) => p.id === id);
  if (!g) return;
  const from = monsterName(u.defId, u.growth);
  addGrowth(u, [id]);
  setForm(u, g.form ? id : undefined); // 전직 모습 (art/monsters/<id>.lv3.<전직 id>.png)
  // 작은 알림 (리더 전직보다 가볍게): 대사가 없어도 "A → B" 는 보여 준다
  s.voices = [...(s.voices ?? []), { defId: u.defId, kind: 'promote' as const, promoId: id, from, growth: [...(u.growth ?? [])], form: u.form }].slice(-4);
}

// 성장 합치기: 반복 가능한 성장은 그대로 중첩, 반복 불가 성장은 하나만 남긴다.
function addGrowth(u: OwnedUnit, ids: string[]) {
  const list = (u.growth ??= []);
  for (const id of ids) {
    if (list.includes(id) && !findUnitGrowth(u.defId, id)?.repeatable) continue;
    list.push(id);
  }
}

// 같은 몬스터·같은 레벨 3장을 합쳐 레벨업. 연쇄 합성까지 처리.
// 남는 유닛은 보드 쪽 앞 칸. 어느 유닛이 남든 결과는 같다:
//  - 성장: 재료 3장의 성장을 모두 합친다 (Lv2 3장 → Lv3은 각 Lv2의 성장을 모두 가짐. Lv3에서는 새 선택 없음)
//  - 영구 강화(bonus): 합산하지 않고 계열별 최고값만 남긴다 (Lv1에 강화를 모아 한 번에 키우는 것 방지)
//  - 외형(form): 재료들의 외형이 모두 같으면 그대로, 다르면 어느 외형으로 진화할지 고르는 선택을 대기열에 넣는다
//  - 아직 고르지 않은 성장 선택도 남는 유닛으로 넘어간다
export function mergeAll(s: RunState): string[] {
  const msgs: string[] = [];
  const need = BALANCE.unit.mergeCount;
  for (;;) {
    const groups = new Map<string, Loc[]>();
    for (const loc of allLocs(s)) {
      const u = getAt(s, loc);
      if (!u || u.leader || u.level >= BALANCE.unit.maxLevel) continue;
      const key = `${u.defId}@${u.level}`;
      groups.set(key, [...(groups.get(key) ?? []), loc]);
    }
    const hit = [...groups.values()].find((g) => g.length >= need);
    if (!hit) return msgs;
    const keep = getAt(s, hit[0])!;
    const used = hit.slice(-(need - 1));
    const all = [keep, ...used.map((l) => getAt(s, l)!)];
    // 영구 강화: 합산하지 않고 계열별 최고값 (재료 3장 중 가장 좋은 값)
    const bonus = mergeBonus(all.map((u) => u.bonus));
    const forms = [...new Set(all.map((u) => u.form ?? ''))];
    const hadFormChoice = (s.formChoices ?? []).filter((p) => all.some((u) => u.uid === p.uid)).flatMap((p) => p.options);
    s.formChoices = (s.formChoices ?? []).filter((p) => !all.some((u) => u.uid === p.uid));
    for (const loc of used) {
      const gone = getAt(s, loc)!;
      addGrowth(keep, gone.growth ?? []);
      for (const p of s.unitGrowth ?? []) if (p.uid === gone.uid) p.uid = keep.uid;
      setAt(s, loc, null);
    }
    if (bonus) keep.bonus = bonus;
    else delete keep.bonus;
    const options = [...new Set([...forms, ...hadFormChoice])];
    setForm(keep, options[0]);
    const promotesNow = keep.level + 1 >= BALANCE.unit.maxLevel && !!MONSTER_MAP[keep.defId]?.promotions?.length;
    if (options.length > 1 && !promotesNow) s.formChoices.push({ uid: keep.uid, options });
    levelUp(s, keep);
    msgs.push(`${MONSTER_MAP[keep.defId].name} 합성! Lv${keep.level}`);
  }
}

function setForm(u: OwnedUnit, form: string | undefined) {
  if (form) u.form = form;
  else delete u.form;
}

function findUnit(s: RunState, uid: number): OwnedUnit | null {
  return [...s.board, ...s.bench].find((u) => u?.uid === uid) ?? null;
}

// 선택 대기열(성장·외형·전직)이 모두 비면 상점 단계로 돌아간다
function settlePhase(s: RunState) {
  if (s.phase === 'unitGrowth' && (s.unitGrowth?.length ?? 0) === 0 && (s.formChoices?.length ?? 0) === 0 && (s.unitPromotions?.length ?? 0) === 0) s.phase = 'shop';
}

// 합성 레벨업 성장 선택. 외형 변화 성장이면 일러스트 형태도 바뀐다.
// 몬스터 성장 선택지 다시 뽑기 (선택마다 BALANCE.unit.growthRerolls회)
export function rerollUnitGrowth(s: RunState): OpResult {
  const p = s.unitGrowth?.[0];
  if (!p) return fail('성장을 고르는 중이 아닙니다.');
  if ((p.rerolls ?? 0) <= 0) return fail('다시 뽑기를 이미 썼습니다.');
  const u = findUnit(s, p.uid);
  if (!u) return fail('유닛을 찾을 수 없습니다.');
  const pool = unitGrowthCandidates(u.defId, u.growth ?? [], p.level).map((g) => g.id);
  const next = withRng(s, (rng) => rerollPick(pool, p.choices, BALANCE.unit.growthChoices, rng));
  if (!next) return fail('다른 성장이 없어 다시 뽑을 수 없습니다.');
  p.choices = next;
  p.rerolls = (p.rerolls ?? 0) - 1;
  return ok('성장 선택지를 다시 뽑았습니다.');
}

export function chooseUnitGrowth(s: RunState, idx: number): OpResult {
  const pending = s.unitGrowth?.[0];
  const id = pending?.choices[idx];
  if (!pending || !id) return fail('고를 수 없는 선택지입니다.');
  const u = findUnit(s, pending.uid);
  s.unitGrowth.shift();
  const g = findUnitGrowth(u?.defId ?? '', id);
  if (u) {
    addGrowth(u, [id]);
    const promoted = u.level >= BALANCE.unit.maxLevel && !!MONSTER_MAP[u.defId]?.promotions?.length; // 전직 모습이 우선
    if (g?.form && !promoted) {
      if (u.level === pending.level) setForm(u, id);
      else {
        // 고르기 전에 이미 Lv3으로 합성된 경우: 이 형태도 진화 후보에 넣는다
        const fc = (s.formChoices ??= []).find((p) => p.uid === u.uid);
        if (fc) {
          if (!fc.options.includes(id)) fc.options.push(id);
        } else if ((u.form ?? '') !== id) {
          s.formChoices.push({ uid: u.uid, options: [u.form ?? '', id] });
        }
      }
    }
  }
  settlePhase(s);
  return ok(`${u ? MONSTER_MAP[u.defId]?.name : ''} 성장: ${g?.name ?? id}`);
}

// Lv3 진화 외형 선택 ('' = 기본 형태)
export function chooseForm(s: RunState, idx: number): OpResult {
  const pending = s.formChoices?.[0];
  if (!pending || idx < 0 || idx >= pending.options.length) return fail('고를 수 없는 선택지입니다.');
  const u = findUnit(s, pending.uid);
  const form = pending.options[idx];
  s.formChoices!.shift();
  if (u) setForm(u, form);
  settlePhase(s);
  const name = form ? findUnitGrowth(u?.defId ?? '', form)?.name ?? form : '기본';
  return ok(`${u ? MONSTER_MAP[u.defId]?.name : ''}: ${name} 형태로 진화`);
}

// 몬스터 전직 고르기 (길이 여럿일 때). 성장·외형 선택이 먼저 끝난 뒤에 고른다
export function choosePromotion(s: RunState, idx: number): OpResult {
  const pending = s.unitPromotions?.[0];
  const id = pending?.choices[idx];
  if (!pending || !id) return fail('고를 수 없는 선택지입니다.');
  if (s.unitGrowth?.length || s.formChoices?.length) return fail('성장 선택을 먼저 끝내세요.');
  s.unitPromotions!.shift();
  const u = findUnit(s, pending.uid);
  const from = u ? monsterName(u.defId, u.growth) : '';
  if (u) applyPromotion(s, u, id);
  settlePhase(s);
  return ok(`${from} 전직: ${u ? monsterName(u.defId, u.growth) : id}`);
}

// 성장·외형·전직 선택이 생겼으면 선택 단계로
export function enterChoicePhase(s: RunState) {
  if ((s.unitGrowth?.length || s.formChoices?.length || s.unitPromotions?.length) && s.phase === 'shop') s.phase = 'unitGrowth';
}

function removeOneTrinket(s: RunState, id: string) {
  const i = s.trinkets.indexOf(id);
  if (i >= 0) s.trinkets.splice(i, 1);
}

// 혼돈의 주사위(변이): 보드의 몬스터 하나를 무작위로 골라 한 단계 높은 등급의 무작위 몬스터로 바꾼다.
// 레벨·고른 성장·영구 강화는 그대로 둔다 (다른 몬스터의 전용 성장도 findUnitGrowth가 찾아 준다).
// 외형(form)은 원래 몬스터의 모습이라 지우고 새 몬스터의 기본 모습으로 시작한다.
function transmute(s: RunState, u: OwnedUnit): string | null {
  const grade = MONSTER_MAP[u.defId]?.grade;
  if (grade === undefined) return null;
  const up = nextGrade(grade);
  const pool = MONSTERS.filter((m) => m.grade === up);
  if (pool.length === 0) return null;
  const before = monsterName(u.defId, u.growth);
  const old = MONSTER_MAP[u.defId].promotions ?? [];
  const next = withRng(s, (rng) => rng.pick(pool));
  u.defId = next.id;
  delete u.form;
  if (old.length && u.growth) u.growth = u.growth.filter((id) => !old.some((p) => p.id === id));
  if (u.level >= BALANCE.unit.maxLevel) promote(s, u);
  if (next.grade === ORIGIN_GRADE) noteOrigin(s, next.id);
  return `${before} → ${next.name} (${GRADE_NAMES[next.grade]})`;
}

// 몬스터가 있는 바로 위 등급 (없으면 undefined). 비어 있는 등급(예: 고급 몬스터가 없음)은 건너뛴다
const nextGrade = (g: number) => {
  for (let x = g + 1; x <= MAX_GRADE; x++) if (MONSTERS.some((m) => m.grade === x)) return x;
  return undefined;
};
const canTransmute = (u: OwnedUnit | null): u is OwnedUnit => {
  const g = u && !u.leader ? MONSTER_MAP[u.defId]?.grade : undefined;
  return g !== undefined && nextGrade(g) !== undefined;
};

// 일회성 장신구 발동. 상점 단계에서 대상이 생기는 순간(구매·이동·하루 시작) 발동하고 사라진다. 대상이 없으면 보관.
//  - 진화의 돌 계열: 보드·벤치의 조건 맞는 Lv1 유닛 하나를 무작위로 Lv2로 (보드만 보면 배치로 대상을 고를 수 있어 너무 강함). 여러 개면 낮은 등급부터 쓴다
//  - 혼돈의 주사위·동전: 보드의 몬스터 하나를 무작위로 변이 (동전처럼 대상 등급 상한이 있으면 그 이하만).
//    여러 개면 대상 범위가 좁은 것부터 쓴다 (넓은 것은 아껴 둔다)
export function applyOneShotTrinkets(s: RunState): string[] {
  if (s.phase !== 'shop' && s.phase !== 'unitGrowth') return [];
  const msgs: string[] = [];
  // 일괄 변이(황금 지휘봉): 보드의 몬스터 전부 (제외 목록 빼고). 바꿀 몬스터가 없으면 보관
  for (let guard = 0; guard < 20; guard++) {
    const baton = s.trinkets.map((id) => TRINKET_MAP[id]).find((t) => t?.passive?.transmuteAll);
    if (!baton) break;
    const except = baton.passive?.transmuteExcept ?? [];
    const targets = s.board.filter(canTransmute).filter((u) => !except.includes(u.defId));
    if (targets.length === 0) break;
    removeOneTrinket(s, baton.id);
    const changed = targets.map((u) => transmute(s, u)).filter((x): x is string => !!x);
    msgs.push(`${baton.name}: 보드의 ${changed.length}명이 새로운 모습으로! (${changed.join(', ')})`);
  }
  // 변이를 먼저: 진화의 돌로 Lv2가 된 유닛도 변이 대상이 될 수 있게 하면 순서에 따라 결과가 달라지므로 고정
  for (let guard = 0; guard < 50; guard++) {
    const limit = (t: (typeof TRINKETS)[number]) => t.passive?.transmuteMaxGrade ?? MAX_GRADE;
    const dice = [...new Set(s.trinkets)].map((id) => TRINKET_MAP[id]).filter((t) => t?.passive?.transmute).sort((a, b) => limit(a) - limit(b));
    let die: (typeof TRINKETS)[number] | undefined;
    let targets: OwnedUnit[] = [];
    for (const t of dice) {
      targets = s.board.filter(canTransmute).filter((u) => (MONSTER_MAP[u.defId]?.grade ?? 99) <= limit(t));
      if (targets.length) {
        die = t;
        break;
      }
    }
    if (!die) break;
    const u = withRng(s, (rng) => rng.pick(targets));
    const what = transmute(s, u);
    removeOneTrinket(s, die.id);
    if (what) msgs.push(`${die.name}: ${what}!`);
  }
  for (;;) {
    const stones = [...new Set(s.trinkets)]
      .map((id) => TRINKET_MAP[id])
      .filter((t) => t?.passive?.upgradeOnBoard)
      .sort((a, b) => a.grade - b.grade);
    let used = false;
    for (const t of stones) {
      const targets = [...s.board, ...s.bench].filter((u): u is OwnedUnit => !!u && !u.leader && u.level === 1 && (MONSTER_MAP[u.defId]?.grade ?? 99) <= t.grade);
      if (targets.length === 0) continue;
      const u = withRng(s, (rng) => rng.pick(targets));
      removeOneTrinket(s, t.id);
      levelUp(s, u);
      msgs.push(`${t.name}: ${MONSTER_MAP[u.defId].name} Lv2!`);
      used = true;
      break;
    }
    if (!used) break;
  }
  if (msgs.length) {
    msgs.push(...mergeAll(s));
    enterChoicePhase(s);
  }
  return msgs;
}

// 이벤트로 받은 몬스터: 벤치 빈 칸에 Lv1로 (같은 몬스터가 모이면 합성). 벤치가 가득 차면 그 몬스터 가격만큼 골드
export function giftMonster(s: RunState, defId: string): string {
  const def = MONSTER_MAP[defId];
  if (!def) return '';
  const at = s.bench.findIndex((u) => !u);
  if (at < 0) {
    const gold = BALANCE.economy.monsterCost[def.grade - 1] ?? 0;
    s.gold += gold;
    return `이벤트: ${def.name}을(를) 받을 자리가 없어 ${gold}골드로 받았습니다.`;
  }
  s.bench[at] = { uid: s.nextUid++, defId, level: 1 };
  if (def.grade === ORIGIN_GRADE) noteOrigin(s, defId);
  const merged = mergeAll(s);
  enterChoicePhase(s);
  return [`이벤트: ${def.name}(${GRADE_NAMES[def.grade]})이(가) 합류했습니다!`, ...merged].join(' ');
}

// 각성의 두루마리 계열: 다음에 사는 몬스터(장신구 등급 이하)를 Lv2로. 맞는 것 중 가장 낮은 등급을 쓴다
function takeNextBuyScroll(s: RunState, monsterGrade: number): string | null {
  const scroll = [...new Set(s.trinkets)]
    .map((id) => TRINKET_MAP[id])
    .filter((t) => t?.passive?.upgradeNextBuy && t.grade >= monsterGrade)
    .sort((a, b) => a.grade - b.grade)[0];
  if (!scroll) return null;
  removeOneTrinket(s, scroll.id);
  return scroll.name;
}

export function buy(s: RunState, shopIdx: number): OpResult {
  const item = s.shop[shopIdx];
  if (!item) return fail('빈 칸입니다.');
  const cost = itemCost(item);
  if (s.gold < cost) return fail(`골드가 부족합니다. (필요 ${cost})`);
  if (item.kind === 'trinket') {
    s.gold -= cost;
    s.trinkets.push(item.defId);
    if (TRINKET_MAP[item.defId].grade === ORIGIN_GRADE) noteOrigin(s, item.defId, true);
    s.shop[shopIdx] = null;
    const n = s.trinkets.filter((x) => x === item.defId).length;
    const used = applyOneShotTrinkets(s);
    return ok([`장신구 ${TRINKET_MAP[item.defId].name} 획득.${n > 1 ? ` (x${n} 중첩)` : ''}`, ...used].join(' '));
  }
  const unit: OwnedUnit = { uid: s.nextUid++, defId: item.defId, level: 1 };
  const free = s.bench.findIndex((x) => x === null);
  const extra: string[] = [];
  if (free >= 0) {
    s.bench[free] = unit;
    // 벤치에 새로 들어오는 경우에만 두루마리를 쓴다 (꽉 찬 벤치에서 바로 합성되는 경우는 쓰지 않음)
    const scroll = takeNextBuyScroll(s, MONSTER_MAP[item.defId].grade);
    if (scroll) {
      levelUp(s, unit);
      extra.push(`${scroll}: Lv2로 들어옴!`);
    }
  } else {
    // 벤치가 가득 차도 바로 합성되면 살 수 있다.
    const copies = allLocs(s).filter((l) => {
      const u = getAt(s, l);
      return u && !u.leader && u.defId === item.defId && u.level === 1;
    });
    if (copies.length < BALANCE.unit.mergeCount - 1) return fail('벤치가 가득 찼습니다.');
    const keep = getAt(s, copies[0])!;
    const gone = getAt(s, copies[copies.length - 1])!;
    const bonus = mergeBonus([keep.bonus, gone.bonus]); // 새로 산 1장은 강화가 없다
    if (bonus) keep.bonus = bonus;
    addGrowth(keep, gone.growth ?? []);
    setAt(s, copies[copies.length - 1], null);
    levelUp(s, keep);
  }
  s.gold -= cost;
  s.shop[shopIdx] = null;
  const origin = MONSTER_MAP[item.defId].grade === ORIGIN_GRADE;
  if (!s.seenMonsters?.includes(item.defId)) {
    s.seenMonsters = [...(s.seenMonsters ?? []), item.defId];
    if (!origin) voice(s, item.defId, 'buy'); // 기원은 아래 알림이 처음 구매 대사까지 보여 준다
  }
  if (origin) noteOrigin(s, item.defId);
  const merged = mergeAll(s);
  enterChoicePhase(s);
  const used = applyOneShotTrinkets(s); // 보관 중인 일회성 장신구는 조건이 맞는 순간 발동
  return ok([`${MONSTER_MAP[item.defId].name} 구매.`, ...extra, ...merged, ...used].join(' '));
}

export function sell(s: RunState, loc: Loc): OpResult {
  const u = getAt(s, loc);
  if (!u) return fail('빈 칸입니다.');
  if (u.leader) return fail('리더는 판매할 수 없습니다.');
  if (loc.area === 'board' && unitDeploy(u) > 0) {
    setAt(s, loc, null);
    const over = deployedCount(s) > deployLimit(s);
    setAt(s, loc, u);
    if (over) return fail(`${MONSTER_MAP[u.defId].name}을(를) 팔면 배치 인원 제한(${deployLimit(s) - unitDeploy(u)})을 넘습니다. 먼저 보드 유닛을 벤치로 옮기세요.`);
  }
  const price = sellPrice(u);
  setAt(s, loc, null);
  s.gold += price;
  return ok(`${MONSTER_MAP[u.defId].name} Lv${u.level} 판매 (+${price}G).`);
}

export function move(s: RunState, from: Loc, to: Loc): OpResult {
  const a = getAt(s, from);
  const b = getAt(s, to);
  if (!a) return fail('옮길 유닛이 없습니다.');
  if (from.area === to.area && from.index === to.index) return fail('같은 위치입니다.');
  if ((a.leader && to.area === 'bench') || (b?.leader && from.area === 'bench')) return fail('리더는 벤치로 갈 수 없습니다.');
  // 옮긴 뒤의 배치 인원·제한으로 확인 (지휘자처럼 통솔력이 있는 유닛은 보드에 올리면 제한이 늘고, 내리면 줄어든다)
  setAt(s, from, b);
  setAt(s, to, a);
  if (deployedCount(s) > deployLimit(s)) {
    const limit = deployLimit(s);
    setAt(s, from, a);
    setAt(s, to, b);
    return fail(`배치 인원 제한(${limit})을 넘습니다.`);
  }
  // 혼돈의 주사위처럼 보드가 대상인 보관 장신구는 보드에 올라오면 발동할 수 있다
  const used = applyOneShotTrinkets(s);
  return ok(['이동했습니다.', ...used].join(' '));
}

export function reroll(s: RunState): OpResult {
  const cost = BALANCE.economy.rerollCost;
  if (s.gold < cost) return fail('골드가 부족합니다.');
  s.gold -= cost;
  withRng(s, (rng) => rollShop(s, rng));
  s.shopLocked = false; // 리롤하면 잠금도 풀린다
  return ok(`리롤 (-${cost}G).`);
}
