// 상점 단계: 보드(3x3)·벤치·상점·노드 선택·준비 완료.
// 유닛은 끌어다 놓아서 옮긴다. 클릭은 정보 보기만 (실수로 자리가 바뀌지 않게).

import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { findGrowth, LEADER_MAP } from '../../src/data/leaders.ts';
import { MONSTER_MAP, MONSTERS } from '../../src/data/monsters.ts';
import { TRINKET_MAP } from '../../src/data/trinkets.ts';
import { GRADE_NAMES } from '../../src/data/types.ts';
import { incomePreview, selectNode, stopExtension } from '../../src/game/run.ts';
import { buy, getAt, itemCost, move, reroll, sell, sellPrice, shopTier } from '../../src/game/shop.ts';
import type { Loc, OpResult } from '../../src/game/shop.ts';
import type { RunState } from '../../src/game/state.ts';
import { deployedCount, deployLimit, livesLeft } from '../../src/game/state.ts';
import { MapModal, RunMapSvg } from './MapModal.tsx';
import { NODE_NAMES, nodeLabel } from '../../src/ui/render.ts';
import { BoardGrid, slotTooltip } from '../components/BoardGrid.tsx';
import { Card, monsterCard, trinketCard } from '../components/Card.tsx';
import { TrinketDetail, UnitDetail } from './UnitDetail.tsx';
import { ownedCard } from './units.ts';
import { SynergyBar } from './SynergyBar.tsx';

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
  const [showMap, setShowMap] = useState(false);
  const [hover, setHover] = useState<number | null>(null); // 마우스를 올린 상점 칸 (선택한 유닛이 없을 때 상세 보기에 보여 줌)
  const hoverItem = hover !== null ? run.shop[hover] : null;
  const leader = LEADER_MAP[run.leaderId];
  const selUnit = selected ? getAt(run, selected) : null;

  // 클릭은 정보 보기만 (이동은 드래그로만: 정보를 보려다 실수로 자리가 바뀌지 않게)
  const clickLoc = (loc: Loc) => {
    if (sameLoc(selected, loc)) return setSelected(null);
    setSelected(getAt(run, loc) ? loc : null);
  };

  const [dragging, setDragging] = useState(false); // 끌고 있는 동안만 놓을 칸을 강조
  useEffect(() => {
    const end = () => setDragging(false);
    addEventListener('dragend', end);
    return () => removeEventListener('dragend', end);
  }, []);
  const dragStart = (loc: Loc) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(loc));
    setSelected(loc);
    setDragging(true);
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
    setDragging(false);
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
  const inc = incomePreview(run); // 내일 받을 수입 (이미 받은 수입은 골드에 들어가 있음)

  return (
    <div className="shop-phase">
      <div className="topbar">
        <div className="topbar-main">
          <strong className="day">{run.day}일차</strong>
          <span className="pill">{run.wins}승 {run.losses}패{run.extension.active ? ` · 연장 ${run.extension.wins}승` : ''}</span>
          <span className={`pill lives ${livesLeft(run) <= 1 ? 'danger' : ''}`} title={`질 수 있는 횟수. 0이 되면 탈락 (모닥불에서 +1, ${BALANCE.run.maxDays}일차 시작 때 남은 라이프는 하나당 ${BALANCE.run.spareLifeGold}골드)`}>
            라이프 {livesLeft(run)}
          </span>
        </div>
        <div className="topbar-side">
          <span className="muted" title={growthNames.join(', ')}>
            리더 {leader?.name} Lv{run.leaderLevel}{growthNames.length ? ` (${growthNames.join(', ')})` : ''}
          </span>
          {run.extension.active && <button className="btn warn" disabled={disabled} onClick={() => onCommit(stopExtension(run))}>여기서 멈추기</button>}
          <button className="btn ghost" onClick={onNewRun}>새 런</button>
        </div>
      </div>

      <div className="shop-grid">
        <section className="panel board-panel">
          <div className="panel-head">
            <h3>보드</h3>
            <span className={`pill ${deployedCount(run) >= deployLimit(run) ? 'full' : ''}`}>배치 {deployedCount(run)}/{deployLimit(run)}</span>
            <div className="spacer" />
            <button className="btn" onClick={onShowTrinkets}>배낭 · 장신구 {run.trinkets.length}</button>
          </div>
          <SynergyBar run={run} />
          <div className="board-row">
            <BoardGrid
              cells={boardCells}
              day={run.day}
              onCellClick={(i) => clickLoc({ area: 'board', index: i })}
              onDropCell={(i, e) => dropOn({ area: 'board', index: i })(e)}
              isTarget={(i) => dragging && !sameLoc(selected, { area: 'board', index: i })}
            />
            {run.map && (
              <div className="mini-map" title="미니맵 (오늘부터 2일 뒤까지). 오늘 노드를 누르면 선택, 빈 곳을 누르면 전체 지도"
                onClick={(e) => { if (!(e.target as Element).closest('.map-node.open')) setShowMap(true); }}>
                <RunMapSvg run={run} disabled={disabled} onPick={(i) => onCommit(selectNode(run, i))} mini />
              </div>
            )}
          </div>
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
                  className={`cell ${run.bench[i] ? 'filled' : 'empty'} ${dragging && !sameLoc(selected, loc) ? 'target' : ''}`}
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
          <div className="panel-head">
            <h3>노드 선택</h3>
            <button className="btn small" onClick={() => setShowMap(true)} title="14일치 지도와 이어진 길">지도</button>
          </div>
          <div className="nodes">
            {run.nodes.map((n, i) => (
              <button
                key={i}
                className={`node node-${n.kind} ${run.nodeIndex === i ? 'active' : ''}`}
                disabled={disabled}
                onClick={() => onCommit(selectNode(run, i))}
              >
                <strong>{n.kind === 'event' ? '? 이벤트' : NODE_NAMES[n.kind]}</strong>
                <span>{nodeLabel(n, run.day)}</span>
              </button>
            ))}
          </div>

          <div className="selected-box" onDragOver={(e) => e.preventDefault()} onDrop={dropSell}>
            {selUnit && selected ? (
              <UnitDetail
                unit={{ ...selUnit, kind: selUnit.leader ? 'leader' : 'monster' }}
                leaderGrowth={run.growth}
                card={ownedCard(selUnit, run)}
                gold={run.gold}
                place={selected.area === 'board' ? `${Math.floor(selected.index / 3) + 1}행 ${(selected.index % 3) + 1}열` : `벤치 ${selected.index + 1}번`}
              >
                {!selUnit.leader && MONSTER_MAP[selUnit.defId] && (
                  <button className="btn small danger" disabled={disabled} onClick={() => { onCommit(sell(run, selected)); setSelected(null); }}>
                    판매 +{sellPrice(selUnit)}G
                  </button>
                )}
                <button className="btn small ghost" onClick={() => setSelected(null)}>선택 해제</button>
                {selected.area === 'board' && <p className="muted small pre">칸 효과: {slotTooltip(selected.index, run.day)}</p>}
                <p className="muted small">끌어다 놓아 이동·교체, 여기로 끌어오면 판매</p>
              </UnitDetail>
            ) : hoverItem && MONSTER_MAP[hoverItem.defId] && hoverItem.kind === 'monster' ? (
              <UnitDetail unit={{ kind: 'monster', defId: hoverItem.defId, level: 1 }} leaderGrowth={[]} card={monsterCard(MONSTER_MAP[hoverItem.defId])} place="상점" gold={run.gold}>
                <span className="muted small">구매 {itemCost(hoverItem)}G · 카드를 누르면 구매</span>
              </UnitDetail>
            ) : hoverItem && hoverItem.kind === 'trinket' && TRINKET_MAP[hoverItem.defId] ? (
              <TrinketDetail
                card={trinketCard(TRINKET_MAP[hoverItem.defId], run.trinkets.filter((x) => x === hoverItem.defId).length)}
                note={<span className="muted small">구매 {itemCost(hoverItem)}G · 카드를 누르면 구매</span>}
              />
            ) : (
              <p className="muted center">유닛을 눌러 선택하세요. 상점 카드에 마우스를 올리면 자세히 보입니다.<br />여기로 끌어다 놓으면 판매합니다.</p>
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
          {(() => {
            const t = shopTier(run);
            return (
              <span className="muted shop-tier has-tip" tabIndex={0}>
                상점 레벨 {t.tier}{t.bonus > 0 ? ` (${t.day}일차 + 장신구 ${t.bonus})` : ''}
                <span className="tip" role="tooltip">
                  {t.row.map((w, i) => {
                    if (w <= 0) return null;
                    const none = !MONSTERS.some((m) => m.grade === i + 1); // 몬스터가 없는 등급은 뽑히지 않음
                    return [<span key={`n${i}`}>{GRADE_NAMES[i + 1]}{none ? ' (몬스터 없음)' : ''}</span>, <strong key={`w${i}`}>{none ? '무시' : `${w}%`}</strong>];
                  })}
                </span>
              </span>
            );
          })()}
          <span className="pill gold">{run.gold}G</span>
          <span className="income has-tip" tabIndex={0}>
            내일 수입 +{inc.base + inc.interest + inc.bonus}G
            <span className="tip" role="tooltip">
              <span>기본 수입</span><strong>+{inc.base}</strong>
              <span>이자 (지금 {run.gold}G 기준 · {BALANCE.economy.interestPer}G당 1, 최대 {BALANCE.economy.interestMax})</span><strong>+{inc.interest}</strong>
              <span>장신구</span><strong>+{inc.bonus}</strong>
              {inc.nextAt !== undefined && <span className="tip-note">{inc.nextAt}G 더 남기면 이자 +1</span>}
              <span className="tip-note muted-on-dark">전투 보상 골드는 따로 더해집니다</span>
            </span>
          </span>
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
              <div key={i} className="shop-item" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
              <Card
                data={data}
                size="md"
                cost={cost}
                disabled={disabled || run.gold < cost}
                onClick={() => !disabled && onCommit(buy(run, i))}
                footer={owned > 0 ? <div className="card-owned">보유 x{owned} → x{owned + 1}</div> : undefined}
              />
              </div>
            );
          })}
        </div>
      </section>
      {showMap && <MapModal run={run} disabled={disabled} onPick={(i) => onCommit(selectNode(run, i))} onClose={() => setShowMap(false)} />}
    </div>
  );
}
