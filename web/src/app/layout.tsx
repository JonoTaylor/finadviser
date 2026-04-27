import type { Metadata } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import ThemeRegistry from '@/theme/ThemeRegistry';
import Sidebar from '@/components/layout/Sidebar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument-serif',
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
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body>
        <ThemeRegistry>
          <Sidebar>{children}</Sidebar>
        </ThemeRegistry>
      </body>
    </html>
  );
}
