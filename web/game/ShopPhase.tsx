// 상점 단계: 보드(3x3)·벤치·상점·노드 선택·준비 완료.
// 유닛은 클릭으로 선택한 뒤 다른 칸을 클릭하거나, 끌어다 놓아서 옮긴다.

import { useState } from 'react';
import type { DragEvent } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { findGrowth, LEADER_MAP } from '../../src/data/leaders.ts';
import { MONSTER_MAP } from '../../src/data/monsters.ts';
import { TRINKET_MAP } from '../../src/data/trinkets.ts';
import { selectNode, stopExtension } from '../../src/game/run.ts';
import { buy, getAt, itemCost, move, reroll, sell, sellPrice } from '../../src/game/shop.ts';
import type { Loc, OpResult } from '../../src/game/shop.ts';
import type { RunState } from '../../src/game/state.ts';
import { deployedCount, deployLimit, shopLevel } from '../../src/game/state.ts';
import { NODE_NAMES, nodeText } from '../../src/ui/render.ts';
import { BoardGrid, slotTooltip } from '../components/BoardGrid.tsx';
import { Card, monsterCard, trinketCard } from '../components/Card.tsx';
import { ownedCard } from './units.ts';

interface Props {
  run: RunState;
  disabled: boolean;
  onCommit: (r?: OpResult) => void;
  onGo: () => void;
  onShowTrinkets: () => void;
  onNewRun: () => void;
}

const sameLoc = (a: Loc | null, b: Loc) => !!a && a.area === b.area && a.index === b.index;

export function ShopPhase({ run, disabled, onCommit, onGo, onShowTrinkets, onNewRun }: Props) {
  const [selected, setSelected] = useState<Loc | null>(null);
  const leader = LEADER_MAP[run.leaderId];
  const selUnit = selected ? getAt(run, selected) : null;

  const clickLoc = (loc: Loc) => {
    if (disabled) return;
    if (sameLoc(selected, loc)) return setSelected(null);
    if (selected && selUnit) {
      const r = move(run, selected, loc);
      setSelected(null);
      return onCommit(r);
    }
    if (getAt(run, loc)) setSelected(loc);
  };

  const dragStart = (loc: Loc) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(loc));
    setSelected(loc);
  };
  const dropOn = (to: Loc) => (e: DragEvent) => {
    e.preventDefault();
    try {
      const from = JSON.parse(e.dataTransfer.getData('text/plain')) as Loc;
      if (!sameLoc(from, to)) onCommit(move(run, from, to));
    } catch {
      // 다른 곳에서 끌어온 데이터
    }
    setSelected(null);
  };
  const dropSell = (e: DragEvent) => {
    e.preventDefault();
    try {
      onCommit(sell(run, JSON.parse(e.dataTransfer.getData('text/plain')) as Loc));
    } catch {
      // 무시
    }
    setSelected(null);
  };

  const unitCell = (loc: Loc) => {
    const u = getAt(run, loc);
    if (!u) return null;
    return <Card data={ownedCard(u, run)} size="sm" selected={sameLoc(selected, loc)} draggable={!disabled} onDragStart={dragStart(loc)} />;
  };

  const boardCells = run.board.map((_, i) => unitCell({ area: 'board', index: i }));
  const growthNames = run.growth.map((g) => findGrowth(run.leaderId, g)?.name ?? g);
  const inc = run.lastIncome;

  return (
    <div className="shop-phase">
      <div className="topbar">
        <div className="topbar-main">
          <strong className="day">{run.day}일차</strong>
          <span className="pill">{run.wins}승 {run.losses}패{run.extension.active ? ` · 연장 ${run.extension.wins}승` : ''}</span>
          <span className="pill gold">{run.gold}G</span>
          <span className="muted">오늘 수입 {inc.base} + 이자 {inc.interest}{inc.bonus ? ` + 장신구 ${inc.bonus}` : ''}</span>
        </div>
        <div className="topbar-side">
          <span className="muted" title={growthNames.join(', ')}>
            리더 {leader?.name} Lv{run.leaderLevel}{growthNames.length ? ` (${growthNames.join(', ')})` : ''}
          </span>
          <button className="btn" onClick={onShowTrinkets}>배낭 · 장신구 {run.trinkets.length}</button>
          {run.extension.active && <button className="btn warn" disabled={disabled} onClick={() => onCommit(stopExtension(run))}>여기서 멈추기</button>}
          <button className="btn ghost" onClick={onNewRun}>새 런</button>
        </div>
      </div>

      <div className="shop-grid">
        <section className="panel board-panel">
          <div className="panel-head">
            <h3>보드</h3>
            <span className={`pill ${deployedCount(run) >= deployLimit(run) ? 'full' : ''}`}>배치 {deployedCount(run)}/{deployLimit(run)}</span>
          </div>
          <BoardGrid
            cells={boardCells}
            day={run.day}
            onCellClick={(i) => clickLoc({ area: 'board', index: i })}
            onDropCell={(i, e) => dropOn({ area: 'board', index: i })(e)}
            isTarget={(i) => !!selected && !sameLoc(selected, { area: 'board', index: i })}
          />
          <div className="panel-head">
            <h3>벤치</h3>
            <span className="muted">같은 몬스터 3장 = 자동 합성</span>
          </div>
          <div className="bench">
            {run.bench.map((_, i) => {
              const loc: Loc = { area: 'bench', index: i };
              return (
                <div
                  key={i}
                  className={`cell ${run.bench[i] ? 'filled' : 'empty'} ${selected && !sameLoc(selected, loc) ? 'target' : ''}`}
                  onClick={() => clickLoc(loc)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={dropOn(loc)}
                >
                  <span className="slot-no">b{i + 1}</span>
                  {unitCell(loc)}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel side-panel">
          <h3>노드 선택</h3>
          <div className="nodes">
            {run.nodes.map((n, i) => (
              <button
                key={i}
                className={`node node-${n.kind} ${run.nodeIndex === i ? 'active' : ''}`}
                disabled={disabled}
                onClick={() => onCommit(selectNode(run, i))}
              >
                <strong>{NODE_NAMES[n.kind]}</strong>
                <span>{nodeText(n, run.day)}</span>
              </button>
            ))}
          </div>

          <div className="selected-box" onDragOver={(e) => e.preventDefault()} onDrop={dropSell}>
            {selUnit && selected ? (
              <>
                <Card data={ownedCard(selUnit, run)} size="lg" />
                <div className="selected-actions">
                  {selected.area === 'board' && <p className="muted pre">{slotTooltip(selected.index, run.day)}</p>}
                  {!selUnit.leader && MONSTER_MAP[selUnit.defId] && (
                    <button className="btn danger" disabled={disabled} onClick={() => { onCommit(sell(run, selected)); setSelected(null); }}>
                      판매 +{sellPrice(selUnit)}G
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => setSelected(null)}>선택 해제</button>
                  <p className="muted">다른 칸을 눌러 이동·교체</p>
                </div>
              </>
            ) : (
              <p className="muted center">유닛을 눌러 선택하세요.<br />여기로 끌어다 놓으면 판매합니다.</p>
            )}
          </div>

          <button className="btn primary go" disabled={disabled || run.nodeIndex === null} onClick={onGo}>
            준비 완료
          </button>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>상점</h3>
          <span className="muted">상점 레벨 {shopLevel(run)}</span>
          <div className="spacer" />
          <button className="btn" disabled={disabled || run.gold < BALANCE.economy.rerollCost} onClick={() => onCommit(reroll(run))}>
            리롤 {BALANCE.economy.rerollCost}G
          </button>
          <button className={`btn ${run.shopLocked ? 'active' : ''}`} disabled={disabled} onClick={() => { run.shopLocked = !run.shopLocked; onCommit(); }}>
            잠금 {run.shopLocked ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="shop">
          {run.shop.map((item, i) => {
            if (!item) return <div key={i} className="shop-empty">구매함</div>;
            const def = item.kind === 'monster' ? MONSTER_MAP[item.defId] : TRINKET_MAP[item.defId];
            if (!def) return <div key={i} className="shop-empty">데이터 없음</div>;
            const cost = itemCost(item);
            const data = item.kind === 'monster' ? monsterCard(MONSTER_MAP[item.defId]) : trinketCard(TRINKET_MAP[item.defId]);
            const owned = item.kind === 'trinket' ? run.trinkets.filter((x) => x === item.defId).length : 0;
            return (
              <Card
                key={i}
                data={data}
                size="md"
                cost={cost}
                disabled={disabled || run.gold < cost}
                onClick={() => !disabled && onCommit(buy(run, i))}
                footer={owned > 0 ? <div className="card-owned">보유 x{owned} → x{owned + 1}</div> : undefined}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
