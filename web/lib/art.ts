// 카드 일러스트: art/ 폴더 목록(manifest)을 받아 두고, 카드마다 규칙에 맞는 파일을 고른다.
// 업로드하면 목록만 다시 받아서 해당 카드들이 다시 그려진다 (페이지 새로고침 없음).

import { useSyncExternalStore } from 'react';
import { artCandidates } from '../../src/data/art.ts';
import type { ArtRef } from '../../src/data/art.ts';

let files: Record<string, string> = {};
let loaded = false;
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}

export async function loadArtManifest(): Promise<void> {
  try {
    const res = await fetch('/art/manifest.json', { cache: 'no-cache' });
    files = res.ok ? ((await res.json()) as { files: Record<string, string> }).files : {};
  } catch {
    files = {};
  }
  loaded = true;
  notify();
}

export function hasArt(key: string): boolean {
  return key in files;
}

export function artFileUrl(key: string): string | undefined {
  return files[key] ? `/art/${files[key]}` : undefined;
}

// 규칙에 따라 실제로 쓸 이미지 (없으면 undefined → 글자 카드)
export function resolveArt(ref: ArtRef | undefined): { url: string; key: string } | undefined {
  if (!ref) return undefined;
  for (const key of artCandidates(ref)) if (files[key]) return { url: `/art/${files[key]}`, key };
  return undefined;
}

export function useArtVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

export const artManifestLoaded = () => loaded;

// 카드에 맞는 크기로 줄여서 webp로 만든다 (최대 변 512px). 원본 해상도를 그대로 쓰면 다운로드·메모리 낭비가 크다.
export async function resizeToWebp(file: File, maxSide = 512): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('변환 실패'))), 'image/webp', 0.86));
}

// 개발 서버에만 있는 업로드 API. 정적 빌드에서는 실패한다 (그때는 art/ 폴더에 직접 넣는다)
export async function uploadArt(key: string, file: File): Promise<{ bytes: number }> {
  const blob = await resizeToWebp(file);
  const res = await fetch(`/__art/upload?key=${encodeURIComponent(key)}`, { method: 'POST', body: blob });
  const body = (await res.json().catch(() => ({}))) as { error?: string; bytes?: number };
  if (!res.ok) throw new Error(body.error ?? `업로드 실패 (${res.status}) - 개발 서버(npm run web)에서만 업로드할 수 있습니다`);
  await loadArtManifest();
  return { bytes: body.bytes ?? blob.size };
}

export async function deleteArt(key: string): Promise<void> {
  const res = await fetch(`/__art/delete?key=${encodeURIComponent(key)}`, { method: 'POST' });
  if (!res.ok) throw new Error('삭제 실패 - 개발 서버에서만 가능합니다');
  await loadArtManifest();
}
