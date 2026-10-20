import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMod } from '../src/data/registry.ts';
import { validateMod } from '../src/data/validate.ts';
import { App } from './App.tsx';
import { loadArtManifest } from './lib/art.ts';
import { initStorage, loadSavedMod } from './lib/persist.ts';
import './styles.css';

async function boot() {
  // 일러스트 목록은 기다리지 않는다. 받기 전에는 글자 카드로 보이고, 받으면 카드가 다시 그려진다.
  void loadArtManifest();
  // 저장 파일(mods/·saves/)을 먼저 읽어야 이어하기·모드 적용이 된다
  await initStorage();

  // 에디터에서 적용한 모드(mods/editor.json)가 있으면 게임 시작 전에 적용한다.
  let bootWarning = '';
  const saved = loadSavedMod();
  if (saved) {
    const v = validateMod(saved);
    if (v.errors.length === 0) applyMod(saved);
    else bootWarning = `저장된 모드 "${saved.name}"에 오류가 있어 기본 데이터로 시작합니다: ${v.errors[0]}`;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App bootWarning={bootWarning} />
    </StrictMode>,
  );
}

void boot();
