// 카드 컴포넌트. 아트가 없으면 등급색 프레임 안에 흰 배경 + 검은 글씨로 그린다.
// 나중에 아트를 쓰려면 데이터의 art 필드(이미지 URL)만 채우면 된다.

import type { DragEvent, ReactNode } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { describeGrowth, unitDesc } from '../../src/data/describe.ts';
import type { GrowthDef, LeaderDef, MonsterDef, StatMods, TrinketDef, Trigger } from '../../src/data/types.ts';
import { GRADE_NAMES } from '../../src/data/types.ts';
import type { ArtRef } from '../../src/data/art.ts';
import { leaderForm } from '../../src/data/leaders.ts';
import { leaderView, monsterView } from '../../src/game/view.ts';
import type { UnitView } from '../../src/game/view.ts';
import { resolveArt, useArtVersion } from '../lib/art.ts';

export type CardSize = 'sm' | 'md' | 'lg';

export interface CardData {
  kind: 'monster' | 'leader' | 'trinket' | 'growth';
  name: string;
  grade?: number;
  level?: number;
  tags?: string[];
  hp?: number;
  atk?: number;
  power?: number;
  intervalTicks?: number;
  extra?: number;
  desc: string;
  growthNames?: string[];
  bonusText?: string; // 성장 외 영구 강화
  count?: number; // 장신구 보유 개수 (x2 표시)
  artRef?: ArtRef; // art/ 폴더 파일 규칙으로 찾는 일러스트 (레벨·외형별)
  art?: string; // 예전 방식: 데이터에 직접 적은 이미지 주소 (artRef 파일이 없을 때만)
}

function fromView(v: UnitView, kind: 'monster' | 'leader', artRef: ArtRef): CardData {
  return {
    kind, name: v.name, grade: v.grade, level: v.level, tags: v.tags,
    hp: v.hp, atk: v.atk, power: v.power, intervalTicks: v.intervalTicks, extra: v.extra,
    desc: v.desc, growthNames: v.growthNames, bonusText: v.bonusText || undefined, art: v.art, artRef,
  };
}

// form: 외형 변화 성장 id (일러스트 형태)
export function monsterCard(def: MonsterDef, level = 1, growth: string[] = [], bonus?: StatMods, form?: string): CardData {
  return fromView(monsterView(def, level, growth, bonus), 'monster', { kind: 'monsters', id: def.id, level, form });
}

export function leaderCard(def: LeaderDef, level = 1, growth: string[] = [], bonus?: StatMods): CardData {
  return fromView(leaderView(def, level, growth, bonus), 'leader', { kind: 'leaders', id: def.id, level, form: leaderForm(def.id, growth) });
}

export function trinketCard(def: TrinketDef, count?: number): CardData {
  return {
    kind: 'trinket', name: def.name, grade: def.grade, count,
    desc: def.desc?.trim() ? def.desc : unitDesc({ desc: '', triggers: def.triggers }), art: def.art,
    artRef: { kind: 'trinkets', id: def.id },
  };
}

// baseTriggers: 성장이 붙는 유닛의 기본 능력 (능력 제거 설명용)
export function growthCard(g: GrowthDef, baseTriggers?: Trigger[]): CardData {
  return { kind: 'growth', name: g.name, desc: g.desc?.trim() ? g.desc : describeGrowth(g, baseTriggers) };
}

interface CardProps {
  data: CardData;
  size?: CardSize;
  cost?: number;
  atkOverride?: number; // 전투 중 현재 공격력
  powerOverride?: number; // 전투 중 현재 주문력
  selected?: boolean;
  acting?: boolean;
  disabled?: boolean;
  footer?: ReactNode;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
}

export function Card({ data, size = 'md', cost, atkOverride, powerOverride, selected, acting, disabled, footer, onClick, draggable, onDragStart }: CardProps) {
  const frame = data.kind === 'leader' ? 'leader' : data.kind === 'growth' ? 'growth' : `g${data.grade ?? 1}`;
  const kindLabel = data.kind === 'leader' ? '리더' : data.kind === 'trinket' ? '장신구' : data.kind === 'growth' ? '성장' : GRADE_NAMES[data.grade ?? 1];
  const cls = ['card', `card-${size}`, `frame-${frame}`, `kind-${data.kind}`];
  if (selected) cls.push('selected');
  if (acting) cls.push('acting');
  if (disabled) cls.push('disabled');
  if (onClick) cls.push('clickable');
  useArtVersion(); // 일러스트 목록이 바뀌면 다시 그린다
  const artUrl = resolveArt(data.artRef)?.url ?? data.art;
  const atk = atkOverride ?? data.atk;
  const power = powerOverride ?? data.power;
  const showStats = data.hp !== undefined;
  const growth = (data.growthNames?.length ? `\n성장: ${data.growthNames.join(', ')}` : '') + (data.bonusText ? `\n영구 강화: ${data.bonusText}` : '');
  return (
    <div className={cls.join(' ')} title={`${data.name}\n${data.desc}${growth}`} onClick={onClick} draggable={draggable} onDragStart={onDragStart}>
      <div className="card-inner">
        <div className="card-top">
          <span className="card-name">{data.name}</span>
          {data.level !== undefined && <span className="card-lv">Lv{data.level}</span>}
          {data.count !== undefined && data.count > 1 && <span className="card-lv">x{data.count}</span>}
        </div>
        <div className="card-kind">
          {kindLabel}
          {data.tags?.length ? ` · ${data.tags.join(' ')}` : ''}
        </div>
        {artUrl && (
          <div className="card-art">
            <img src={artUrl} alt={data.name} loading="lazy" decoding="async" />
          </div>
        )}
        {showStats && (
          <div className="card-stats">
            <span>체력 {data.hp}</span>
            <span className={atkOverride !== undefined && atkOverride !== data.atk ? 'buffed' : ''}>공격 {atk}</span>
            {!!(power || data.power) && <span className={powerOverride !== undefined && powerOverride !== data.power ? 'buffed' : ''}>주문 {power}</span>}
            <span>{((data.intervalTicks ?? 0) / BALANCE.ticksPerSec).toFixed(1)}초{data.extra ? ` +${data.extra}` : ''}</span>
          </div>
        )}
        {data.growthNames?.length ? <div className="card-growth">{data.growthNames.join(' · ')}</div> : null}
        {data.bonusText ? <div className="card-bonus">강화 {data.bonusText}</div> : null}
        <div className="card-desc">{data.desc}</div>
        {cost !== undefined && <div className="card-cost">{cost}G</div>}
        {footer}
      </div>
    </div>
  );
}
