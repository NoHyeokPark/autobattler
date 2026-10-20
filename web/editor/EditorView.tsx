// 기획자·모드 도구. 초안(draft)을 편집하고 "적용"하면 게임 데이터가 바뀌고 브라우저에 저장된다.

import { useMemo, useReducer, useState } from 'react';
import { activeModName, applyMod, missingDefaults, snapshotMod } from '../../src/data/registry.ts';
import type { ModData } from '../../src/data/registry.ts';
import { validateMod } from '../../src/data/validate.ts';
import { MOD_LIBRARY_DIR, modFileName } from '../../src/data/modFile.ts';
import { listLibrary, SAVE_PATHS, saveMod, storageMode, writeLibraryMod } from '../lib/persist.ts';
import { BalanceEditor } from './BalanceEditor.tsx';
import { BalanceTest } from './BalanceTest.tsx';
import { CommonGrowthEditor, EventGrowthEditor, LeaderEditor, MonsterEditor, TrinketEditor } from './EntityEditors.tsx';
import { EventEditor } from './EventEditor.tsx';
import { ModPanel } from './ModPanel.tsx';
import { PlayDataPanel } from './PlayDataPanel.tsx';
import { SynergyEditor } from './SynergyEditor.tsx';
import { Sandbox } from './Sandbox.tsx';

const TABS = [
  ['monsters', '몬스터'],
  ['growth', '공용 성장'],
  ['synergy', '시너지'],
  ['leaders', '리더'],
  ['trinkets', '장신구'],
  ['events', '이벤트'],
  ['balance', '수치'],
  ['sandbox', '테스트'],
  ['balanceTest', '밸런스 테스트'],
  ['mod', '모드'],
  ['saves', '플레이 데이터'],
] as const;
type Tab = (typeof TABS)[number][0];

export function EditorView({ onApplied }: { onApplied: () => void }) {
  const [draft, setDraft] = useState<ModData>(() => snapshotMod());
  const [ver, bump] = useReducer((x: number) => x + 1, 0);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('monsters');
  const [note, setNote] = useState('');
  const [showIssues, setShowIssues] = useState(false);
  // 초안이 어느 이름별 모드 파일에서 왔는지 (같은 파일에 다시 저장할 때는 덮어쓰기를 묻지 않는다)
  const [origin, setOrigin] = useState<string | null>(() => modFileName(activeModName()));
  const v = useMemo(() => validateMod(draft), [draft, ver]);
  const newDefaults = useMemo(() => missingDefaults(draft).length, [draft, ver]);

  const onChange = () => {
    bump();
    setDirty(true);
  };

  // 이름이 같은 다른 모드 파일을 덮어쓰기 전에 묻는다 (불러온 모드 자신에 다시 저장하는 것은 묻지 않음)
  const okToWrite = async (mod: ModData, from: string | null) => {
    if (storageMode() !== 'project') return true;
    const file = modFileName(mod.name);
    if (file === from) return true;
    const lib = await listLibrary().catch(() => null);
    return !lib?.mods.some((m) => m.file === file) || confirm(`"${mod.name}" 이름의 모드가 이미 있습니다. 그 모드를 이 내용으로 덮어쓸까요? (이전 내용은 mods/backup/library/에 백업)`);
  };

  // 모드를 게임에 적용: mods/editor.json(적용 중) + mods/library/<이름>.json(이름별 보관)에 저장
  const apply = async (mod: ModData = draft, from: string | null = origin) => {
    const check = mod === draft ? v : validateMod(mod);
    if (check.errors.length) {
      if (mod !== draft) {
        setDraft(mod);
        setOrigin(from);
        setNote(`"${mod.name}"에 오류가 있어 적용하지 못하고 초안으로만 불러왔습니다.`);
      }
      setShowIssues(true);
      return;
    }
    if (!(await okToWrite(mod, from))) return;
    applyMod(mod);
    const saved = saveMod(mod);
    if (mod !== draft) setDraft(mod);
    setDirty(false);
    if (storageMode() === 'project') {
      try {
        setOrigin(await writeLibraryMod(mod));
        // 실제 파일 쓰기는 잠시 뒤에 끝난다. 실패하면 화면 위쪽에 오류가 뜬다
        setNote(`"${mod.name}" 적용 완료. 게임에 바로 반영되고 ${SAVE_PATHS.mod}(적용 중)와 ${MOD_LIBRARY_DIR}/${modFileName(mod.name)}(이름별 보관)에 저장됩니다. 터미널 시뮬레이터도 적용 중인 모드를 자동으로 씁니다.`);
      } catch (e) {
        setNote(`"${mod.name}" 적용은 됐지만 이름별 보관 저장에 실패했습니다: ${String(e instanceof Error ? e.message : e)}`);
      }
    } else {
      setNote(saved
        ? `"${mod.name}" 적용 완료. 개발 서버가 아니라서 브라우저에만 저장됐습니다. 보관하려면 "모드 → JSON 내보내기"를 쓰세요.`
        : `"${mod.name}" 적용은 됐지만 브라우저 저장 용량이 부족해 저장하지 못했습니다. "모드 → JSON 내보내기"로 보관하세요.`);
    }
    onApplied();
  };

  // 적용하지 않고 이름별 보관만
  const saveDraft = async () => {
    if (!(await okToWrite(draft, origin))) return;
    try {
      setOrigin(await writeLibraryMod(draft));
      setNote(`"${draft.name}"을(를) ${MOD_LIBRARY_DIR}/${modFileName(draft.name)}에 저장했습니다 (게임에는 아직 적용 안 됨).`);
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
    }
  };

  const discard = () => {
    if (!confirm('적용하지 않은 변경 사항을 버릴까요?')) return;
    setDraft(snapshotMod());
    setOrigin(modFileName(activeModName()));
    setDirty(false);
    setNote('적용된 데이터로 되돌렸습니다.');
  };

  return (
    <div className="editor">
      <div className="editor-bar">
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} title={id === 'mod' && newDefaults ? `이 모드에 없는 새 기본 항목 ${newDefaults}개` : undefined}>
              {label}{id === 'mod' && newDefaults > 0 && <span className="tab-badge">새 항목 {newDefaults}</span>}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="muted small">적용 중: {activeModName()}</span>
        <button className={`pill ${v.errors.length ? 'bad' : v.warnings.length ? 'warn' : 'ok'}`} onClick={() => setShowIssues((s) => !s)}>
          {v.errors.length ? `오류 ${v.errors.length}` : '오류 없음'}
          {v.warnings.length ? ` · 경고 ${v.warnings.length}` : ''}
        </button>
        <button className="btn ghost" disabled={!dirty} onClick={discard}>되돌리기</button>
        <button className="btn primary" disabled={!dirty || v.errors.length > 0} onClick={() => void apply()}>
          {dirty ? '변경 사항 적용' : '적용됨'}
        </button>
      </div>
      {note && <div className="banner ok" onClick={() => setNote('')}>{note}</div>}
      {showIssues && (v.errors.length > 0 || v.warnings.length > 0) && (
        <div className="issues panel">
          {v.errors.map((e, i) => <div key={`e${i}`} className="bad-text">오류: {e}</div>)}
          {v.warnings.map((w, i) => <div key={`w${i}`} className="warn-text">경고: {w}</div>)}
        </div>
      )}
      <div className="editor-body">
        {tab === 'monsters' && <MonsterEditor draft={draft} onChange={onChange} />}
        {tab === 'growth' && (
          <>
            <CommonGrowthEditor draft={draft} onChange={onChange} />
            <EventGrowthEditor draft={draft} onChange={onChange} />
          </>
        )}
        {tab === 'synergy' && <SynergyEditor draft={draft} onChange={onChange} />}
        {tab === 'leaders' && <LeaderEditor draft={draft} onChange={onChange} />}
        {tab === 'trinkets' && <TrinketEditor draft={draft} onChange={onChange} />}
        {tab === 'events' && <EventEditor draft={draft} onChange={onChange} />}
        {tab === 'balance' && <BalanceEditor draft={draft} onChange={onChange} />}
        {tab === 'sandbox' && <Sandbox dirty={dirty} onApply={() => void apply()} />}
        {tab === 'balanceTest' && <BalanceTest dirty={dirty} onApply={() => void apply()} />}
        {tab === 'saves' && <PlayDataPanel />}
        {tab === 'mod' && (
          <ModPanel
            draft={draft}
            dirty={dirty}
            onChange={onChange}
            onReplace={(mod, msg, from = null) => {
              setDraft(mod);
              setOrigin(from);
              setDirty(true);
              setNote(msg);
            }}
            onApplyMod={(mod, from) => apply(mod, from)}
            onSaveDraft={saveDraft}
          />
        )}
      </div>
    </div>
  );
}
