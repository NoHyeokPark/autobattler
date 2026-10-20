// 게임 화면 컨테이너: 런 상태를 들고 단계(성장·상점·전투·보상·연장·종료)에 맞는 화면을 띄운다.
// 런 상태는 게임 로직 함수가 제자리에서 바꾸므로, 바꾼 뒤 저장하고 다시 그린다.

import { useEffect, useReducer, useRef, useState } from 'react';
import { modRecordCount } from '../../src/game/matching.ts';
import { hashSeed } from '../../src/core/rng.ts';
import { runIssues } from '../../src/data/validate.ts';
import { playBattle } from '../../src/game/day.ts';
import type { DayBattle } from '../../src/game/day.ts';
import { recordRunEnd } from '../../src/game/profile.ts';
import { beginDay, chooseExtend, chooseGrowth, chooseReward, rerollGrowth } from '../../src/game/run.ts';
import { chooseForm, choosePromotion, chooseUnitGrowth, rerollUnitGrowth } from '../../src/game/shop.ts';
import type { OpResult } from '../../src/game/shop.ts';
import { createRun } from '../../src/game/state.ts';
import type { RunState, VoiceEvent } from '../../src/game/state.ts';
import { runLeague } from '../../src/sim/league.ts';
import { clearRun, loadPref, loadProfile, loadRecords, loadRun, onSavesChanged, savePref, saveProfile, saveRecords, saveRun } from '../lib/persist.ts';
import { BattleView } from './BattleView.tsx';
import { EndScreen, ExtendModal, FormChoiceModal, GrowthModal, LeaderSelect, MonsterSpeech, PromotionReveal, RewardModal, TrinketsModal, UnitGrowthModal, UnitPromotionModal } from './Dialogs.tsx';
import { isPromotion } from '../../src/data/leaders.ts';
import { ShopPhase } from './ShopPhase.tsx';

export function GameView({ dataVersion }: { dataVersion: number }) {
  const [run, setRun] = useState<RunState | null>(() => loadRun());
  const store = useRef(loadRecords());
  const profile = useRef(loadProfile());
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [battle, setBattle] = useState<DayBattle | null>(null);
  const [speed, setSpeedState] = useState(() => loadPref('speed', '3'));
  const [toast, setToast] = useState<OpResult | null>(null);
  const [speech, setSpeech] = useState<VoiceEvent[]>([]); // 몬스터 대사 (처음 구매·최고 레벨)
  const [reveal, setReveal] = useState<{ leaderId: string; level: number; growth: string[] } | null>(null); // 전직 연출
  const [showTrinkets, setShowTrinkets] = useState(false);
  const [generating, setGenerating] = useState(false);

  // 모드가 바뀌면 기록 풀을 다시 읽는다 (재현 불가 기록은 걸러진다).
  useEffect(() => {
    store.current = loadRecords();
    force();
  }, [dataVersion]);

  // 에디터에서 플레이 데이터를 지우면 들고 있던 것을 버리고 다시 읽는다
  useEffect(() => onSavesChanged(() => {
    store.current = loadRecords();
    profile.current = loadProfile();
    setRun((cur) => (cur && !loadRun() ? null : cur));
    setBattle(null);
    force();
  }), []);

  // 전투 화면 ↔ 상점 화면 전환 시 맨 위로
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [battle]);

  useEffect(() => {
    if (speech.length === 0) return;
    const id = setTimeout(() => setSpeech((q) => q.slice(1)), speech[0].kind === 'origin' || speech[0].kind === 'promote' ? 5000 : 3500);
    return () => clearTimeout(id);
  }, [speech]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const setSpeed = (s: string) => {
    setSpeedState(s);
    savePref('speed', s);
  };

  // 런이 끝났으면 리더 기록에 반영 (한 번만 반영된다)
  const recordIfEnded = (s: RunState) => {
    if (s.end && !s.profileRecorded) {
      recordRunEnd(profile.current, s);
      saveProfile(profile.current);
    }
  };

  const commit = (r?: OpResult) => {
    // 게임 로직이 남긴 몬스터 대사를 가져와 차례로 보여 준다 (저장 전에 비워서 다시 불러와도 또 나오지 않게)
    if (run?.voices?.length) {
      const v = run.voices;
      delete run.voices;
      setSpeech((q) => [...q, ...v].slice(-4));
    }
    // 하루 시작에 일어난 일 (황금 지휘봉 발동 등)은 결과 메시지 뒤에 붙인다
    const notices = run?.notices?.length ? run.notices : [];
    if (run?.notices) delete run.notices;
    if (run) {
      recordIfEnded(run); // 연장 멈추기·우승 확정처럼 전투 밖에서 끝나는 경우
      saveRun(run);
    }
    if (r || notices.length) setToast({ ok: r?.ok ?? true, msg: [r?.msg, ...notices].filter(Boolean).join(' ') });
    force();
  };

  const start = (leaderId: string) => {
    const seed = hashSeed(Date.now(), Math.random());
    const s = createRun(leaderId, seed, `web-${Date.now().toString(36)}-${(seed >>> 0).toString(36)}`);
    beginDay(s);
    saveRun(s);
    setBattle(null);
    setRun(s);
  };

  const generate = () => {
    setGenerating(true);
    setTimeout(() => {
      runLeague(store.current, 150, hashSeed('web-league', Date.now()));
      saveRecords(store.current);
      setGenerating(false);
      setToast({ ok: true, msg: `기록 풀 ${modRecordCount(store.current)}개 (이 모드)` });
    }, 30);
  };

  const newRun = () => {
    if (run && run.phase !== 'ended' && !confirm('진행 중인 런을 포기하고 새로 시작할까요?')) return;
    clearRun();
    setBattle(null);
    setRun(null);
  };

  if (!run) {
    return (
      <>
        <LeaderSelect profile={profile.current} recordCount={modRecordCount(store.current)} generating={generating} onStart={start} onGenerate={generate} />
        {toast && <div className={`toast ${toast.ok ? '' : 'bad'}`}>{toast.msg}</div>}
      </>
    );
  }

  if (battle) {
    return <BattleView battle={battle} speed={speed} onSpeed={setSpeed} onDone={() => { setBattle(null); commit(); }} />;
  }

  if (run.phase === 'ended') {
    return <EndScreen run={run} profile={profile.current} onNew={newRun} />;
  }

  const issues = runIssues(run);
  const go = () => {
    const b = playBattle(run, store.current);
    saveRecords(store.current);
    recordIfEnded(run);
    saveRun(run);
    setBattle(b);
  };

  return (
    <>
      {issues.length > 0 && (
        <div className="banner bad">
          에디터에서 바뀐 데이터와 이 런이 맞지 않습니다 (없어진 항목: {issues.join(', ')}). 새 런을 시작하세요.
          <button className="btn" onClick={newRun}>새 런</button>
        </div>
      )}
      <ShopPhase run={run} disabled={issues.length > 0 || run.phase !== 'shop'} onCommit={commit} onGo={go} onShowTrinkets={() => setShowTrinkets(true)} onNewRun={newRun} />
      {run.phase === 'growth' && <GrowthModal run={run} onPick={(i) => {
        const id = run.growthChoices[i];
        const r = chooseGrowth(run, i);
        if (r.ok && id && isPromotion(run.leaderId, id)) setReveal({ leaderId: run.leaderId, level: run.leaderLevel, growth: [...run.growth] });
        commit(r);
      }} onReroll={() => commit(rerollGrowth(run))} />}
      {reveal && <PromotionReveal {...reveal} onClose={() => setReveal(null)} />}
      {run.phase === 'unitGrowth' && run.unitGrowth.length > 0 && <UnitGrowthModal run={run} onPick={(i) => commit(chooseUnitGrowth(run, i))} onReroll={() => commit(rerollUnitGrowth(run))} />}
      {run.phase === 'unitGrowth' && run.unitGrowth.length === 0 && (run.formChoices?.length ?? 0) > 0 && (
        <FormChoiceModal run={run} onPick={(i) => commit(chooseForm(run, i))} />
      )}
      {run.phase === 'unitGrowth' && run.unitGrowth.length === 0 && !run.formChoices?.length && (run.unitPromotions?.length ?? 0) > 0 && (
        <UnitPromotionModal run={run} onPick={(i) => commit(choosePromotion(run, i))} />
      )}
      {run.phase === 'reward' && <RewardModal run={run} onPick={(c) => commit(chooseReward(run, c))} />}
      {run.phase === 'extendChoice' && <ExtendModal onPick={(x) => commit(chooseExtend(run, x))} />}
      {showTrinkets && <TrinketsModal ids={run.trinkets} onClose={() => setShowTrinkets(false)} />}
      {toast && <div className={`toast ${toast.ok ? '' : 'bad'}`}>{toast.msg}</div>}
      {speech[0] && <MonsterSpeech v={speech[0]} onClose={() => setSpeech((q) => q.slice(1))} />}
    </>
  );
}
