import { T } from './targets.ts';
import type { GrowthDef, LeaderDef, LeaderLines } from './types.ts';

// 통솔력(배치 인원 +1)은 모든 리더가 가진 성장 선택지다. 9칸이 가득 차면 나오지 않는다.
//
// 전직(promotions): 일반 성장과 따로, 리더 Lv3(BALANCE.leader.promotionLevels)에 한 번 고르는 큰 방향 전환.
// 변신(transform)은 셋 중 하나를 고르는 방향 전환.
// 태그가 바뀌고 콘셉트도 바뀌지만, 원래 리더의 특성(기사 = 공격력, 강령술사 = 독·주문력, 성녀 = 보조)은 남긴다.
// 그래서 같은 언데드화라도 기사는 흡혈 전사가 되고 성녀는 회복을 잃은 저주 보조가 된다.
// 보드에 많이 모인 태그 쪽으로 변신하도록 유도한다 (잘 뜨는 쪽으로 덱을 정하는 재미).
// 본질 강화(mastery): 같은 자리에 항상 고정 1자리로 나오는, 태그를 유지하고 원래 콘셉트를 키우는 길.
// 원래 태그로 잘 굴러가는 덱이 억지로 방향을 틀지 않아도 되게 한다.
const command = (): GrowthDef => ({ id: 'command', name: '통솔력', desc: '배치 인원 +1', repeatable: true, deploy: 1 });

export const LEADERS: LeaderDef[] = [
  {
    id: 'knight', name: '기사', tags: ['전사'], hp: 140, atk: 8, intervalTicks: 20,
    title: '앞에 서는 검',
    quote: '내 뒤에 서. 길은 내가 연다.',
    lines: { battleStart: '간다. 뒤처지지 마.', lowHp: '아직... 쓰러질 순 없어!', win: '오늘도 지켜냈다.', lose: '다음엔... 반드시.' },
    lore: '가장 먼저 적진에 들어가 가장 늦게 나오는 검사. 단단한 몸과 꾸준한 공격으로 곁의 동료를 이끈다.\n\n전사 동료와 함께할 때 가장 강하지만, 싸움 끝에 무엇이 되느냐는 걸어온 길에 달렸다.',
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '균형 잡힌 전사형 리더. 인접 멤버 강화와 연속 공격으로 성장한다.',
    growth: [
      command(),
      { id: 'k_atk', name: '검술 단련', desc: '리더 공격력 +6', repeatable: true, stats: { atk: 6 } },
      {
        id: 'k_rally', name: '돌격 명령', desc: '전투 시작: 인접 멤버 공격력 +30%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.adjacent(), pct: 30 }] }],
      },
      { id: 'k_haste', name: '신속', desc: '리더 가속 +18', repeatable: true, stats: { haste: 18 } },
      { id: 'k_extra', name: '연속 베기', desc: '리더 추가발동 +1', repeatable: true, stats: { extra: 1 } },
      {
        id: 'k_oath', name: '전사의 맹세', desc: '전투 시작: 아군 전사 공격력 +25%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('전사'), pct: 25 }] }],
      },
      {
        id: 'k_veteran', name: '백전노장', desc: '전투 시작: 리더 공격력 영구 +2 (전투마다 쌓임)', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'permanent', target: T.self(), stat: 'atk', amount: 2 }] }],
      },
      {
        id: 'k_beastmaster', name: '야수 조련', desc: '리더에 야수 태그 추가, 아래 아군 공격력 +40%', repeatable: false,
        addTags: ['야수'], form: true,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.ally(['d']), pct: 40 }] }],
      },
    ],
    // 전직: 리더 Lv3에 본질 강화(맨 앞 고정 자리) + 변신 3개 중 하나
    promotions: [
      {
        id: 'k_m_swordmaster', quote: '검은 하나면 충분하다.', lines: { promote: '검은 하나면 충분하다.', lowHp: '검 끝에 망설임은 없다.' }, name: '검성', mastery: true, form: true, repeatable: false,
        desc: '[본질 강화] 전사 유지. 공격력 +30%. 전투 시작: 아군 전사 공격력 +20%. 검 한 자루로 끝까지 간다',
        stats: { atkPct: 30 },
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('전사'), pct: 20 }] }],
      },
      {
        id: 'k_t_deathknight', quote: '죽음 너머에서도 싸움은 계속된다.', lines: { promote: '죽음 너머에서도 싸움은 계속된다.', lowHp: '피가... 부족하군.' }, name: '죽음의 기사', transform: true, form: true, repeatable: false,
        desc: '[변신] 전사 → 언데드. 공격할 때마다 공격력 60%만큼 흡혈(회복), 체력 +20%. 공격 일변도에서 공수 균형형으로',
        removeTags: ['전사'], addTags: ['언데드'], stats: { hpPct: 20 },
        triggers: [{ on: 'act', effects: [{ type: 'heal', atkPct: 60 }] }],
      },
      {
        id: 'k_t_wolfrider', quote: '달려라! 무리가 곧 나의 검이다!', lines: { promote: '달려라! 무리가 곧 나의 검이다!', lowHp: '물러서지 마, 무리여!' }, name: '늑대 기수', transform: true, form: true, repeatable: false,
        desc: '[변신] 전사 → 야수. 가속 +33, 행동할 때마다 인접 야수 공격력 +1 (전투 중 누적). 홀로 강한 검사에서 무리를 키우는 선봉으로',
        removeTags: ['전사'], addTags: ['야수'], stats: { haste: 33 },
        triggers: [{ on: 'act', effects: [{ type: 'atkFlat', target: T.adjacent('야수'), amount: 1 }] }],
      },
      {
        id: 'k_t_paladin', quote: '이 방패 뒤로는 아무도 못 지나간다.', lines: { promote: '이 방패 뒤로는 아무도 못 지나간다.', lowHp: '빛이여, 한 번만 더!' }, name: '성기사', transform: true, form: true, repeatable: false,
        desc: '[변신] 전사 → 성직. 공격할 때마다 공격력 80% 실드. 전투 시작: 아군 성직 공격력 +30% (성직의 회복·실드도 공격력 기반이라 함께 오름)',
        removeTags: ['전사'], addTags: ['성직'],
        triggers: [
          { on: 'act', effects: [{ type: 'shield', atkPct: 80 }] },
          { on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('성직'), pct: 30 }] },
        ],
      },
    ],
  },
  {
    id: 'necro', name: '강령술사', tags: ['언데드', '마법'], hp: 110, atk: 5, power: 20, intervalTicks: 25,
    title: '잠들지 못한 자들의 주인',
    quote: '서두를 것 없어. 독은 기다려 주거든.',
    lines: { battleStart: '자, 천천히 썩어 가 볼까.', lowHp: '흥, 조금 아프네.', win: '예정대로야.', lose: '...계산이 틀렸어.' },
    lore: '죽음과 부패를 다루는 술사. 한 번의 일격보다 쌓여 가는 독으로 상대를 무너뜨린다.\n\n전투가 길어질수록 유리하며, 언데드 동료를 부릴 때 진가를 드러낸다.',
    triggers: [
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
      { on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 10, to: 'enemy' }] },
    ],
    desc: '독과 언데드를 다루는 리더. 장기전과 언데드 덱에 강하다.',
    growth: [
      command(),
      {
        id: 'n_plague', name: '역병', desc: '리더 행동 시 독 추가 (주문력 10%)', repeatable: true,
        triggers: [{ on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 10, to: 'enemy' }] }],
      },
      {
        id: 'n_lord', name: '죽음의 군주', desc: '전투 시작: 아군 언데드 공격력 +30%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('언데드'), pct: 30 }] }],
      },
      {
        id: 'n_curse', name: '쇠약의 저주', desc: '전투 시작: 상대 전체 공격력 -10%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.enemies(), pct: -10 }] }],
      },
      { id: 'n_extra', name: '망령 소환', desc: '리더 추가발동 +1', repeatable: true, stats: { extra: 1 } },
      { id: 'n_bone', name: '뼈 갑옷', desc: '리더 체력 +70', repeatable: true, stats: { hp: 70 } },
      {
        id: 'n_lich', name: '리치화', desc: '기본 공격(능력 1)을 잃고 주문력 +100%', repeatable: false,
        removeTriggers: [0], stats: { powerPct: 100 }, form: true,
      },
    ],
    // 전직: 리더 Lv3에 본질 강화(맨 앞 고정 자리) + 변신 3개 중 하나
    promotions: [
      {
        id: 'n_m_archnecro', name: '대강령술사', mastery: true, form: true, repeatable: false,
        desc: '[본질 강화] 언데드·마법 유지. 주문력 +50%, 행동할 때 독 한 번 더 (주문력 10%). 전투 시작: 아군 언데드 공격력 +20%',
        stats: { powerPct: 50 },
        triggers: [
          { on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 10, to: 'enemy' }] },
          { on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('언데드'), pct: 20 }] },
        ],
      },
      {
        id: 'n_t_rotdruid', name: '부패의 드루이드', transform: true, form: true, repeatable: false,
        desc: '[변신] 언데드 → 자연. 독은 그대로, 행동할 때 아군 재생 (주문력 10%). 전투 시작: 아군 최대 체력 +10%. 썩어 가는 것이 새 생명을 키운다',
        removeTags: ['언데드'], addTags: ['자연'],
        triggers: [
          { on: 'act', effects: [{ type: 'status', status: 'regen', powerPct: 10, to: 'ally' }] },
          { on: 'battleStart', effects: [{ type: 'maxHpPct', pct: 10 }] },
        ],
      },
      {
        id: 'n_t_ratking', name: '역병 쥐왕', transform: true, form: true, repeatable: false,
        desc: '[변신] 언데드 → 야수. 추가발동 +1, 가속 +18 (독을 훨씬 자주 뿌림). 전투 시작: 아군 야수 가속 +11',
        removeTags: ['언데드'], addTags: ['야수'], stats: { extra: 1, haste: 18 },
        triggers: [{ on: 'battleStart', effects: [{ type: 'haste', target: T.allies('야수'), amount: 11 }] }],
      },
      {
        id: 'n_t_deathgeneral', name: '죽음의 장군', transform: true, form: true, repeatable: false,
        desc: '[변신] 마법 → 전사. 독(능력 2)을 잃고 공격력 +10. 전투 시작: 아군 전사 공격력 +25%. 주술 대신 되살린 병사들을 지휘한다',
        removeTags: ['마법'], addTags: ['전사'], removeTriggers: [1], stats: { atk: 10 },
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('전사'), pct: 25 }] }],
      },
    ],
  },
  {
    id: 'saint', name: '성녀', tags: ['성직'], hp: 120, atk: 6, power: 20, intervalTicks: 30,
    title: '꺼지지 않는 등불',
    quote: '다치지 마세요. 그래도 다친다면, 제가 있어요.',
    lines: { battleStart: '모두 무사히 돌아가요.', lowHp: '조금만... 조금만 더 버텨 주세요!', win: '다행이에요, 모두 무사해서.', lose: '미안해요... 지켜 주지 못해서.' },
    lore: '회복과 보호로 동료를 지키는 성직자. 직접 싸우기보다 무너지지 않는 대열을 만든다.\n\n버티는 싸움, 서든데스까지 가는 장기전에 강하다.',
    triggers: [{ on: 'act', effects: [{ type: 'heal', atkPct: 150 }, { type: 'shield', atkPct: 100 }] }],
    desc: '회복·실드 리더. 버티면서 서든데스와 장기전을 노린다.',
    growth: [
      command(),
      { id: 's_bless', name: '축복 강화', desc: '리더 회복·실드량 +30%', repeatable: true, stats: { healShieldPct: 30 } },
      {
        id: 's_spring', name: '생명의 샘', desc: '전투 시작: 아군 재생 (주문력 15%)', repeatable: true,
        triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'regen', powerPct: 15, to: 'ally' }] }],
      },
      { id: 's_extra', name: '이중 기도', desc: '리더 추가발동 +1', repeatable: true, stats: { extra: 1 } },
      {
        id: 's_grace', name: '은총', desc: '전투 시작: 인접 멤버 가속 +18', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'haste', target: T.adjacent(), amount: 18 }] }],
      },
      {
        id: 's_crusade', name: '성전', desc: '전투 시작: 아군 강화 (주문력 10%)', repeatable: true,
        triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'fury', powerPct: 10, to: 'ally' }] }],
      },
      { id: 's_wisdom', name: '지혜', desc: '리더 주문력 +50%', repeatable: true, stats: { powerPct: 50 } },
    ],
    // 전직: 리더 Lv3에 본질 강화(맨 앞 고정 자리) + 변신 3개 중 하나
    promotions: [
      {
        id: 's_m_archsaint', name: '대성녀', mastery: true, form: true, repeatable: false,
        desc: '[본질 강화] 성직 유지. 회복·실드량 +40%. 전투 시작: 아군 재생 (주문력 10%), 아군 성직 가속 +18. 더 오래, 더 단단하게',
        stats: { healShieldPct: 40 },
        triggers: [{
          on: 'battleStart', effects: [
            { type: 'status', status: 'regen', powerPct: 10, to: 'ally' },
            { type: 'haste', target: T.allies('성직'), amount: 18 },
          ],
        }],
      },
      {
        id: 's_t_wraith', name: '저주받은 망령', transform: true, form: true, repeatable: false,
        desc: '[변신] 성직 → 언데드. 회복을 잃고(실드만 남음) 전투 시작: 인접 언데드 공격력 +50%, 행동할 때마다 인접 언데드 공격력 +1 (전투 중 누적). 버티는 보조에서 공격을 끌어올리는 보조로',
        removeTags: ['성직'], addTags: ['언데드'], removeTriggers: [0],
        triggers: [
          { on: 'act', effects: [{ type: 'shield', atkPct: 100 }, { type: 'atkFlat', target: T.adjacent('언데드'), amount: 1 }] },
          { on: 'battleStart', effects: [{ type: 'atkPct', target: T.adjacent('언데드'), pct: 50 }] },
        ],
      },
      {
        id: 's_t_divinebeast', name: '신수', transform: true, form: true, repeatable: false,
        desc: '[변신] 성직 → 야수. 회복·실드는 그대로, 직접 공격 추가 (공격력 100%), 공격력 +50%, 가속 +43. 전투 시작: 아군 야수 공격력 +20%',
        removeTags: ['성직'], addTags: ['야수'], stats: { atkPct: 50, haste: 43 },
        triggers: [
          { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
          { on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('야수'), pct: 20 }] },
        ],
      },
      {
        id: 's_t_dryad', name: '세계수의 무녀', transform: true, form: true, repeatable: false,
        desc: '[변신] 성직 → 자연. 즉시 회복 대신 행동할 때 아군 재생 (주문력 15%) + 실드 (공격력 100%). 전투 시작: 아군 최대 체력 +15%. 순간 회복에서 쌓이는 회복으로',
        removeTags: ['성직'], addTags: ['자연'], removeTriggers: [0],
        triggers: [
          { on: 'act', effects: [{ type: 'status', status: 'regen', powerPct: 15, to: 'ally' }, { type: 'shield', atkPct: 100 }] },
          { on: 'battleStart', effects: [{ type: 'maxHpPct', pct: 15 }] },
        ],
      },
    ],
  },
];

export const LEADER_MAP: Record<string, LeaderDef> = Object.fromEntries(LEADERS.map((l) => [l.id, l]));

// 밸런스 통계용 더미 리더: 아무 행동도 하지 않고 체력만 있는 유닛 (리더 변수를 빼고 몬스터를 보려고). id에 체력을 담는다: '__dummy:500'
// 리더 목록·모드에는 없고 전투 엔진만 안다. 다른 유닛과 똑같이 칸 효과·일차별 체력 배율을 받는다
export const DUMMY_LEADER_PREFIX = '__dummy:';
export const dummyLeaderId = (hp: number) => `${DUMMY_LEADER_PREFIX}${Math.max(1, Math.floor(hp))}`;
export function dummyLeaderDef(id: string): LeaderDef | undefined {
  if (!id.startsWith(DUMMY_LEADER_PREFIX)) return undefined;
  const hp = Math.max(1, Math.floor(Number(id.slice(DUMMY_LEADER_PREFIX.length)) || 1));
  return { id, name: '더미 리더', tags: [], hp, atk: 0, power: 0, intervalTicks: 1_000_000, triggers: [], desc: '아무 행동도 하지 않는 더미', growth: [] };
}

// 리더 이벤트 성장: 모든 리더 공용. 지도의 이벤트 노드(?)에서 얻는다 (레벨업 성장 선택지에는 나오지 않음). 모드의 eventGrowth
export const EVENT_GROWTH: GrowthDef[] = [
  {
    id: 'ev_vampire', name: '흡혈귀의 피', desc: '', repeatable: false,
    lines: { promote: '피가... 달콤하네.' },
    triggers: [{ on: 'act', effects: [{ type: 'heal', atkPct: 50, powerPct: 50 }] }],
  },
];

// 일반 성장·전직·이벤트 성장을 모두 찾는다
export function findGrowth(leaderId: string, growthId: string): GrowthDef | undefined {
  const l = LEADER_MAP[leaderId];
  return l?.growth.find((g) => g.id === growthId) ?? l?.promotions?.find((g) => g.id === growthId) ?? EVENT_GROWTH.find((g) => g.id === growthId);
}

// 전직 목록(promotions)에 있는 성장인지
export const isPromotion = (leaderId: string, growthId: string): boolean =>
  !!LEADER_MAP[leaderId]?.promotions?.some((g) => g.id === growthId);

// 고른 전직 (변신·본질 강화 중 하나, 없으면 undefined). 리더당 하나만 가진다
export function leaderPath(leaderId: string, growthIds: string[]): GrowthDef | undefined {
  const id = growthIds.find((x) => isPromotion(leaderId, x));
  return id ? findGrowth(leaderId, id) : undefined;
}

// 지금 리더의 대사: 기본 위에 전직 성장이 쓴 칸만 덮어쓴다
// rival = 상대 리더로 나왔을 때의 대사 (비운 칸은 플레이어일 때 대사)
export function leaderVoice(leaderId: string, growthIds: string[]): { quote?: string; lines: LeaderLines; rival: LeaderLines } {
  const l = LEADER_MAP[leaderId];
  const p = leaderPath(leaderId, growthIds);
  const merge = (...layers: (LeaderLines | undefined)[]) => {
    const out: LeaderLines = {};
    for (const layer of layers) for (const [k, v] of Object.entries(layer ?? {})) if (v?.trim()) out[k as keyof LeaderLines] = v;
    return out;
  };
  const lines = merge(l?.lines, p?.lines);
  return { quote: p?.quote?.trim() || l?.quote, lines, rival: { ...lines, ...merge(l?.rivalLines, p?.rivalLines) } };
}

// 리더 외형(일러스트 형태) = 마지막으로 고른 외형 변화 성장
export function leaderForm(leaderId: string, growthIds: string[]): string | undefined {
  for (let i = growthIds.length - 1; i >= 0; i--) if (findGrowth(leaderId, growthIds[i])?.form) return growthIds[i];
  return undefined;
}
