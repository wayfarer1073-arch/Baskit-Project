export const POST_TAG_OPTIONS = [
  { value: 'NOTICE', label: '공지', badgeVariant: 'notice' },
  { value: 'ISSUE', label: '이슈', badgeVariant: 'danger' },
  { value: 'RESOLVED', label: '해결', badgeVariant: 'resolved' },
  { value: 'CHAT', label: '잡담', badgeVariant: 'secondary' },
] as const;

export type PostTagValue = (typeof POST_TAG_OPTIONS)[number]['value'];

export function postTagBadgeVariant(tag: PostTagValue) {
  return POST_TAG_OPTIONS.find((o) => o.value === tag)?.badgeVariant ?? 'outline';
}

const DOT_CLASS_NAMES: Record<PostTagValue, string> = {
  NOTICE: 'bg-tag-notice',
  ISSUE: 'bg-status-danger',
  RESOLVED: 'bg-tag-resolved',
  CHAT: 'bg-muted-foreground',
};

/** 사이드바 미리보기 등에서 태그를 나타내는 작은 점의 배경색 클래스. */
export function postTagDotClassName(tag: PostTagValue): string {
  return DOT_CLASS_NAMES[tag];
}
