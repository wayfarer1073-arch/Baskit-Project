import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL } from '@/lib/legal';
import { getLocale } from '@/server/i18n';

export default async function PrivacyPage() {
  const locale = await getLocale();
  return <LegalPage doc={LEGAL.privacy[locale]} homeLabel="Limenote" />;
}
