// 터미널 정렬용 문자열 도구. 한글·전각 문자는 폭 2로 계산한다.

import { BALANCE } from '../config/balance.ts';

function charWidth(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // 한글 자모
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  ) return 2;
  return 1;
}

export function dw(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
}

export function padEnd(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - dw(s)));
}

export function padStart(s: string, w: number): string {
  return ' '.repeat(Math.max(0, w - dw(s))) + s;
}

export function truncate(s: string, w: number): string {
  if (dw(s) <= w) return s;
  let out = '';
  for (const ch of s) {
    if (dw(out + ch) > w - 1) break;
    out += ch;
  }
  return out + '~';
}

export function cell(s: string, w: number): string {
  return padEnd(truncate(s, w), w);
}

export function bar(v: number, max: number, width: number): string {
  const n = max <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((v / max) * width)));
  return '[' + '#'.repeat(n) + '.'.repeat(width - n) + ']';
}

export function sec(ticks: number): string {
  return `${(ticks / BALANCE.ticksPerSec).toFixed(1)}s`;
}
