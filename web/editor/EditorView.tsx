// 기획자·모드 도구. 초안(draft)을 편집하고 "적용"하면 게임 데이터가 바뀌고 브라우저에 저장된다.

import { useMemo, useReducer, useState } from 'react';
import { activeModName, applyMod, snapshotMod } from '../../src/data/registry.ts';
import type { ModData } from '../../src/data/registry.ts';
import { validateMod } from '../../src/data/validate.ts';
import { saveMod } from '../lib/persist.ts';
import { BalanceEditor } from './BalanceEditor.tsx';
import { CommonGrowthEditor, LeaderEditor, MonsterEditor, TrinketEditor } from './EntityEditors.tsx';
import { ModPanel } from './ModPanel.tsx';
import { Sandbox } from './Sandbox.tsx';

const TABS = [
  ['monsters', '몬스터'],
  ['growth', '공용 성장'],
  ['leaders', '리더'],
  ['trinkets', '장신구'],
  ['balance', '수치'],
  ['sandbox', '테스트'],
  ['mod', '모드'],
] as const;
type Tab = (typeof TABS)[number][0];

export function EditorView({ onApplied }: { onApplied: () => void }) {
  const [draft, setDraft] = useState<ModData>(() => snapshotMod());
  const [ver, bump] = useReducer((x: number) => x + 1, 0);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('monsters');
  const [note, setNote] = useState('');
  const [showIssues, setShowIssues] = useState(false);
  const v = useMemo(() => validateMod(draft), [draft, ver]);

  const onChange = () => {
    bump();
    setDirty(true);
  };

  const apply = () => {
    if (v.errors.length) {
      setShowIssues(true);
      return;
    }
    applyMod(draft);
    const saved = saveMod(draft);
    setDirty(false);
    // 파일로 넣은 카드 아트(data URL)가 크면 브라우저 저장 용량을 넘어 저장에 실패할 수 있다
    setNote(saved
      ? `"${draft.name}" 적용 완료. 게임에 바로 반영되고 브라우저에 저장됐습니다.`
      : `"${draft.name}" 적용은 됐지만 브라우저 저장 용량이 부족해 저장하지 못했습니다 (새로고침하면 사라짐). 파일로 넣은 카드 아트가 크면 생깁니다. "모드 → JSON 내보내기"로 보관하세요.`);
    onApplied();
  };

  const discard = () => {
    if (!confirm('적용하지 않은 변경 사항을 버릴까요?')) return;
    setDraft(snapshotMod());
    setDirty(false);
    setNote('적용된 데이터로 되돌렸습니다.');
  };

  return (
    <div className="editor">
      <div className="editor-bar">
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="muted small">적용 중: {activeModName()}</span>
        <button className={`pill ${v.errors.length ? 'bad' : v.warnings.length ? 'warn' : 'ok'}`} onClick={() => setShowIssues((s) => !s)}>
          {v.errors.length ? `오류 ${v.errors.length}` : '오류 없음'}
          {v.warnings.length ? ` · 경고 ${v.warnings.length}` : ''}
        </button>
        <button className="btn ghost" disabled={!dirty} onClick={discard}>되돌리기</button>
        <button className="btn primary" disabled={!dirty || v.errors.length > 0} onClick={apply}>
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
        {tab === 'growth' && <CommonGrowthEditor draft={draft} onChange={onChange} />}
        {tab === 'leaders' && <LeaderEditor draft={draft} onChange={onChange} />}
        {tab === 'trinkets' && <TrinketEditor draft={draft} onChange={onChange} />}
        {tab === 'balance' && <BalanceEditor draft={draft} onChange={onChange} />}
        {tab === 'sandbox' && <Sandbox dirty={dirty} onApply={apply} />}
        {tab === 'mod' && (
          <ModPanel
            draft={draft}
            onChange={onChange}
            onReplace={(mod, msg) => {
              setDraft(mod);
              setDirty(true);
              setNote(msg);
            }}
          />
        )}
      </div>
    </div>
  );
}
