// 리더 소개 화면 (RPG의 직업·캐릭터 소개처럼). 리더 선택에서 카드를 누르면 그 카드에서 커지듯 열린다.
// 큰 일러스트 + 이름·칭호·대사·서사 + 시작 능력치·기본 능력·Lv3 전직 미리보기 + 내 기록.
// 좌우 화살표로 다른 리더를 넘겨 보고, Enter로 시작, Esc로 닫는다.

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { describeGrowth, tagChangeText } from '../../src/data/describe.ts';
import type { GrowthDef, LeaderDef } from '../../src/data/types.ts';
import type { Profile } from '../../src/game/profile.ts';
import { topCombos } from '../../src/game/profile.ts';
import { leaderView } from '../../src/game/view.ts';
import { leaderCard } from '../components/Card.tsx';
import { AbilityText } from '../components/AbilityText.tsx';
import { StatLine } from '../components/StatIcons.tsx';
import { resolveArt, useArtVersion } from '../lib/art.ts';

// 이름 뒤 조사 "로/으로" (받침 없거나 ㄹ 받침이면 "로")
function withRo(name: string): string {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${name}(으)로`;
  const jong = code % 28;
  return `${name}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}

// 전직 설명에서 위에 이미 보이는 머리말("[변신] 전사 → 언데드.")은 빼고 보여 준다
export function promoText(g: GrowthDef, tags: string[]): string {
  let text = (g.desc?.trim() ? g.desc : describeGrowth(g)).replace(/^\[[^\]]+\]\s*/, '');
  const head = `${g.mastery ? `${tags.join('·')} 유지` : tagChangeText(g)}.`;
  if (text.startsWith(head)) text = text.slice(head.length).trim();
  return text;
}

export function LeaderIntro({ leaders, index, origin, profile, onIndex, onStart, onClose }: {
  leaders: LeaderDef[];
  index: number;
  origin: { x: number; y: number } | null; // 누른 카드의 화면 위치 (거기서 커지듯 열린다)
  profile: Profile;
  onIndex: (i: number) => void;
  onStart?: (leaderId: string) => void; // 없으면 미리보기 (에디터)
  onClose: () => void;
}) {
  useArtVersion();
  const l = leaders[index];
  const go = (d: number) => onIndex((index + d + leaders.length) % leaders.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Enter') onStart?.(l.id);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const card = leaderCard(l);
  const view = leaderView(l);
  const artUrl = resolveArt(card.artRef)?.url ?? card.art;
  const record = profile.leaders[l.id];
  const promotions = [...(l.promotions ?? [])].sort((a, b) => Number(!!b.mastery) - Number(!!a.mastery));
  const promoLevel = BALANCE.leader.promotionLevels[0];
  const promoDay = promoLevel ? BALANCE.leader.levelUpDays[promoLevel - 2] : undefined;
  const style = origin
    ? ({ '--dx': `${origin.x - innerWidth / 2}px`, '--dy': `${origin.y - innerHeight / 2}px` } as CSSProperties)
    : undefined;

  return (
    <div className="intro-back" onClick={onClose}>
      <div className="intro" style={style} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${l.name} 소개`}>
        <div className="intro-art">
          {artUrl ? <img src={artUrl} alt={l.name} /> : <div className="intro-art-empty"><span>{l.name.slice(0, 1)}</span><small>일러스트 없음</small></div>}
          {leaders.length > 1 && (
            <div className="intro-nav">
              <button className="btn" onClick={() => go(-1)} aria-label="이전 리더">◀</button>
              <span>{index + 1} / {leaders.length}</span>
              <button className="btn" onClick={() => go(1)} aria-label="다음 리더">▶</button>
            </div>
          )}
        </div>

        <div className="intro-info" key={l.id}>
          <div className="intro-kicker">리더 · {view.tags.join(' · ')}</div>
          <h2 className="intro-name">{l.name}</h2>
          {l.title && <div className="intro-title">{l.title}</div>}
          {l.quote && <blockquote className="intro-quote">“{l.quote}”</blockquote>}
          {(l.lore ?? l.desc) && (
            <div className="intro-lore">
              {(l.lore ?? l.desc).split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}

          <div className="intro-section">
            <h4>시작 능력치</h4>
            <div className="intro-stats"><StatLine hp={view.hp} atk={view.atk} power={view.power} intervalTicks={view.intervalTicks} extra={view.extra} /></div>
          </div>
          <div className="intro-section">
            <h4>기본 능력</h4>
            <AbilityText block triggers={l.triggers} extra={l.extra} stats={{ atk: view.atk, power: view.power, hp: view.hp, level: 1 }} />
          </div>

          {promotions.length > 0 && (
            <div className="intro-section">
              <h4>전직 <span className="muted small">리더 Lv{promoLevel}{promoDay ? ` (${promoDay}일차)` : ''}에 하나를 골라 다른 존재가 됩니다</span></h4>
              <div className="intro-promos">
                {promotions.map((g) => (
                  <div key={g.id} className={`intro-promo ${g.mastery ? 'mastery' : ''}`}>
                    <div className="intro-promo-head">
                      <strong>{g.name}</strong>
                      <span className="intro-promo-kind">{g.mastery ? `본질 강화 · ${view.tags.join('·')} 유지` : tagChangeText(g)}</span>
                    </div>
                    <div className="small">{promoText(g, view.tags)}</div>
                    {(g.lines?.promote || g.quote) && <div className="promo-quote">“{g.lines?.promote || g.quote}”</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="intro-section">
            <h4>성장 <span className="muted small">레벨업({BALANCE.leader.levelUpDays.join('·')}일차)마다 이 중에서 고릅니다</span></h4>
            <div className="intro-chips">{l.growth.map((g) => <span key={g.id} className="tag-chip" title={g.desc || describeGrowth(g, l.triggers)}>{g.name}</span>)}</div>
          </div>

          <div className="intro-section">
            <h4>내 기록</h4>
            {record ? (
              <div className="small">
                {record.runs}판 · 우승 {record.championships} · 최고 {record.bestWins}승 · 누적 점수 {record.totalScore}
                {topCombos(record, 1).map(([k, n]) => <div key={k} className="muted">자주 쓴 조합({n}): {k}</div>)}
              </div>
            ) : <div className="muted small">아직 함께한 런이 없습니다.</div>}
          </div>

          <div className="intro-actions">
            {onStart && <button className="btn primary intro-start" onClick={() => onStart(l.id)}>{withRo(l.name)} 시작</button>}
            <button className="btn ghost" onClick={onClose}>{onStart ? '돌아가기' : '미리보기 닫기'}</button>
            <span className="muted small">← → 넘기기{onStart ? ' · Enter 시작' : ''} · Esc 닫기</span>
          </div>
        </div>
      </div>
    </div>
  );
}
