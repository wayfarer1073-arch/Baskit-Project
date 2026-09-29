import { Eye } from 'lucide-react';

/** 조회 전용 사용자가 입력 화면에 들어왔을 때 보여주는 안내(서버에서도 변경 요청은 막는다). */
export function ViewerNotice({ message }: { message: string }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
      <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}
