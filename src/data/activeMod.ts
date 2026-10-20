// 지금 적용 중인 모드 이름. registry가 모드를 적용할 때 바꾸고, PvP 기록이 어느 모드에서 나왔는지 표시할 때 쓴다.
// (registry ↔ matching 순환 import를 피하려고 따로 둔다)

let activeName = '기본';

export const activeModName = (): string => activeName;
export function setActiveModName(name: string) {
  activeName = name;
}
