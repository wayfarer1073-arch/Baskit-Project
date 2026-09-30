/**
 * 화면 이동이 시작됐음을 알리는 신호. 링크 클릭은 오버레이가 스스로 감지하지만,
 * 코드에서 router.push로 이동하는 곳(날짜 변경, 대시보드 전환 등)은 이 함수를 불러 알린다.
 */
export const NAVIGATION_START_EVENT = 'limenote:navigation-start';

export function startNavigationFeedback() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NAVIGATION_START_EVENT));
}
