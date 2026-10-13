import { useState } from 'react';
import { EditorView } from './editor/EditorView.tsx';
import { GameView } from './game/GameView.tsx';
import { loadPref, savePref } from './lib/persist.ts';

export function App({ bootWarning }: { bootWarning: string }) {
  const [tab, setTab] = useState(() => loadPref('tab', 'game'));
  const [dataVersion, setDataVersion] = useState(0);
  const [warning, setWarning] = useState(bootWarning);

  const go = (t: string) => {
    setTab(t);
    savePref('tab', t);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <header className="app-head">
        <h1>덱빌딩 오토배틀러 <small>v0.1 프로토타입</small></h1>
        <nav className="tabs">
          <button className={`tab ${tab === 'game' ? 'active' : ''}`} onClick={() => go('game')}>게임</button>
          <button className={`tab ${tab === 'editor' ? 'active' : ''}`} onClick={() => go('editor')}>에디터</button>
        </nav>
      </header>
      {warning && <div className="banner bad" onClick={() => setWarning('')}>{warning}</div>}
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
