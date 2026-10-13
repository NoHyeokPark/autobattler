// 능력 대상(UnitFilter)을 짧게 적는 도우미와, 예전 형식(scope) 데이터 변환.

import type { Dir, Tag, UnitFilter } from './types.ts';

const ADJ: Dir[] = ['u', 'd', 'l', 'r'];
const AROUND: Dir[] = ['ul', 'u', 'ur', 'l', 'r', 'dl', 'd', 'dr'];
const withTag = (f: UnitFilter, tag?: Tag): UnitFilter => (tag ? { ...f, tag } : f);

export const T = {
  self: (): UnitFilter => ({ side: 'ally', area: 'near', dirs: ['c'] }),
  adjacent: (tag?: Tag) => withTag({ side: 'ally', area: 'near', dirs: [...ADJ] }, tag),
  around: (tag?: Tag) => withTag({ side: 'ally', area: 'near', dirs: [...AROUND] }, tag),
  ally: (dirs: Dir[], tag?: Tag) => withTag({ side: 'ally', area: 'near', dirs }, tag),
  allies: (tag?: Tag) => withTag({ side: 'ally', area: 'all' }, tag),
  mirror: (): UnitFilter => ({ side: 'enemy', area: 'near', dirs: ['c'] }),
  enemy: (dirs: Dir[], tag?: Tag) => withTag({ side: 'enemy', area: 'near', dirs }, tag),
  enemies: (tag?: Tag) => withTag({ side: 'enemy', area: 'all' }, tag),
};

// v0.1 형식 { scope: 'self' | 'adjacent' | 'allies' | 'enemies' | 'mirror', sameRow? } → 새 형식
export function migrateFilter(f: Record<string, unknown>): UnitFilter {
  if (!('scope' in f)) return f as unknown as UnitFilter;
  const { scope, sameRow, ...rest } = f as { scope: string; sameRow?: boolean } & Record<string, unknown>;
  const base: Record<string, UnitFilter> = {
    self: T.self(),
    adjacent: T.adjacent(),
    allies: T.allies(),
    enemies: T.enemies(),
    mirror: T.mirror(),
  };
  const out = { ...(base[scope] ?? T.self()), ...rest } as UnitFilter;
  if (sameRow) {
    out.area = 'sameRow';
    delete out.dirs;
  }
  return out;
}
