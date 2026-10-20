// 태그 시너지 (TFT의 특성처럼 보드에 올라간 태그 수에 따른 보조 효과). 모드에서 정의하고 기본 데이터에는 없다.
// 같은 몬스터(같은 id)는 여러 장이어도 1명으로 센다. 리더도 보드 유닛이라 리더의 태그도 센다.
// 단계는 가장 높게 도달한 것 하나만 적용된다 (단계마다 효과를 따로 적는다).

import type { Tag, TagSynergy } from './types.ts';

export const SYNERGIES: TagSynergy[] = [];

// 태그별 수 (같은 id는 한 번만)
export function tagCounts(units: { id: string; tags: Tag[] }[]): Map<Tag, number> {
  const seen = new Map<Tag, Set<string>>();
  for (const u of units) for (const t of u.tags) (seen.get(t) ?? seen.set(t, new Set()).get(t)!).add(u.id);
  return new Map([...seen].map(([t, ids]) => [t, ids.size]));
}

// 도달한 가장 높은 단계 (없으면 -1). 단계는 필요한 수가 작은 것부터
export function activeTier(s: TagSynergy, count: number): number {
  let best = -1;
  s.tiers.forEach((t, i) => {
    if (count >= t.count) best = i;
  });
  return best;
}

export interface SynergyState {
  syn: TagSynergy;
  count: number;
  tier: number; // -1 = 아직 첫 단계 전
}

// 보드에 한 명이라도 있는 태그의 시너지 상태 (발동한 것 먼저, 그다음 수가 많은 순)
export function synergyStates(units: { id: string; tags: Tag[] }[], list: TagSynergy[] = SYNERGIES): SynergyState[] {
  const counts = tagCounts(units);
  return list
    .filter((s) => s.tiers.length > 0 && (counts.get(s.tag) ?? 0) > 0)
    .map((s) => ({ syn: s, count: counts.get(s.tag) ?? 0, tier: activeTier(s, counts.get(s.tag) ?? 0) }))
    .sort((a, b) => Number(b.tier >= 0) - Number(a.tier >= 0) || b.count - a.count);
}
