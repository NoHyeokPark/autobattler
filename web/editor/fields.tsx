// 에디터 입력 필드. 입력 중인 문자열은 로컬로 들고 있다가, 올바른 값일 때만 데이터에 반영한다.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { LNum } from '../../src/data/types.ts';

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`} title={hint}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// 외부 값이 바뀌면 입력란을 맞추되, 사용자가 입력 중인 값(파싱 결과가 같은 값)은 덮어쓰지 않는다.
function useDraft<T>(value: T, format: (v: T) => string, parse: (s: string) => T | null) {
  const [text, setText] = useState(() => format(value));
  useEffect(() => {
    const parsed = parse(text);
    if (parsed === null || JSON.stringify(parsed) !== JSON.stringify(value)) setText(format(value));
  }, [JSON.stringify(value)]);
  return [text, setText] as const;
}

const parseNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function NumInput({ value, onChange, int = true, min, readOnly, width }: {
  value: number;
  onChange: (v: number) => void;
  int?: boolean;
  min?: number;
  readOnly?: boolean;
  width?: number;
}) {
  const [text, setText] = useDraft(value, String, parseNum);
  const parsed = parseNum(text);
  const bad = parsed === null || (int && !Number.isInteger(parsed)) || (min !== undefined && parsed < min);
  return (
    <input
      className={`input num ${bad ? 'bad' : ''}`}
      style={width ? { width } : undefined}
      value={text}
      readOnly={readOnly}
      inputMode="decimal"
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNum(e.target.value);
        if (n !== null && (!int || Number.isInteger(n)) && (min === undefined || n >= min)) onChange(n);
      }}
    />
  );
}

export function OptNumInput({ value, onChange, min }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number }) {
  const [text, setText] = useDraft(value, (v) => (v === undefined ? '' : String(v)), (s) => (s.trim() === '' ? undefined : parseNum(s)) as number | undefined | null);
  return (
    <input
      className="input num"
      value={text}
      placeholder="없음"
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') return onChange(undefined);
        const n = parseNum(e.target.value);
        if (n !== null && Number.isInteger(n) && (min === undefined || n >= min)) onChange(n);
      }}
    />
  );
}

// "5" 또는 레벨별 "2/4/8"
export function parseLNum(s: string): LNum | null {
  const parts = s.split('/').map((x) => x.trim());
  if (parts.some((p) => p === '')) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n))) return null;
  return nums.length === 1 ? nums[0] : nums;
}
const fmtLNum = (v: LNum | undefined) => (v === undefined ? '' : Array.isArray(v) ? v.join('/') : String(v));

export function LNumInput({ value, onChange, optional }: { value: LNum | undefined; onChange: (v: LNum | undefined) => void; optional?: boolean }) {
  const [text, setText] = useDraft(value, fmtLNum, (s) => (s.trim() === '' ? undefined : parseLNum(s)) as LNum | undefined | null);
  const parsed = text.trim() === '' ? (optional ? undefined : null) : parseLNum(text);
  return (
    <input
      className={`input lnum ${parsed === null ? 'bad' : ''}`}
      value={text}
      placeholder={optional ? '없음' : '예) 5 또는 2/4/8'}
      title="숫자 하나면 모든 레벨 공통, 2/4/8처럼 쓰면 Lv1/Lv2/Lv3 값"
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === '') {
          if (optional) onChange(undefined);
          return;
        }
        const v = parseLNum(e.target.value);
        if (v !== null) onChange(v);
      }}
    />
  );
}

export function NumListInput({ value, onChange, int = true }: { value: number[]; onChange: (v: number[]) => void; int?: boolean }) {
  const parse = (s: string): number[] | null => {
    const parts = s.split(',').map((x) => x.trim()).filter((x) => x !== '');
    const nums = parts.map(Number);
    return nums.every((n) => Number.isFinite(n) && (!int || Number.isInteger(n))) ? nums : null;
  };
  const [text, setText] = useDraft(value, (v) => v.join(', '), parse);
  return (
    <input
      className={`input list ${parse(text) === null ? 'bad' : ''}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value);
        if (v) onChange(v);
      }}
    />
  );
}

export function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input className={`input ${mono ? 'mono' : ''}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea className="input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function Select<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <select
      className="input"
      value={String(value)}
      onChange={(e) => {
        const opt = options.find(([v]) => String(v) === e.target.value);
        if (opt) onChange(opt[0]);
      }}
    >
      {options.map(([v, label]) => <option key={String(v)} value={String(v)}>{label}</option>)}
    </select>
  );
}

export function Check({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
