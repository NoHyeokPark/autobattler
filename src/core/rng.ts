// 결정적 난수 (mulberry32). 상태가 정수 하나라서 저장·복원이 쉽다.
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  int(n: number): number {
    return n <= 0 ? 0 : this.next() % n;
  }

  chancePct(pct: number): boolean {
    return this.int(100) < pct;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  // 가중치 배열에서 인덱스를 뽑는다. 가중치 합이 0이면 -1.
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return -1;
    let r = this.int(total);
    for (let i = 0; i < weights.length; i++) {
      if (r < weights[i]) return i;
      r -= weights[i];
    }
    return weights.length - 1;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// 문자열·숫자 조합을 32비트 시드로 만든다 (FNV-1a).
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}
