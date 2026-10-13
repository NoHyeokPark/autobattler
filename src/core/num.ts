import { BALANCE } from '../config/balance.ts';
import type { LNum } from '../data/types.ts';

// 엔진의 모든 계산은 정수로 한다. 값은 안전 한도에서 잘라낸다.
// 한도는 에디터에서 바뀔 수 있으므로 호출할 때마다 읽는다.
export function clampN(v: number): number {
  const SAFE = BALANCE.engine.safeLimit;
  if (v > SAFE) return SAFE;
  if (v < -SAFE) return -SAFE;
  return Math.trunc(v);
}

// a * b / c (소수점 버림). 곱이 정수 안전 범위를 넘으면 BigInt로 계산한다.
export function mulDiv(a: number, b: number, c: number): number {
  const p = a * b;
  if (Number.isSafeInteger(p)) return clampN(Math.trunc(p / c));
  return clampN(Number((BigInt(a) * BigInt(b)) / BigInt(c)));
}

// a * b / c (반올림, 0.5는 올림). 음수가 아닌 값에 쓴다. 팀 상태 중첩처럼 작은 정수에서 버림 손실이 큰 곳용.
export function mulDivRound(a: number, b: number, c: number): number {
  return mulDiv(a * 2, b, c) - mulDiv(a, b, c);
}

export function addN(a: number, b: number): number {
  return clampN(a + b);
}

// 레벨별 수치를 고른다. level은 1부터.
export function lv(v: LNum | undefined, level: number): number {
  if (v === undefined) return 0;
  if (typeof v === 'number') return v;
  return v[Math.min(level, v.length) - 1];
}
