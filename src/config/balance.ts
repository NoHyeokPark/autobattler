// 조절용 수치는 모두 여기에 둔다. 코드에는 수치를 하드코딩하지 않는다.
// 시간 단위는 tick(정수)이며 1초 = ticksPerSec tick이다.
// 퍼센트는 정수 %, 배율은 정수 permille(1000 = 1.0배)로 적는다.

export const BALANCE = {
  // 전투 규칙이 바뀌면 올린다. 다른 버전의 기록과는 매칭하지 않는다.
  ruleVersion: 2,
  ticksPerSec: 10,

  engine: {
    // JS 정수 안전 범위(약 9천조) 안쪽에서 값을 잘라내는 안전 한도. 규칙 상한이 아니다.
    safeLimit: 1_000_000_000_000_000,
    // 행동 간격의 최솟값(tick). 0초 연사를 막는다.
    minIntervalTicks: 2,
    // 행동 1회당 추가발동 처리 상한(엔진 안전 한도).
    maxExtraActs: 200,
    // 서든데스로도 끝나지 않을 때의 강제 종료 시각(초). 남은 HP 비율로 판정한다.
    maxBattleSec: 300,
  },

  suddenDeath: {
    startSec: 60,
    baseDamage: 20,
    // 매 초 피해 = 이전 피해 × ratioNum / ratioDen (등비수열)
    ratioNum: 3,
    ratioDen: 2,
    bypassShield: true,
  },

  // 전투 밖으로 이어지는 능력(골드·장신구 획득)의 전투당 상한. 추가발동으로 폭주하지 않게 막는다.
  // 영구 강화는 전투당 상한 없음 (트리거 시점·수치로 조절)
  battleGains: {
    maxGoldPerBattle: 8,
    maxTrinketsPerBattle: 2,
  },

  board: {
    initialDeployLimit: 6, // 리더 포함
    maxDeploy: 9,
    benchSize: 6,
  },

  // 칸 효과 = 열 효과 + 행 효과. 행동 간격 보정끼리는 곱연산.
  slot: {
    col1: { stunTicks: 30, intervalPermille: 700 }, // 3초 기절 시작, 최종값에 별도 0.7배
    col2: { hpPctPerDeployed: 5 }, // 배치 인원 1명당 이 유닛 최대 체력 +5%
    col3: { intervalPermille: 1200 }, // 행동 간격 +20%, 시작 시 남은 대기 시간 0
    row1: { atkBonusByDay: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5] }, // 1행 x값(일차별)
    row2: { healShieldPct: 10 },
    row3: { intervalPermille: 1500, extra: 1 },
  },

  // 일차가 지날수록 피해량(레벨업·스케일링)이 커지므로 양측 최대 체력을 같은 비율로 늘린다 (%, 1일차부터).
  // 시뮬레이터(npm run sim -- days)로 맞춘 값: 스케일링 없으면 전투 중앙값이 21초 → 11초로 줄고
  // 14일차 3초 내 종료가 11.6%였다. 이 값으로 평균 19~23초, 3초 내 종료 0~0.4%.
  scaling: {
    hpPctByDay: [100, 100, 100, 105, 110, 115, 125, 135, 155, 180, 205, 235, 265, 300],
  },

  env: {
    hp: { maxHpPct: 30 },
    atk: { atkBonusByDay: [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8] },
  },

  // 팀 단위 상태. 주기적 효과는 periodTicks마다 시스템 이벤트로 처리한다.
  statuses: {
    poison: { name: '독', harmful: true, periodTicks: 10, perStack: 1, bypassShield: true, decay: 'none' },
    regen: { name: '재생', harmful: false, periodTicks: 10, perStack: 1, bypassShield: false, decay: 'none' },
    fury: { name: '강화', harmful: false, periodTicks: 0, perStack: 1, bypassShield: false, decay: 'none' },
  },

  unit: {
    mergeCount: 3,
    maxLevel: 3,
    levelStatPct: [100, 190, 360], // 몬스터 레벨별 체력·공격력·주문력 배율
    growthChoices: 3, // 레벨업 때 제시하는 성장 선택지 수 (전용 + 공용 성장 중 무작위)
    // 성장을 고르는 레벨. Lv3은 고르지 않고, 합성에 쓴 Lv2 3장의 성장을 모두 물려받는다.
    growthChoiceLevels: [2],
  },

  leader: {
    levelUpDays: [4, 7, 10, 13],
    statPctPerLevel: 15, // 리더 레벨당 체력·공격력·주문력 +15%
    growthChoices: 3,
  },

  economy: {
    startGold: 0,
    baseIncome: 10,
    interestPer: 10,
    interestMax: 5,
    rerollCost: 1,
    monsterCost: [1, 2, 3, 4, 5, 8], // 일반 ~ 신화, 기원
    sellPct: 100, // 판매가 = 구매가 × 합성에 쓴 장수 × sellPct%
    trinketCost: [4, 6, 8, 11, 14, 0], // 몬스터 레벨업보다 가성비가 나쁘게
    skipRewardGold: 4,
    skipEliteBonusGold: 4,
    skipBossRewardGold: 8,
  },

  shop: {
    slots: 6,
    maxTrinkets: 2,
    trinketChancePct: 15, // 칸마다 장신구가 나올 확률
    // 상점 레벨 장신구는 확률표를 한 단계 앞당긴다(설계 후보 a).
    // 열: 일반, 희귀, 에픽, 전설, 신화, 기원. 행: 라운드(일차) 1~14
    odds: [
      [90, 10, 0, 0, 0, 0],
      [84, 15, 1, 0, 0, 0],
      [75, 20, 5, 0, 0, 0],
      [64, 25, 10, 1, 0, 0],
      [45, 35, 15, 5, 0, 0],
      [29, 40, 20, 10, 1, 0],
      [20, 35, 25, 15, 5, 0],
      [20, 30, 25, 15, 10, 0],
      [20, 28, 25, 15, 12, 0],
      [20, 25, 25, 15, 15, 0],
      [20, 23, 23, 17, 17, 0],
      [20, 20, 20, 20, 20, 0],
      [20, 20, 20, 20, 19, 1],
      [20, 20, 20, 20, 19, 1],
    ],
  },

  run: {
    maxDays: 14,
    winTarget: 10,
    lossLimit: 5,
    bossDays: [3, 6, 9, 12],
    finalBossDay: 14,
    // 보스 보상 장신구 등급 (3=에픽, 4=전설, 5=신화, 6=기원)
    bossRewardGrade: { 3: 3, 6: 4, 9: 5, 12: 6 } as Record<number, number>,
    rewardChoices: 3,
  },

  rank: {
    // 연장 승리 누적 보너스 (index = 연장 승수). 대안: [0, 1, 2, 4, 8]
    extensionBonus: [0, 1, 2, 3.5, 6],
    extensionLossScore: 4,
    championScore: 5,
    finalBossBonus: 1,
  },

  matching: {
    // 시드 봇은 실제 기록보다 약간 약하게: 매일 수입에서 이만큼 뺀다.
    seedBotIncomePenalty: 1,
    // 기록당 노출 횟수 상한(넘은 기록은 다른 후보가 있을 때 뽑지 않는다).
    exposureCap: 30,
  },
};

export type Balance = typeof BALANCE;
