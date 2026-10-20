// 유닛 상세 보기. 상점(선택한 유닛)과 전투 화면(가운데 칸)이 같은 화면을 쓴다.
// 카드에는 한눈에 볼 것만 두고, 능력 전체·성장 설명·영구 강화 내역은 여기서 본다.
// 기본 = 레벨·성장·영구 강화를 합친 전투 전 능력치 (카드 값).
// 전투 중이면 옆에 이번 전투에서만 붙은 변화(칸 효과·환경 + 전투 중 버프)를 +x로 보여 주고, 마우스를 올리면 둘을 나눠 보여 준다.

import type { ReactNode } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import type { Scale, StatMods } from '../../src/data/types.ts';
import type { UnitStats, UnitSummary } from '../../src/battle/types.ts';
import { describeGrowth, statModsText } from '../../src/data/describe.ts';
import { findUnitGrowth, monsterPromotion } from '../../src/data/growth.ts';
import { findGrowth } from '../../src/data/leaders.ts';
import { MONSTER_MAP } from '../../src/data/monsters.ts';
import { GRADE_NAMES } from '../../src/data/types.ts';
import type { GrowthDef } from '../../src/data/types.ts';
import { entryBaseStats, entryComputed } from '../../src/game/view.ts';
import { AbilityText } from '../components/AbilityText.tsx';
import type { CardData } from '../components/Card.tsx';
import { StatIcon } from '../components/StatIcons.tsx';
import type { StatKind } from '../components/StatIcons.tsx';
import { resolveArt, useArtVersion } from '../lib/art.ts';
import type { LiveUnit } from './frames.ts';

const TPS = BALANCE.ticksPerSec;
const sec = (ticks: number) => `${+(ticks / TPS).toFixed(2)}초`;

// 같은 id를 묶어 [항목, 횟수]로 (처음 나온 순서 유지)
export function countIds(ids: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return [...m.entries()];
}

type StatKey = keyof UnitStats;

interface RowSpec {
  key: StatKey;
  label: string;
  icon?: StatKind;
  fmt: (v: number) => string;
  lowerIsBetter?: boolean;
  hideIfZero?: boolean;
  hideIf100?: boolean;
}

const ROWS: RowSpec[] = [
  { key: 'hp', label: '체력', icon: 'hp', fmt: String },
  { key: 'atk', label: '공격력', icon: 'atk', fmt: String },
  { key: 'power', label: '주문력', icon: 'power', fmt: String, hideIfZero: true },
  { key: 'interval', label: '행동 간격', icon: 'interval', fmt: sec, lowerIsBetter: true },
  { key: 'haste', label: '가속', fmt: (v) => `${v > 0 ? '+' : ''}${v}`, hideIfZero: true },
  { key: 'extra', label: '추가발동', icon: 'extra', fmt: String },
  { key: 'healShieldPct', label: '회복·실드 배율', fmt: (v) => `${v}%`, hideIf100: true },
];

function deltaText(d: number, key: StatKey) {
  if (key === 'interval') return `${d > 0 ? '+' : '-'}${sec(Math.abs(d))}`;
  if (key === 'healShieldPct') return `${d > 0 ? '+' : ''}${d}%p`;
  return `${d > 0 ? '+' : ''}${d}`;
}

function StatRow({ spec, base, init, now }: { spec: RowSpec; base: number; init?: number; now?: number }) {
  const cur = now ?? base;
  if (spec.hideIfZero && !base && !cur) return null;
  if (spec.hideIf100 && base === 100 && cur === 100) return null;
  const label = <th>{spec.icon && <StatIcon kind={spec.icon} />} {spec.label}</th>;
  if (now === undefined || init === undefined) {
    return <tr>{label}<td className="num">{spec.fmt(base)}</td></tr>;
  }
  const d = now - base;
  const fromSlot = init - base;
  const fromBattle = now - init;
  const good = spec.lowerIsBetter ? d < 0 : d > 0;
  const parts = [
    fromSlot ? `칸·환경 ${deltaText(fromSlot, spec.key)}` : '',
    fromBattle ? `전투 중 효과 ${deltaText(fromBattle, spec.key)}` : '',
  ].filter(Boolean);
  return (
    <tr>
      {label}
      <td className="num">{spec.fmt(base)}</td>
      <td>{d !== 0 && <span className={`delta ${good ? 'up' : 'down'}`} title={parts.join('\n')}>{deltaText(d, spec.key)}</span>}</td>
      <td className="muted small">{d !== 0 && (parts.length > 1 ? parts.join(' · ') : fromSlot ? '칸·환경' : '전투 중 효과')}</td>
    </tr>
  );
}

export interface DetailUnit {
  kind: 'leader' | 'monster';
  defId: string;
  level: number;
  growth?: string[]; // 몬스터 성장 (리더는 leaderGrowth)
  bonus?: StatMods;
}

export function UnitDetail({ unit, leaderGrowth, card, place, sideName, battle, gold, children }: {
  unit: DetailUnit;
  leaderGrowth: string[];
  card: CardData;
  place: string; // "2행 3열", "벤치" 등
  sideName?: string;
  // 전투 중이면 이번 전투 변화·기록을 함께 보여 준다. source = 팀 상태·유닛 수 같은 비례 출처의 지금 값
  battle?: { summary: UnitSummary; live: LiveUnit; t: number; source?: (sc: Scale) => number | undefined };
  gold?: number; // 내 골드 ("골드만큼" 비례 계산용)
  children?: ReactNode; // 판매 버튼 같은 동작
}) {
  useArtVersion();
  const isLeader = unit.kind === 'leader';
  const growthIds = isLeader ? leaderGrowth : unit.growth ?? [];
  const promos = isLeader ? [] : MONSTER_MAP[unit.defId]?.promotions ?? [];
  const promoted = isLeader ? undefined : monsterPromotion(unit.defId, growthIds);
  const growth = countIds(growthIds.filter((id) => !promos.some((p) => p.id === id))).map(([id, n]): [GrowthDef | undefined, string, number] => [
    isLeader ? findGrowth(unit.defId, id) : findUnitGrowth(unit.defId, id), id, n,
  ]);
  const baseTriggers = isLeader ? undefined : MONSTER_MAP[unit.defId]?.triggers;
  const bonus = statModsText(unit.bonus);
  const base = battle?.summary.base ?? entryBaseStats(unit, leaderGrowth);
  const live = battle?.live;
  const now: UnitStats | undefined = battle && live
    ? { ...battle.summary.init, hp: live.hp, atk: live.atk, power: live.power, interval: live.interval, haste: live.haste, extra: live.extra }
    : undefined;
  const stunLeft = live && battle ? live.stunUntil - battle.t : 0;
  const artUrl = resolveArt(card.artRef)?.url ?? card.art;
  const computed = entryComputed(unit, leaderGrowth);
  // 손으로 쓴 설명은 능력이 그대로일 때만 맛글로 위에 보여 준다 (능력 자체는 아래 계산된 설명)
  const flavor = computed && !computed.c.changedAbilities ? computed.def.desc?.trim() : undefined;
  const quote = !isLeader ? MONSTER_MAP[unit.defId]?.lines?.detail?.trim() : undefined; // 몬스터 상세 보기 대사

  const section = (title: string, body: ReactNode) => (
    <div className="detail-section">
      <h4>{title}</h4>
      {body}
    </div>
  );

  return (
    <div className="unit-detail">
      <div className="detail-top">
        {artUrl && <img className="detail-art" src={artUrl} alt={card.name} />}
        <div className="detail-title">
          <div className="detail-head">
            <strong>{card.name}</strong>
            <span className="card-lv">Lv{unit.level}</span>
          </div>
          <div className="muted small">
            {[sideName, isLeader ? '리더' : GRADE_NAMES[card.grade ?? 1], place].filter(Boolean).join(' · ')}
          </div>
          {card.tags?.length ? <div className="small">태그: {card.tags.join(', ')}</div> : null}
          {card.deploy ? <div className="small detail-deploy">보드에 있으면 배치 인원 +{card.deploy} (자기 자리를 스스로 채움)</div> : null}
          {quote && <div className="detail-quote">“{quote}”</div>}
          {stunLeft > 0 && <div className="detail-stun">기절 중 ({sec(stunLeft)} 남음)</div>}
          {children && <div className="detail-actions">{children}</div>}
        </div>
      </div>

      {base && (
        <table className="detail-stats">
          {now && (
            <thead>
              <tr><th /><th className="num">기본</th><th>이번 전투</th><th /></tr>
            </thead>
          )}
          <tbody>
            {ROWS.map((spec) => (
              <StatRow key={spec.key} spec={spec} base={base[spec.key]} init={battle?.summary.init[spec.key]} now={now?.[spec.key]} />
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        기본 = 레벨·성장·영구 강화를 합친 값{now ? '. 이번 전투 = 칸 효과·환경·버프로 이 전투에서만 붙은 변화' : ' (칸 효과는 전투에서 따로 붙음)'}.
      </p>

      {live && section('이번 전투 기록', (
        <div className="detail-record">
          <span>행동 <strong>{live.acts}</strong>회</span>
          <span>피해 <strong>{live.damage}</strong></span>
          {live.heal > 0 && <span>회복 <strong>{live.heal}</strong></span>}
          {live.shield > 0 && <span>실드 <strong>{live.shield}</strong></span>}
        </div>
      ))}

      {section('능력', computed ? (
        <div className="small">
          {flavor && <p className="detail-flavor">{flavor}</p>}
          <AbilityText
            block triggers={computed.c.triggers} extra={computed.c.extra}
            stats={{
              atk: now?.atk ?? computed.c.atk, power: now?.power ?? computed.c.power, hp: now?.hp ?? computed.c.hp, level: unit.level,
              healShieldPct: battle?.summary.init.healShieldPct ?? computed.c.healShieldPct,
              haste: now?.haste ?? computed.c.haste, extra: now?.extra ?? computed.c.extra, acts: live?.acts, gold, source: battle?.source,
            }}
          />
        </div>
      ) : <div className="small pre">{card.desc}</div>)}

      {section(isLeader ? '리더 성장' : '성장', growth.length === 0 ? <div className="muted small">없음</div> : (
        <ul className="detail-growth">
          {growth.map(([g, id, n]) => (
            <li key={id}>
              <strong>{g?.name ?? id}</strong>
              {n > 1 && <span className="growth-count">x{n}</span>}
              <div className="muted small">{g ? (g.desc?.trim() || describeGrowth(g, baseTriggers)) : '현재 데이터에 없는 성장'}</div>
            </li>
          ))}
        </ul>
      ))}

      {promoted && section('전직', (
        <div className="small">
          <strong>{promoted.name}</strong> <span className="muted">({MONSTER_MAP[unit.defId]?.name}에서 전직)</span>
          <div className="muted">{promoted.desc?.trim() || describeGrowth(promoted, baseTriggers)}</div>
        </div>
      ))}
      {!promoted && promos.length > 0 && section(`Lv${BALANCE.unit.maxLevel} 전직 (${promos.length > 1 ? '하나를 골라 ' : ''}반드시)`, (
        <ul className="detail-growth">
          {promos.map((g) => (
            <li key={g.id}>
              <strong>{g.name}</strong>
              <div className="muted small">{g.desc?.trim() || describeGrowth(g, baseTriggers)}</div>
            </li>
          ))}
        </ul>
      ))}

      {bonus && section('영구 강화 (기본에 포함)', <div className="small">{bonus}</div>)}
    </div>
  );
}

// 장신구 상세 (상점에서 마우스를 올렸을 때). 장신구는 효과 글이 전부라 그대로 다 보여 준다
export function TrinketDetail({ card, note }: { card: CardData; note?: ReactNode }) {
  useArtVersion();
  const artUrl = resolveArt(card.artRef)?.url ?? card.art;
  return (
    <div className="unit-detail">
      <div className="detail-top">
        {artUrl && <img className="detail-art" src={artUrl} alt={card.name} />}
        <div className="detail-title">
          <div className="detail-head"><strong>{card.name}</strong>{(card.count ?? 0) > 1 && <span className="card-lv">보유 x{card.count}</span>}</div>
          <div className="muted small">{GRADE_NAMES[card.grade ?? 1]} 장신구 · {card.oneShot ? '일회성 (쓰면 사라짐)' : '지속'}</div>
          {note && <div className="detail-actions">{note}</div>}
        </div>
      </div>
      <div className="detail-section">
        <h4>효과</h4>
        <div className="small pre">{card.desc}</div>
      </div>
    </div>
  );
}
