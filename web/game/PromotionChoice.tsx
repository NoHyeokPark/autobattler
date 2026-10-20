// 리더 전직 선택 (Lv3 분기점). 리더 선택 화면과 함께 서사를 전하는 순간이라 전체 화면으로 연출한다.
// 길마다 세로로 긴 일러스트 패널: 처음에는 모습·이름·대사만, 누르면 펼쳐져 이야기와 효과, 보드 태그 일치가 보인다.
// 펼친 패널의 버튼(또는 Enter)으로 확정한다. 한 번뿐인 선택이라 한 번 눌러 바로 고르지 않게 두 단계로.

import { useEffect, useState } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { tagChangeText } from '../../src/data/describe.ts';
import { findGrowth, LEADER_MAP, leaderVoice } from '../../src/data/leaders.ts';
import type { GrowthDef, LeaderDef } from '../../src/data/types.ts';
import type { RunState } from '../../src/game/state.ts';
import { boardTagCounts } from '../../src/game/view.ts';
import { resolveArt, useArtVersion } from '../lib/art.ts';
import { promoText } from './LeaderIntro.tsx';

const CHOSEN_MS = 650; // 고른 길만 남기고 나머지가 물러나는 연출 시간

export function PromotionChoice({ run, onPick }: { run: RunState; onPick: (i: number) => void }) {
  const leader = LEADER_MAP[run.leaderId];
  if (!leader) return null;
  const paths = run.growthChoices.map((id) => findGrowth(run.leaderId, id)).filter((g): g is GrowthDef => !!g);
  return (
    <PromotionStage
      leader={leader} level={run.leaderLevel} quote={leaderVoice(run.leaderId, run.growth).quote}
      paths={paths} counts={boardTagCounts(run.board)} onPick={onPick}
    />
  );
}

// 에디터 미리보기: 저장 전 초안 그대로 (본질 강화를 맨 앞에, 보드 태그 없이)
export function PromotionPreview({ leader, onClose }: { leader: LeaderDef; onClose: () => void }) {
  const paths = [...(leader.promotions ?? [])].sort((a, b) => Number(!!b.mastery) - Number(!!a.mastery));
  const level = BALANCE.leader.promotionLevels[0] ?? 3;
  return <PromotionStage leader={leader} level={level} quote={leader.quote} paths={paths} counts={new Map()} onPick={onClose} onClose={onClose} />;
}

// 길의 태그 (보드 일치 수 계산용): 본질 강화는 리더 원래 태그, 변신은 새로 얻는 태그
const tagsOf = (leader: LeaderDef, g: GrowthDef) => (g.mastery && !g.transform ? leader.tags : g.addTags ?? []);

function PromotionStage({ leader, level, quote, paths, counts, onPick, onClose }: {
  leader: LeaderDef;
  level: number;
  quote?: string;
  paths: GrowthDef[];
  counts: Map<string, number>; // 보드 태그별 장수
  onPick: (i: number) => void;
  onClose?: () => void; // 미리보기면 닫을 수 있다
}) {
  useArtVersion();
  const [open, setOpen] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const tally = [...counts].sort((a, b) => b[1] - a[1]);
  const baseTags = leader.tags ?? [];

  const confirm = (i: number) => {
    if (chosen !== null) return;
    setChosen(i);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => onPick(i), still ? 0 : CHOSEN_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (chosen !== null) return;
      const n = paths.length;
      if (e.key === 'ArrowRight') setOpen((o) => (o === null ? 0 : (o + 1) % n));
      else if (e.key === 'ArrowLeft') setOpen((o) => (o === null ? n - 1 : (o - 1 + n) % n));
      else if (e.key === 'Escape') {
        if (open === null) onClose?.();
        else setOpen(null);
      } else if (e.key === 'Enter' && open !== null) confirm(open);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  return (
    <div className={`promo-back ${chosen !== null ? 'deciding' : ''}`} role="dialog" aria-label={`${leader.name} 전직 선택`}>
      <header className="promo-head">
        <div className="promo-kicker">{onClose ? '미리보기 · ' : ''}리더 Lv{level} · 전직 · 단 한 번의 선택</div>
        <h2 className="promo-title">{leader.name}의 갈림길</h2>
        {quote && <blockquote className="promo-voice">“{quote}”</blockquote>}
        <div className="promo-tally">
          보드 태그{' '}
          {tally.length
            ? tally.map(([t, n]) => <span key={t} className="promo-chip">{t} {n}</span>)
            : <span className="promo-dim">{onClose ? '(미리보기에서는 없음)' : '보드에 몬스터가 없음'}</span>}
        </div>
        {onClose && <button className="btn ghost promo-close" onClick={onClose}>미리보기 닫기</button>}
      </header>

      <div className="promo-paths">
        {paths.map((g, i) => {
          // 이 길의 모습: 외형 변화 전직이면 그 형태 일러스트, 따로 없으면 지금 모습의 실루엣
          const art = resolveArt({ kind: 'leaders', id: leader.id, level, form: g.form ? g.id : undefined });
          const ownArt = !!art && art.key.endsWith(`.${g.id}`);
          const match = tagsOf(leader, g).reduce((n, t) => n + (counts.get(t) ?? 0), 0);
          const kind = g.mastery ? `본질 강화 · ${baseTags.join('·')} 유지` : `변신 · ${tagChangeText(g)}`;
          const line = g.lines?.promote?.trim() || g.quote?.trim();
          const isOpen = open === i;
          const cls = ['promo-path', g.mastery && 'mastery', isOpen && 'open', chosen === i && 'chosen', chosen !== null && chosen !== i && 'gone'];
          return (
            <section
              key={g.id} className={cls.filter(Boolean).join(' ')} style={{ animationDelay: `${0.08 * i}s` }}
              onClick={() => chosen === null && setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <div className={`promo-art ${ownArt ? '' : 'unknown'}`}>
                {art ? <img src={art.url} alt={g.name} /> : <div className="promo-art-empty">{g.name.slice(0, 1)}</div>}
                {!ownArt && <span className="promo-art-q">?</span>}
              </div>
              <div className="promo-veil">
                <div className="promo-kind">{kind}</div>
                <h3 className="promo-name">{g.name}</h3>
                {line && <p className="promo-line">“{line}”</p>}
                {isOpen ? (
                  <div className="promo-more" onClick={(e) => e.stopPropagation()}>
                    {g.lore?.trim() && <div className="promo-lore">{g.lore.split(/\n\s*\n/).map((p, k) => <p key={k}>{p}</p>)}</div>}
                    <div className="promo-effect">{promoText(g, baseTags)}</div>
                    <div className="promo-match">보드에서 이 길과 맞는 몬스터 <strong>{match}</strong>장</div>
                    <button className="btn primary promo-go" onClick={() => confirm(i)}>{onClose ? '이 길을 걷는다 (미리보기)' : '이 길을 걷는다'}</button>
                  </div>
                ) : (
                  <div className="promo-hint">눌러서 이야기 보기 · 보드 {match}장</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className="promo-foot">← → 살펴보기 · Enter 선택 · {onClose ? 'Esc 닫기' : '한 번 고르면 되돌릴 수 없습니다'}</div>
    </div>
  );
}
