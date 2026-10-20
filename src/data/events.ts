// 이벤트 (지도의 ? 노드). 전투 뒤 상황 글과 선택지를 보여 주고, 고른 선택지의 결과를 처리한다 (game/events.ts).
// 모드의 events. 아래는 기본 이벤트 (예전의 골드 / 떠돌이 몬스터 / 리더 이벤트 성장을 옮긴 것)

import type { EventDef } from './types.ts';

export const EVENTS: EventDef[] = [
  {
    id: 'ev_treasure', name: '숨겨진 보물', weight: 40,
    text: '길가 수풀 사이로 반쯤 묻힌 낡은 상자가 보입니다.',
    choices: [{ text: '상자를 연다', outcomes: [{ type: 'gold', amount: 5, perDay: 1 }] }],
  },
  {
    id: 'ev_stray', name: '떠돌이 몬스터', weight: 40,
    text: '길을 잃은 몬스터 몇 마리가 조심스럽게 따라옵니다. 한 마리쯤은 데려가도 될 것 같습니다.',
    choices: [{ text: '한 마리를 데려간다', outcomes: [{ type: 'monster', choices: 3 }] }],
  },
  {
    id: 'ev_strange_power', name: '낯선 힘', weight: 20,
    text: '오래된 제단 앞에서 낯선 힘이 리더를 부릅니다.',
    choices: [
      { text: '힘을 받아들인다', outcomes: [{ type: 'growth' }] },
      { text: '외면하고 지나간다', outcomes: [] },
    ],
  },
];
