import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: '采购管理系统 | Agent 可用',
    template: '%s | 采购管理系统',
  },
  description:
    '面向 Agent 的采购管理系统，支持采购申请、寻源、框架协议、采购订单、收货等全流程管理。',
  keywords: ['采购管理', '采购系统', 'Agent', '寻源', '供应链'],
  authors: [{ name: 'Procurement Team' }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <div className="flex h-screen bg-gray-100">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto p-6">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
