import { LEADER_MAP } from '../../src/data/leaders.ts';
import { MONSTER_MAP } from '../../src/data/monsters.ts';
import type { BoardEntry, TeamSnapshot } from '../../src/battle/types.ts';
import type { OwnedUnit, RunState } from '../../src/game/state.ts';
import type { CardData } from '../components/Card.tsx';
import { leaderCard, monsterCard } from '../components/Card.tsx';

const missing = (id: string): CardData => ({ kind: 'monster', name: id, grade: 1, desc: '현재 데이터에 없는 유닛입니다.' });

export function ownedCard(u: OwnedUnit, run: Pick<RunState, 'leaderLevel' | 'growth'>): CardData {
  if (u.leader) return LEADER_MAP[u.defId] ? leaderCard(LEADER_MAP[u.defId], run.leaderLevel, run.growth, u.bonus) : missing(u.defId);
  return MONSTER_MAP[u.defId] ? monsterCard(MONSTER_MAP[u.defId], u.level, u.growth, u.bonus, u.form) : missing(u.defId);
}

export function entryCard(e: BoardEntry, team: TeamSnapshot): CardData {
  if (e.kind === 'leader') return LEADER_MAP[e.defId] ? leaderCard(LEADER_MAP[e.defId], e.level, team.growth, e.bonus) : missing(e.defId);
  return MONSTER_MAP[e.defId] ? monsterCard(MONSTER_MAP[e.defId], e.level, e.growth, e.bonus, e.form) : missing(e.defId);
}
