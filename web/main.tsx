import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMod } from '../src/data/registry.ts';
import { validateMod } from '../src/data/validate.ts';
import { App } from './App.tsx';
import { loadArtManifest } from './lib/art.ts';
import { loadSavedMod } from './lib/persist.ts';
import './styles.css';

// 에디터에서 저장한 모드가 있으면 게임 시작 전에 적용한다.
let bootWarning = '';
const saved = loadSavedMod();
if (saved) {
  const v = validateMod(saved);
  if (v.errors.length === 0) applyMod(saved);
  else bootWarning = `저장된 모드 "${saved.name}"에 오류가 있어 기본 데이터로 시작합니다: ${v.errors[0]}`;
}

// 일러스트 목록은 비동기로 받는다. 받기 전에는 글자 카드로 보이고, 받으면 카드가 다시 그려진다.
void loadArtManifest();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App bootWarning={bootWarning} />
  </StrictMode>,
);
