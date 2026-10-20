import { useEffect, useState } from 'react';
import { EditorView } from './editor/EditorView.tsx';
import { GameView } from './game/GameView.tsx';
import { loadPref, onStorageError, savePref, storageMode } from './lib/persist.ts';

export function App({ bootWarning }: { bootWarning: string }) {
  const [tab, setTab] = useState(() => loadPref('tab', 'game'));
  const [dataVersion, setDataVersion] = useState(0);
  const [warning, setWarning] = useState(bootWarning);
  const [saveError, setSaveError] = useState('');

  useEffect(() => onStorageError(setSaveError), []);

  const go = (t: string) => {
    setTab(t);
    savePref('tab', t);
    window.scrollTo({ top: 0 });
  };

  const project = storageMode() === 'project';
  return (
    <div className="app">
      <header className="app-head">
        <h1>덱빌딩 오토배틀러 <small>v0.2 프로토타입</small></h1>
        <nav className="tabs">
          <button className={`tab ${tab === 'game' ? 'active' : ''}`} onClick={() => go('game')}>게임</button>
          <button className={`tab ${tab === 'editor' ? 'active' : ''}`} onClick={() => go('editor')}>에디터</button>
        </nav>
        <span
          className={`pill ${project ? 'ok' : 'warn'} storage-pill`}
          title={project ? '저장: 프로젝트 폴더 mods/editor.json, saves/*.json' : '개발 서버(npm run web)가 아니라서 브라우저에만 저장됩니다'}
        >
          {project ? '저장: 프로젝트 폴더' : '저장: 브라우저 (임시)'}
        </span>
      </header>
      {warning && <div className="banner bad" onClick={() => setWarning('')}>{warning}</div>}
      {saveError && <div className="banner bad" onClick={() => setSaveError('')}>{saveError} (눌러서 닫기)</div>}
      {!project && (
        <div className="banner warn">개발 서버(npm run web) 없이 열려 있어 브라우저에만 저장됩니다. 브라우저 데이터가 지워지면 사라집니다.</div>
      )}
      {/* 두 화면을 모두 띄워 두고 숨기기만 한다: 탭을 바꿔도 에디터 초안과 전투 재생이 유지된다 */}
      <main hidden={tab !== 'game'}>
        <GameView dataVersion={dataVersion} />
      </main>
      <main hidden={tab !== 'editor'}>
        <EditorView onApplied={() => setDataVersion((v) => v + 1)} />
      </main>
    </div>
  );
}
