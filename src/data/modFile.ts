// 이름별 모드 파일 규칙. 모드 하나 = mods/library/<모드 이름>.json
// 개발 서버 플러그인(tools/)·웹·터미널이 같이 쓰므로 다른 모듈을 import하지 않는다.

export const MOD_LIBRARY_DIR = 'mods/library';

// 모드 이름 → 파일 이름. 윈도우에서 못 쓰는 문자는 _로 바꾼다.
export function modFileName(name: string): string {
  const base = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  return `${base || '이름 없는 모드'}.json`;
}

// 요청으로 받은 파일 이름이 라이브러리 안의 파일 하나만 가리키는지 (경로 이동 차단)
export function isSafeModFile(file: string): boolean {
  return file.endsWith('.json') && modFileName(file.slice(0, -'.json'.length)) === file;
}
