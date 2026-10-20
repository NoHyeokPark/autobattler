// 리더 선택, 성장·보상·연장 선택, 장신구 목록, 런 종료 화면.

import { useState } from 'react';
import type { MouseEvent } from 'react';
import { activeModName } from '../../src/data/activeMod.ts';
import { BALANCE } from '../../src/config/balance.ts';
import { describeGrowth, tagChangeText } from '../../src/data/describe.ts';
import { findUnitGrowth } from '../../src/data/growth.ts';
import { findGrowth, isPromotion, LEADER_MAP, leaderPath, LEADERS, leaderVoice } from '../../src/data/leaders.ts';
import { MONSTER_MAP } from '../../src/data/monsters.ts';
import { isOneShot } from '../../src/data/trinkets.ts';
import { livesLeft, trinketCounts } from '../../src/game/state.ts';
import { TRINKET_MAP } from '../../src/data/trinkets.ts';
import { ENV_NAMES, LEADER_STAT_NAMES } from '../../src/data/types.ts';
import type { LeaderStat } from '../../src/data/types.ts';
import { campfireOptionText, choiceBlock, describeChoice } from '../../src/game/events.ts';
import type { Profile } from '../../src/game/profile.ts';
import { topCombos } from '../../src/game/profile.ts';
import type { RunState, VoiceEvent } from '../../src/game/state.ts';
import { NODE_NAMES } from '../../src/ui/render.ts';
import { Card, growthCard, leaderCard, monsterCard, trinketCard } from '../components/Card.tsx';
import { Modal } from '../components/Modal.tsx';
import { LeaderIntro } from './LeaderIntro.tsx';
import { PromotionChoice } from './PromotionChoice.tsx';

export function LeaderSelect({ profile, recordCount, generating, onStart, onGenerate }: {
  profile: Profile;
  recordCount: number;
  generating: boolean;
  onStart: (leaderId: string) => void;
  onGenerate: () => void;
}) {
  // 소개 화면: 누른 리더 순번과 카드 위치 (그 자리에서 커지듯 열린다)
  const [intro, setIntro] = useState<{ index: number; origin: { x: number; y: number } | null } | null>(null);
  const open = (index: number) => (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setIntro({ index, origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
  };
  return (
    <div className="leader-select">
      <h2>리더를 고르세요</h2>
      <p className="muted">리더를 누르면 자세한 소개가 열립니다. 리더는 상점에서 구할 수 없고, 정해진 날마다 레벨업하며 성장을 고릅니다.</p>
      {intro && (
        <LeaderIntro
          leaders={LEADERS} index={intro.index} origin={intro.origin} profile={profile}
          onIndex={(index) => setIntro({ index, origin: null })} onStart={onStart} onClose={() => setIntro(null)}
        />
      )}
      <div className="card-row">
        {LEADERS.map((l, i) => {
          const r = profile.leaders[l.id];
          return (
            <div key={l.id} className="leader-pick">
              <div className="leader-card-hit" onClick={open(i)}>
                <Card data={leaderCard(l)} size="lg" onClick={() => {}} />
              </div>
              {l.title && <div className="leader-title">{l.title}</div>}
              <div className="leader-record">
                {r ? (
                  <>
                    <div>{r.runs}판 · 우승 {r.championships} · 최고 {r.bestWins}승</div>
                    <div>누적 점수 {r.totalScore}</div>
                    {topCombos(r, 1).map(([k, n]) => <div key={k} className="muted small">자주 쓴 조합({n}): {k}</div>)}
                  </>
                ) : (
                  <span className="muted">기록 없음</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="panel record-pool">
        <div>
          <strong>PvP 기록 풀: {recordCount}개</strong> <span className="muted small">(적용 중인 모드 "{activeModName()}" 기준)</span>
          <p className="muted">상대는 같은 일차에 같은 환경을 고른 플레이어 기록에서 뽑습니다. 기록이 없으면 시드 봇과 싸웁니다.</p>
        </div>
        <button className="btn" disabled={generating} onClick={onGenerate}>
          {generating ? '생성 중...' : '봇 기록 150판 생성'}
        </button>
      </div>
    </div>
  );
}

// 성장 선택지 다시 뽑기 버튼 (증강 리롤처럼 선택마다 정해진 횟수)
function RerollButton({ left, onReroll }: { left: number; onReroll: () => void }) {
  return (
    <div className="center reroll-row">
      <button className="btn" disabled={left <= 0} onClick={onReroll} title="지금 보이는 것과 다른 성장을 우선으로 다시 뽑습니다">
        선택지 다시 뽑기 {left > 0 ? `(${left}회 남음)` : '(사용함)'}
      </button>
    </div>
  );
}

export function GrowthModal({ run, onPick, onReroll }: { run: RunState; onPick: (i: number) => void; onReroll: () => void }) {
  const growths = run.growthChoices.map((id) => findGrowth(run.leaderId, id));
  if (growths.length > 0 && run.growthChoices.every((id) => isPromotion(run.leaderId, id))) return <PromotionChoice run={run} onPick={onPick} />;
  return (
    <Modal title={`리더 Lv${run.leaderLevel}! 성장을 하나 고르세요`}>
      <div className="card-row">
        {run.growthChoices.map((id, i) => {
          const g = findGrowth(run.leaderId, id);
          return g ? <Card key={id} data={growthCard(g, LEADER_MAP[run.leaderId]?.triggers)} size="md" onClick={() => onPick(i)} /> : null;
        })}
      </div>
      {BALANCE.leader.growthRerolls > 0 && <RerollButton left={run.growthRerolls ?? 0} onReroll={onReroll} />}
    </Modal>
  );
}

// 합성으로 레벨이 오른 몬스터의 성장 선택
export function UnitGrowthModal({ run, onPick, onReroll }: { run: RunState; onPick: (i: number) => void; onReroll: () => void }) {
  const p = run.unitGrowth[0];
  const u = [...run.board, ...run.bench].find((x) => x?.uid === p.uid);
  const def = u ? MONSTER_MAP[u.defId] : undefined;
  return (
    <Modal title={u && u.level > p.level
      ? `${def?.name ?? '몬스터'} Lv${p.level} 성장 선택 (바로 Lv${u.level}로 합성됨)`
      : `${def?.name ?? '몬스터'} Lv${p.level}! 성장을 하나 고르세요`}>
      <div className="growth-pick">
        {u && def && <Card data={monsterCard(def, u.level, u.growth)} size="md" />}
        <div className="card-row wrap">
          {p.choices.map((id, i) => {
            const g = findUnitGrowth(def?.id ?? '', id);
            if (!g) return null;
            const own = def?.growth?.some((x) => x.id === id);
            return (
              <Card
                key={id}
                data={growthCard(g, def?.triggers)}
                size="md"
                onClick={() => onPick(i)}
                footer={<div className="card-owned">{own ? `${def?.name} 전용` : '공용 성장'}</div>}
              />
            );
          })}
        </div>
      </div>
      {BALANCE.unit.growthRerolls > 0 && <RerollButton left={p.rerolls ?? 0} onReroll={onReroll} />}
      {run.unitGrowth.length > 1 && <p className="muted">남은 선택 {run.unitGrowth.length - 1}개</p>}
    </Modal>
  );
}

// Lv3 합성 때 재료들의 외형이 달랐으면 어느 외형으로 진화할지 고른다
export function FormChoiceModal({ run, onPick }: { run: RunState; onPick: (i: number) => void }) {
  const p = run.formChoices![0];
  const u = [...run.board, ...run.bench].find((x) => x?.uid === p.uid);
  const def = u ? MONSTER_MAP[u.defId] : undefined;
  if (!u || !def) return null;
  return (
    <Modal title={`${def.name} Lv${u.level} 진화! 어느 모습으로 진화할까요?`}>
      <p className="muted">합성한 유닛들의 모습이 달라서 고를 수 있습니다. 능력(성장)은 모두 그대로 가지며, 일러스트만 바뀝니다.</p>
      <div className="card-row wrap">
        {p.options.map((form, i) => (
          <Card
            key={form || 'base'}
            data={monsterCard(def, u.level, u.growth, u.bonus, form || undefined)}
            size="md"
            onClick={() => onPick(i)}
            footer={<div className="card-owned">{form ? `${findUnitGrowth(def.id, form)?.name ?? form} 형태` : '기본 형태'}</div>}
          />
        ))}
      </div>
    </Modal>
  );
}

export function RewardModal({ run, onPick }: { run: RunState; onPick: (choice: number | 'gold') => void }) {
  const stage = run.rewards[0];
  if (stage.kind === 'event' && stage.event) {
    const ev = stage.event;
    return (
      <Modal title={`이벤트: ${ev.name}`}>
        <p className="event-text">{ev.text}</p>
        <div className="event-choices">
          {ev.choices.map((c, i) => {
            const block = choiceBlock(run, c);
            return (
              <button key={i} className="event-choice" disabled={!!block} onClick={() => onPick(i)}>
                <strong>{c.text}</strong>
                <span className="muted small">{describeChoice(c)}{block ? ` · ${block}` : ''}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }
  if (stage.kind === 'campfire') {
    const lives = livesLeft(run);
    return (
      <Modal title="모닥불">
        <p className="muted">쉬어서 라이프를 얻거나, 리더를 단련해 능력치 하나를 영구히 올립니다. (지금 라이프 {lives})</p>
        <div className="event-choices">
          {stage.options.map((opt, i) => (
            <button key={opt} className={`event-choice ${opt === 'rest' ? 'rest' : ''}`} onClick={() => onPick(i)}>
              <strong>{opt === 'rest' ? '휴식' : `단련: ${LEADER_STAT_NAMES[opt as LeaderStat]}`}</strong>
              <span className="muted small">{campfireOptionText(opt)}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  if (stage.kind === 'monster') {
    const have = (id: string) => [...run.board, ...run.bench].filter((u) => u?.defId === id).length;
    return (
      <Modal title={stage.label}>
        <p className="muted">데려갈 몬스터 하나를 고르거나, 받지 않고 골드로 바꿀 수 있습니다. 고른 몬스터는 다음 날 벤치에 합류합니다 (벤치가 가득 차면 골드).</p>
        <div className="card-row">
          {stage.options.map((id, i) => (
            <Card
              key={id}
              data={monsterCard(MONSTER_MAP[id])}
              size="md"
              onClick={() => onPick(i)}
              footer={have(id) > 0 ? <div className="card-owned">보유 {have(id)}마리</div> : undefined}
            />
          ))}
          <button className="gold-choice" onClick={() => onPick('gold')}>
            <strong>{stage.gold}G</strong>
            <span>골드로 받기</span>
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={stage.label}>
      <p className="muted">장신구 하나를 고르거나, 받지 않고 골드로 바꿀 수 있습니다. 장신구는 판매할 수 없습니다.</p>
      <div className="card-row">
        {stage.options.map((id, i) => {
          const owned = run.trinkets.filter((x) => x === id).length;
          return (
            <Card
              key={id}
              data={trinketCard(TRINKET_MAP[id])}
              size="md"
              onClick={() => onPick(i)}
              footer={owned > 0 ? <div className="card-owned">보유 x{owned} → x{owned + 1}</div> : undefined}
            />
          );
        })}
        <button className="gold-choice" onClick={() => onPick('gold')}>
          <strong>{stage.gold}G</strong>
          <span>골드로 받기</span>
        </button>
      </div>
    </Modal>
  );
}

export function ExtendModal({ onPick }: { onPick: (extend: boolean) => void }) {
  const bonus = BALANCE.rank.extensionBonus;
  return (
    <Modal title={`${BALANCE.run.winTarget}승 달성! 우승`}>
      <p>연장하면 매일 상점 단계에서 "여기서 멈추기"를 누를 수 있고, 1패하면 {BALANCE.rank.extensionLossScore}점으로 끝납니다.</p>
      <p className="muted">연장 승리 보너스: {bonus.slice(1).map((b, i) => `${i + 1}승 +${b}`).join(', ')}</p>
      <div className="row-buttons">
        <button className="btn primary" onClick={() => onPick(true)}>연장 도전</button>
        <button className="btn" onClick={() => onPick(false)}>우승 확정 (+{BALANCE.rank.championScore})</button>
      </div>
    </Modal>
  );
}

export function TrinketsModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  return (
    <Modal title={`배낭 · 장신구 ${ids.length}개`} onClose={onClose} wide>
      {ids.length === 0 ? <p className="muted">보유한 장신구가 없습니다.</p> : (
        <>
          {([false, true] as const).map((oneShot) => {
            const group = trinketCounts(ids).filter(([id]) => TRINKET_MAP[id] && isOneShot(TRINKET_MAP[id]) === oneShot);
            if (group.length === 0) return null;
            return (
              <section key={String(oneShot)} className="bag-section">
                <h3>{oneShot ? '일회성' : '지속'} <span className="muted small">{oneShot
                  ? '조건이 맞는 순간 발동하고 사라집니다. 대상이 없으면 여기서 기다립니다.'
                  : '가지고 있는 동안 계속 효과가 있고, 같은 장신구는 개수만큼 중첩됩니다.'}</span></h3>
                <div className="card-row wrap">
                  {group.map(([id, n]) => <Card key={id} data={trinketCard(TRINKET_MAP[id], n)} size="md" />)}
                </div>
              </section>
            );
          })}
        </>
      )}
    </Modal>
  );
}

const END_TEXT: Record<string, string> = {
  champion: '우승!',
  eliminated: '탈락',
  outOfDays: '기한 종료',
  extensionStop: '연장 중 멈춤',
  extensionLost: '연장 패배',
  extensionDone: '연장 완주',
};

export function EndScreen({ run, profile, onNew }: { run: RunState; profile: Profile; onNew: () => void }) {
  const end = run.end!;
  const r = profile.leaders[run.leaderId];
  return (
    <div className="end-screen panel">
      <h2>{END_TEXT[end.reason]} · {run.wins}승 {run.losses}패</h2>
      <p className="score">랭크 점수 {end.score >= 0 ? '+' : ''}{end.score}</p>
      <table className="table">
        <thead><tr><th>일차</th><th>결과</th><th>노드</th><th>환경</th><th>시간</th><th>상대</th><th>매칭</th><th>전투 후 획득</th></tr></thead>
        <tbody>
          {run.log.map((l) => (
            <tr key={l.day}>
              <td>{l.day}</td>
              <td className={l.win ? 'win' : 'lose'}>{l.win ? '승' : '패'}</td>
              <td>{NODE_NAMES[l.node.kind]}</td>
              <td>{ENV_NAMES[l.node.env]}</td>
              <td>{l.seconds.toFixed(1)}s</td>
              <td>{l.opponent}</td>
              <td className="muted">{l.matchStage}</td>
              <td>{l.gains ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r && (
        <p className="muted">
          {LEADER_MAP[run.leaderId]?.name} 기록: {r.runs}판 · 우승 {r.championships} · 최고 {r.bestWins}승 · 누적 점수 {r.totalScore}
        </p>
      )}
      <button className="btn primary" onClick={onNew}>새 런 시작</button>
    </div>
  );
}

// 전직 직후 연출: 새 모습(일러스트)과 이름, 전직 대사. 누르면 닫힌다
export function PromotionReveal({ leaderId, level, growth, onClose }: { leaderId: string; level: number; growth: string[]; onClose: () => void }) {
  const def = LEADER_MAP[leaderId];
  const path = leaderPath(leaderId, growth);
  if (!def || !path) return null;
  const card = leaderCard(def, level, growth);
  const say = path.lines?.promote?.trim() || leaderVoice(leaderId, growth).quote;
  return (
    <div className="reveal-back" onClick={onClose}>
      <div className="reveal">
        <Card data={card} size="lg" />
        <div className="reveal-text">
          <div className="muted small">{def.name} · {path.mastery ? '본질 강화' : '변신'}</div>
          <h2>{path.name}</h2>
          {say && <blockquote className="intro-quote">“{say}”</blockquote>}
          <div className="muted small">눌러서 계속</div>
        </div>
      </div>
    </div>
  );
}

// 기원 등급 획득 알림: 몬스터 대사 자리의 작은 알림이지만 기원답게 검은 바탕에 빛이 한 번 스친다 (리더 전직보다는 가볍게)
function OriginNote({ v, onClose }: { v: VoiceEvent; onClose: () => void }) {
  const t = v.trinket ? TRINKET_MAP[v.defId] : undefined;
  const m = v.trinket ? undefined : MONSTER_MAP[v.defId];
  if (!t && !m) return null;
  const line = m ? m.lines?.buy?.trim() || m.lines?.detail?.trim() : undefined;
  return (
    <div className="monster-speech origin-note" onClick={onClose} key={`origin-${v.defId}`}>
      <Card data={t ? trinketCard(t) : monsterCard(m!)} size="sm" />
      <div className="monster-speech-text">
        <div className="small origin-head">기원 등급 {t ? '장신구' : '몬스터'} 획득</div>
        <div className="origin-name">{t?.name ?? m!.name}</div>
        {line ? <div className="monster-speech-line">“{line}”</div> : t && <div className="small origin-desc">{t.desc}</div>}
      </div>
    </div>
  );
}

// 몬스터 전직 알림: 몬스터 대사와 같은 자리의 작은 알림 (리더 전직 연출보다 가볍게). 대사가 없으면 "A → B"만
function MonsterPromoteNote({ v, onClose }: { v: VoiceEvent; onClose: () => void }) {
  const def = MONSTER_MAP[v.defId]!;
  const g = def.promotions?.find((p) => p.id === v.promoId);
  const line = g?.quote?.trim() || def.lines?.maxLevel?.trim();
  return (
    <div className="monster-speech promote" onClick={onClose} key={`promote-${v.promoId}`}>
      <Card data={monsterCard(def, BALANCE.unit.maxLevel, v.growth ?? [], undefined, v.form)} size="sm" />
      <div className="monster-speech-text">
        <div className="small promote-head">Lv{BALANCE.unit.maxLevel} 전직 · {v.from} → <strong>{g?.name ?? def.name}</strong></div>
        {line && <div className="monster-speech-line">“{line}”</div>}
      </div>
    </div>
  );
}

// 몬스터 전직 선택 (길이 여럿일 때): 일반 성장 선택과 같은 크기의 모달. 전직 모습·바뀌는 것·대사를 카드로
export function UnitPromotionModal({ run, onPick }: { run: RunState; onPick: (i: number) => void }) {
  const p = run.unitPromotions![0];
  const u = [...run.board, ...run.bench].find((x) => x?.uid === p.uid);
  const def = u ? MONSTER_MAP[u.defId] : undefined;
  if (!u || !def) return null;
  return (
    <Modal title={`${def.name} Lv${u.level}! 전직할 길을 고르세요`}>
      <p className="muted">최고 레벨이 되면 반드시 전직합니다. 고른 길로 이름과 모습이 바뀌고, 지금 가진 성장은 그대로 유지됩니다.</p>
      <div className="card-row wrap">
        {p.choices.map((id, i) => {
          const g = def.promotions?.find((x) => x.id === id);
          if (!g) return null;
          const tags = tagChangeText(g);
          return (
            <div key={id} className="promo-pick">
              <Card data={monsterCard(def, u.level, [...(u.growth ?? []), id], u.bonus, g.form ? id : undefined)} size="md" onClick={() => onPick(i)} />
              <div className="small promo-pick-desc">{tags && <strong>{tags} · </strong>}{g.desc?.trim() || describeGrowth(g, def.triggers)}</div>
              {g.quote && <div className="promo-quote">“{g.quote}”</div>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// 몬스터 대사 (처음 구매·최고 레벨): 화면 아래에 카드와 말풍선. 누르거나 잠시 뒤 사라진다
export function MonsterSpeech({ v, onClose }: { v: VoiceEvent; onClose: () => void }) {
  const def = MONSTER_MAP[v.defId];
  if (v.kind === 'promote') return def ? <MonsterPromoteNote v={v} onClose={onClose} /> : null;
  if (v.kind === 'origin') return <OriginNote v={v} onClose={onClose} />;
  const line = def?.lines?.[v.kind];
  if (!def || !line) return null;
  return (
    <div className="monster-speech" onClick={onClose} key={`${v.defId}-${v.kind}`}>
      <Card data={monsterCard(def, v.kind === 'maxLevel' ? 3 : 1)} size="sm" />
      <div className="monster-speech-text">
        <div className="muted small">{def.name}{v.kind === 'maxLevel' ? ' · Lv3 달성' : ' · 합류'}</div>
        <div className="monster-speech-line">“{line}”</div>
      </div>
    </div>
  );
}
