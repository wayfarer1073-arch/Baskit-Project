import type { Metadata } from 'next';
import { Geist_Mono, Noto_Sans_KR } from 'next/font/google';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/components/i18n/i18n-provider';
import { getLocale, getMessages } from '@/server/i18n';
import './globals.css';

// 본문 텍스트 대부분이 한글이므로 라틴 전용 폰트 대신 한글 전용 웨이트를 갖춘 서체를 기본으로 쓴다.
const notoSansKr = Noto_Sans_KR({
  variable: '--font-sans-kr',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return { title: m.common.appName, description: m.common.metaDescription };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const m = await getMessages();
  return (
    <html lang={locale} className={`${notoSansKr.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
        >
          {m.common.skipToContent}
        </a>
        <I18nProvider locale={locale}>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
