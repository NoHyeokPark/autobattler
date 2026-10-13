// 3x3 보드. 칸마다 슬롯 번호와 칸 효과(열 + 행)를 표시한다.

import type { DragEvent, ReactNode } from 'react';
import { colEffectText, rowEffectText } from '../../src/ui/render.ts';

interface Props {
  cells: (ReactNode | null)[];
  day: number;
  onCellClick?: (index: number) => void;
  onDropCell?: (index: number, e: DragEvent) => void;
  isTarget?: (index: number) => boolean;
  compact?: boolean;
}

export function slotTooltip(index: number, day: number) {
  const r = Math.floor(index / 3);
  const c = index % 3;
  return `칸 ${index + 1} (${r + 1}행 ${c + 1}열)\n열: ${colEffectText(c)}\n행: ${rowEffectText(r, day)}`;
}

export function BoardGrid({ cells, day, onCellClick, onDropCell, isTarget, compact }: Props) {
  return (
    <div className={`board ${compact ? 'board-compact' : ''}`}>
      <div className="board-colhead" />
      {[0, 1, 2].map((c) => (
        <div key={c} className="board-colhead" title={colEffectText(c)}>
          {c + 1}열 <small>{colEffectText(c)}</small>
        </div>
      ))}
      {[0, 1, 2].map((r) => (
        <div key={r} className="board-row" style={{ display: 'contents' }}>
          <div className="board-rowhead" title={rowEffectText(r, day)}>
            {r + 1}행 <small>{rowEffectText(r, day)}</small>
          </div>
          {[0, 1, 2].map((c) => {
            const i = r * 3 + c;
            return (
              <div
                key={i}
                className={`cell ${cells[i] ? 'filled' : 'empty'} ${isTarget?.(i) ? 'target' : ''}`}
                title={cells[i] ? undefined : slotTooltip(i, day)}
                onClick={() => onCellClick?.(i)}
                onDragOver={onDropCell ? (e) => e.preventDefault() : undefined}
                onDrop={onDropCell ? (e) => onDropCell(i, e) : undefined}
              >
                <span className="slot-no">{i + 1}</span>
                {cells[i]}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
