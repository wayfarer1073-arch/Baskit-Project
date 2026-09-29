import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMessages } from '@/server/i18n';

export default async function NotFound() {
  const t = (await getMessages()).dashboard.errors;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <PackageSearch className="size-10 text-muted-foreground" aria-hidden="true" />
      <div>
        <h1 className="text-lg font-semibold">{t.notFoundTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.notFoundBody}</p>
      </div>
      <Button asChild>
        <Link href="/">{t.home}</Link>
      </Button>
    </div>
  );
}
