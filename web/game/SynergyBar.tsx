// 보드 위 태그 시너지 (TFT 특성 막대처럼). 태그별로 지금 수와 단계, 마우스를 올리면 단계별 효과.
// 같은 몬스터는 1명으로 세고, 리더 태그도 센다 (전투 엔진과 같은 규칙: synergyStates).

import { describeTriggers } from '../../src/data/describe.ts';
import { LEADER_MAP } from '../../src/data/leaders.ts';
import { MONSTER_MAP } from '../../src/data/monsters.ts';
import { synergyStates } from '../../src/data/synergies.ts';
import type { RunState } from '../../src/game/state.ts';
import { leaderView, monsterView } from '../../src/game/view.ts';

export function SynergyBar({ run }: { run: RunState }) {
  const units = run.board.flatMap((u) => {
    if (!u) return [];
    if (u.leader) {
      const def = LEADER_MAP[u.defId];
      return def ? [{ id: u.defId, tags: leaderView(def, run.leaderLevel, run.growth).tags }] : [];
    }
    const def = MONSTER_MAP[u.defId];
    return def ? [{ id: u.defId, tags: monsterView(def, u.level, u.growth).tags }] : [];
  });
  const states = synergyStates(units);
  if (states.length === 0) return null;
  return (
    <div className="synergy-bar">
      {states.map(({ syn, count, tier }) => (
        <span key={syn.tag} className={`synergy-chip has-tip ${tier >= 0 ? 'on' : ''}`} tabIndex={0}>
          <strong>{syn.name?.trim() || syn.tag}</strong>
          <span className="synergy-steps">
            {syn.tiers.map((t, i) => <span key={i} className={i === tier ? 'cur' : count >= t.count ? 'met' : ''}>{t.count}</span>)}
          </span>
          <span className="synergy-count">{count}</span>
          <span className="tip synergy-tip" role="tooltip">
            <span className="synergy-tip-head">{syn.tag} 시너지 · 보드 {count}명 (같은 몬스터는 1명)</span>
            {syn.tiers.map((t, i) => (
              <span key={i} className={`synergy-tier ${i === tier ? 'cur' : ''}`}>
                <b>{t.count}명</b> {t.desc?.trim() || describeTriggers(t.triggers, undefined, true)}
              </span>
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}
