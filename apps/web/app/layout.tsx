import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import '@xyflow/react/dist/style.css';
import { TRPCProvider } from '@/lib/trpc/client';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'controlai-web',
  description: 'Multi-tenant web control plane for controlai IoT provisioning',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <TRPCProvider>{children}</TRPCProvider>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
