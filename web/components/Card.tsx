// 카드 컴포넌트. 아트가 없으면 등급색 프레임 안에 흰 배경 + 검은 글씨로 그린다.
// 나중에 아트를 쓰려면 데이터의 art 필드(이미지 URL)만 채우면 된다.

import type { DragEvent, ReactNode } from 'react';
import { describeGrowth, unitDesc } from '../../src/data/describe.ts';
import type { GrowthDef, LeaderDef, MonsterDef, StatMods, TrinketDef, Trigger } from '../../src/data/types.ts';
import { GRADE_NAMES } from '../../src/data/types.ts';
import type { ArtRef } from '../../src/data/art.ts';
import { leaderForm } from '../../src/data/leaders.ts';
import { isOneShot } from '../../src/data/trinkets.ts';
import { leaderView, monsterView } from '../../src/game/view.ts';
import type { UnitView } from '../../src/game/view.ts';
import { resolveArt, useArtVersion } from '../lib/art.ts';
import { AbilityText } from './AbilityText.tsx';
import { StatLine } from './StatIcons.tsx';
import type { StatKind } from './StatIcons.tsx';

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
  ability?: UnitView['ability'] & { extra?: number }; // 자동 설명: 계산된 수치·계수로 그린다
  growthNames?: string[];
  bonusText?: string; // 성장 외 영구 강화
  deploy?: number; // 보드에 있을 때 배치 인원 +
  count?: number; // 장신구 보유 개수 (x2 표시)
  oneShot?: boolean; // 장신구 분류: 일회성(쓰면 사라짐) / 지속
  artRef?: ArtRef; // art/ 폴더 파일 규칙으로 찾는 일러스트 (레벨·외형별)
  art?: string; // 예전 방식: 데이터에 직접 적은 이미지 주소 (artRef 파일이 없을 때만)
}

// 같은 성장을 여러 번 가졌으면 "자라나는 힘 x2"처럼 묶는다
function growthList(names: string[]): string[] {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([n, c]) => (c > 1 ? `${n} x${c}` : n));
}

function fromView(v: UnitView, kind: 'monster' | 'leader', artRef: ArtRef): CardData {
  return {
    kind, name: v.name, grade: v.grade, level: v.level, tags: v.tags,
    hp: v.hp, atk: v.atk, power: v.power, intervalTicks: v.intervalTicks, extra: v.extra,
    desc: v.desc, ability: v.ability && { ...v.ability, extra: v.extra }, growthNames: v.growthNames, bonusText: v.bonusText || undefined, deploy: v.deploy, art: v.art, artRef,
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
    kind: 'trinket', name: def.name, grade: def.grade, count, oneShot: isOneShot(def),
    desc: def.desc?.trim() ? def.desc : unitDesc({ desc: '', triggers: def.triggers }, true), art: def.art,
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
  const kindLabel = data.kind === 'leader' ? '리더'
    : data.kind === 'trinket' ? `${GRADE_NAMES[data.grade ?? 1]} 장신구 · ${data.oneShot ? '일회성' : '지속'}`
    : data.kind === 'growth' ? '성장' : GRADE_NAMES[data.grade ?? 1];
  const cls = ['card', `card-${size}`, `frame-${frame}`, `kind-${data.kind}`];
  if (data.oneShot) cls.push('one-shot'); // 일회성 장신구는 점선 테두리
  if (selected) cls.push('selected');
  if (acting) cls.push('acting');
  if (disabled) cls.push('disabled');
  if (onClick) cls.push('clickable');
  useArtVersion(); // 일러스트 목록이 바뀌면 다시 그린다
  const artUrl = resolveArt(data.artRef)?.url ?? data.art;
  const atk = atkOverride ?? data.atk;
  const power = powerOverride ?? data.power;
  const showStats = data.hp !== undefined;
  const growthNames = data.growthNames?.length ? growthList(data.growthNames) : [];
  const growth = (growthNames.length ? `
성장: ${growthNames.join(', ')}` : '') + (data.bonusText ? `
영구 강화: ${data.bonusText}` : '');
  const buffed: StatKind[] = [];
  if (atkOverride !== undefined && atkOverride !== data.atk) buffed.push('atk');
  if (powerOverride !== undefined && powerOverride !== data.power) buffed.push('power');
  // 자동 설명은 계산된 수치로. 전투 중이면 지금 공격력·주문력으로 다시 계산한다
  const descNode = data.ability
    ? <AbilityText triggers={data.ability.triggers} extra={data.ability.extra} stats={{ ...data.ability.stats, atk: atk ?? data.ability.stats.atk, power: power ?? data.ability.stats.power }} />
    : data.desc;
  const stats = showStats && <StatLine hp={data.hp} atk={atk} power={power || data.power} intervalTicks={data.intervalTicks} extra={data.extra} buffed={buffed} />;
  const head = (
    <div className="card-top">
      <span className="card-name">{data.name}</span>
      {data.level !== undefined && <span className="card-lv">Lv{data.level}</span>}
      {data.count !== undefined && data.count > 1 && <span className="card-lv">x{data.count}</span>}
    </div>
  );
  const kind = <div className="card-kind">{kindLabel}{data.tags?.length ? ` · ${data.tags.join(' ')}` : ''}</div>;
  const extras = (
    <>
      {growthNames.length ? <div className="card-growth">{growthNames.join(' · ')}</div> : null}
      {data.bonusText ? <div className="card-bonus">강화 {data.bonusText}</div> : null}
      {data.deploy ? <div className="card-deploy">보드에 있으면 배치 인원 +{data.deploy}</div> : null}
    </>
  );

  // 일러스트 카드: 소 = 그림이 카드 전체 + 위(이름)·아래(능력치) 띠, 중·대 = 위쪽에 그림, 아래에 요약 정보.
  // 능력 전체·성장 설명 같은 자세한 정보는 상세 보기(UnitDetail)에서 본다.
  const art = artUrl && data.kind !== 'growth';
  if (art) cls.push('has-art');
  return (
    <div className={cls.join(' ')} title={`${data.name}
${data.deploy ? `보드에 있으면 배치 인원 +${data.deploy}
` : ''}${data.desc}${growth}`} onClick={onClick} draggable={draggable} onDragStart={onDragStart}>
      <div className="card-inner">
        {art ? (
          <>
            <div className="card-art"><img src={artUrl} alt={data.name} loading="lazy" decoding="async" /></div>
            {size === 'sm' ? (
              <>
                <div className="art-band top">{head}</div>
                {stats && <div className="art-band bottom">{stats}</div>}
                {growthNames.length > 0 && <span className="art-badge" title={`성장: ${growthNames.join(', ')}`}>성장 {data.growthNames!.length}</span>}
              </>
            ) : (
              <div className="card-body">
                {head}
                {kind}
                {stats && <div className="card-stats">{stats}</div>}
                <div className="card-desc">{descNode}</div>
                {size === 'lg' && extras}
              </div>
            )}
          </>
        ) : (
          <>
            {head}
            {kind}
            {stats && <div className="card-stats">{stats}</div>}
            {extras}
            <div className="card-desc">{descNode}</div>
          </>
        )}
        {cost !== undefined && <div className="card-cost">{cost}G</div>}
        {footer}
      </div>
    </div>
  );
}
