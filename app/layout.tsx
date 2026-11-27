import type { Metadata } from 'next'

import {
  Chakra_Petch,
  IBM_Plex_Sans_Thai,
  IBM_Plex_Mono,
} from 'next/font/google'

import './globals.css'

import { AppFooter } from '@/components/layout/app-footer'
import { ThemeProvider } from '@/components/themes/theme-provider'
import { APP_NAME, APP_TAGLINE } from '@/lib/app-config'

const chakra = Chakra_Petch({
  subsets: ['thai', 'latin'],
  weight: ['500', '600', '700'],
  variable: '--font-chakra',
  display: 'swap',
})

const plexSans = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_TAGLINE,
  applicationName: APP_NAME,
  openGraph: {
    title: APP_NAME,
    description: APP_TAGLINE,
    siteName: APP_NAME,
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="th"
      suppressHydrationWarning
      data-theme="midnight"
      className="dark"
    >
      <head>
        {/*
          สคริปต์นี้ช่วยตั้ง theme ก่อน React hydrate
          เพื่อกันหน้าขาวกระพริบตอนโหลดครั้งแรก
          ใช้ storageKey เดียวกับ ThemeProvider: h3-studio-theme
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var key = 'h3-studio-theme';
                  var valid = ['midnight', 'arctic', 'cyberpunk', 'sunset', 'forest'];
                  var stored = localStorage.getItem(key);
                  var theme = valid.indexOf(stored) >= 0 ? stored : 'midnight';

                  var darkThemes = ['midnight', 'cyberpunk'];
                  var isDark = darkThemes.indexOf(theme) >= 0;

                  var root = document.documentElement;
                  root.setAttribute('data-theme', theme);
                  root.classList.toggle('dark', isDark);
                  root.style.colorScheme = isDark ? 'dark' : 'light';
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>

      <body
        className={`${chakra.variable} ${plexSans.variable} ${plexMono.variable} antialiased`}
      >
        <ThemeProvider>
          <div className="flex min-h-dvh flex-col">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <AppFooter />
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}