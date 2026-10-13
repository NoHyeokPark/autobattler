import { BALANCE } from '../config/balance.ts';
import { Rng } from '../core/rng.ts';
import { findUnitGrowth, mergeBonus, rollUnitGrowth } from '../data/growth.ts';
import { MONSTER_MAP, MONSTERS } from '../data/monsters.ts';
import { TRINKET_MAP, TRINKETS } from '../data/trinkets.ts';
import type { OwnedUnit, RunState, ShopItem } from './state.ts';
import { deployedCount, deployLimit, shopLevel } from './state.ts';

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

// 장신구 하나를 뽑는다. 이미 가진 장신구도 다시 나올 수 있다(중첩).
// exclude는 같은 진열(상점 한 번, 보상 선택지 한 번) 안에서 겹치지 않게 할 때만 쓴다.
// 해당 등급에 남은 게 없으면 낮은 등급으로 내려간다.
export function rollTrinket(rng: Rng, grade: number, exclude: Set<string>, allowOrigin = false): string | null {
  for (let g = grade; g >= 1; g--) {
    if (g === 6 && !allowOrigin) continue;
    const pool = TRINKETS.filter((t) => t.grade === g && !exclude.has(t.id));
    if (pool.length > 0) return rng.pick(pool).id;
  }
  return null;
}

export function rollShop(s: RunState, rng: Rng) {
  const row = oddsRow(s.day, shopLevel(s));
  const items: ShopItem[] = [];
  const exclude = new Set<string>();
  let trinkets = 0;
  for (let i = 0; i < BALANCE.shop.slots; i++) {
    const grade = rollGrade(rng, row);
    if (trinkets < BALANCE.shop.maxTrinkets && rng.chancePct(BALANCE.shop.trinketChancePct)) {
      const id = rollTrinket(rng, Math.min(grade, 5), exclude);
      if (id) {
        exclude.add(id);
        trinkets++;
        items.push({ kind: 'trinket', defId: id });
        continue;
      }
    }
    const pool = MONSTERS.filter((m) => m.grade === grade);
    items.push({ kind: 'monster', defId: rng.pick(pool.length ? pool : MONSTERS.filter((m) => m.grade === 1)).id });
  }
  s.shop = items;
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
function levelUp(s: RunState, u: OwnedUnit) {
  u.level++;
  if (!BALANCE.unit.growthChoiceLevels.includes(u.level)) return;
  const choices = withRng(s, (rng) => rollUnitGrowth(u.defId, u.growth ?? [], rng));
  if (choices.length > 0) (s.unitGrowth ??= []).push({ uid: u.uid, level: u.level, choices });
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
    if (options.length > 1) s.formChoices.push({ uid: keep.uid, options });
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

// 선택 대기열(성장·외형)이 모두 비면 상점 단계로 돌아간다
function settlePhase(s: RunState) {
  if (s.phase === 'unitGrowth' && (s.unitGrowth?.length ?? 0) === 0 && (s.formChoices?.length ?? 0) === 0) s.phase = 'shop';
}

// 합성 레벨업 성장 선택. 외형 변화 성장이면 일러스트 형태도 바뀐다.
export function chooseUnitGrowth(s: RunState, idx: number): OpResult {
  const pending = s.unitGrowth?.[0];
  const id = pending?.choices[idx];
  if (!pending || !id) return fail('고를 수 없는 선택지입니다.');
  const u = findUnit(s, pending.uid);
  s.unitGrowth.shift();
  const g = findUnitGrowth(u?.defId ?? '', id);
  if (u) {
    addGrowth(u, [id]);
    if (g?.form) {
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

export function buy(s: RunState, shopIdx: number): OpResult {
  const item = s.shop[shopIdx];
  if (!item) return fail('빈 칸입니다.');
  const cost = itemCost(item);
  if (s.gold < cost) return fail(`골드가 부족합니다. (필요 ${cost})`);
  if (item.kind === 'trinket') {
    s.gold -= cost;
    s.trinkets.push(item.defId);
    s.shop[shopIdx] = null;
    const n = s.trinkets.filter((x) => x === item.defId).length;
    return ok(`장신구 ${TRINKET_MAP[item.defId].name} 획득.${n > 1 ? ` (x${n} 중첩)` : ''}`);
  }
  const unit: OwnedUnit = { uid: s.nextUid++, defId: item.defId, level: 1 };
  const free = s.bench.findIndex((x) => x === null);
  if (free >= 0) {
    s.bench[free] = unit;
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
  const merged = mergeAll(s);
  if ((s.unitGrowth?.length || s.formChoices?.length) && s.phase === 'shop') s.phase = 'unitGrowth';
  return ok([`${MONSTER_MAP[item.defId].name} 구매.`, ...merged].join(' '));
}

export function sell(s: RunState, loc: Loc): OpResult {
  const u = getAt(s, loc);
  if (!u) return fail('빈 칸입니다.');
  if (u.leader) return fail('리더는 판매할 수 없습니다.');
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
  const delta = (to.area === 'board' ? 1 : 0) - (from.area === 'board' ? 1 : 0) + (b ? (from.area === 'board' ? 1 : 0) - (to.area === 'board' ? 1 : 0) : 0);
  if (deployedCount(s) + delta > deployLimit(s)) return fail(`배치 인원 제한(${deployLimit(s)})을 넘습니다.`);
  setAt(s, from, b);
  setAt(s, to, a);
  return ok('이동했습니다.');
}

export function reroll(s: RunState): OpResult {
  const cost = BALANCE.economy.rerollCost;
  if (s.gold < cost) return fail('골드가 부족합니다.');
  s.gold -= cost;
  withRng(s, (rng) => rollShop(s, rng));
  return ok(`리롤 (-${cost}G).`);
}
