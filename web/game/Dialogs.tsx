// 리더 선택, 성장·보상·연장 선택, 장신구 목록, 런 종료 화면.

import { BALANCE } from '../../src/config/balance.ts';
import { findUnitGrowth } from '../../src/data/growth.ts';
import { findGrowth, LEADER_MAP, LEADERS } from '../../src/data/leaders.ts';
import { MONSTER_MAP } from '../../src/data/monsters.ts';
import { trinketCounts } from '../../src/game/state.ts';
import { TRINKET_MAP } from '../../src/data/trinkets.ts';
import { ENV_NAMES } from '../../src/data/types.ts';
import type { Profile } from '../../src/game/profile.ts';
import { topCombos } from '../../src/game/profile.ts';
import type { RunState } from '../../src/game/state.ts';
import { NODE_NAMES } from '../../src/ui/render.ts';
import { Card, growthCard, leaderCard, monsterCard, trinketCard } from '../components/Card.tsx';
import { Modal } from '../components/Modal.tsx';

export function LeaderSelect({ profile, recordCount, generating, onStart, onGenerate }: {
  profile: Profile;
  recordCount: number;
  generating: boolean;
  onStart: (leaderId: string) => void;
  onGenerate: () => void;
}) {
  return (
    <div className="leader-select">
      <h2>리더를 고르세요</h2>
      <p className="muted">리더는 상점에서 구할 수 없고, 전투 3회마다 레벨업하며 성장을 고릅니다.</p>
      <div className="card-row">
        {LEADERS.map((l) => {
          const r = profile.leaders[l.id];
          return (
            <div key={l.id} className="leader-pick">
              <Card data={leaderCard(l)} size="lg" onClick={() => onStart(l.id)} />
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
              <button className="btn primary" onClick={() => onStart(l.id)}>{l.name}로 시작</button>
            </div>
          );
        })}
      </div>
      <div className="panel record-pool">
        <div>
          <strong>PvP 기록 풀: {recordCount}개</strong>
          <p className="muted">상대는 같은 일차에 같은 환경을 고른 플레이어 기록에서 뽑습니다. 기록이 없으면 시드 봇과 싸웁니다.</p>
        </div>
        <button className="btn" disabled={generating} onClick={onGenerate}>
          {generating ? '생성 중...' : '봇 기록 150판 생성'}
        </button>
      </div>
    </div>
  );
}

export function GrowthModal({ run, onPick }: { run: RunState; onPick: (i: number) => void }) {
  return (
    <Modal title={`리더 Lv${run.leaderLevel}! 성장을 하나 고르세요`}>
      <div className="card-row">
        {run.growthChoices.map((id, i) => {
          const g = findGrowth(run.leaderId, id);
          return g ? <Card key={id} data={growthCard(g, LEADER_MAP[run.leaderId]?.triggers)} size="md" onClick={() => onPick(i)} /> : null;
        })}
      </div>
    </Modal>
  );
}

// 합성으로 레벨이 오른 몬스터의 성장 선택
export function UnitGrowthModal({ run, onPick }: { run: RunState; onPick: (i: number) => void }) {
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
          <p className="muted">같은 장신구는 가진 개수만큼 효과가 중첩됩니다.</p>
          <div className="card-row wrap">
            {trinketCounts(ids).map(([id, n]) => (TRINKET_MAP[id] ? <Card key={id} data={trinketCard(TRINKET_MAP[id], n)} size="md" /> : null))}
          </div>
        </>
      )}
    </Modal>
  );
}

const END_TEXT: Record<string, string> = {
  champion: '우승!',
  eliminated: '탈락',
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
