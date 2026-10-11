import type { Metadata } from 'next';
import localFont from 'next/font/local';
import ThemeRegistry from '@/theme/ThemeRegistry';
import Sidebar from '@/components/layout/Sidebar';
import './globals.css';

const inter = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'FinAdviser',
  description: 'Personal financial adviser',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ThemeRegistry>
          <Sidebar>{children}</Sidebar>
        </ThemeRegistry>
      </body>
    </html>
  );
}
