'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const menuItems = [
  {
    title: '仪表盘',
    href: '/',
    icon: '📊',
  },
  {
    title: '物料管理',
    href: '/materials',
    icon: '📦',
  },
  {
    title: '供应商管理',
    href: '/suppliers',
    icon: '🏢',
  },
  {
    title: '采购申请',
    href: '/purchase-requests',
    icon: '📝',
  },
  {
    title: '采购订单',
    href: '/purchase-orders',
    icon: '📋',
  },
  {
    title: '框架协议',
    href: '/framework-agreements',
    icon: '📄',
  },
  {
    title: '寻源任务',
    href: '/sourcing-tasks',
    icon: '🔍',
  },
  {
    title: '收货管理',
    href: '/goods-receipts',
    icon: '📥',
  },
  {
    title: '审计日志',
    href: '/audit-logs',
    icon: '📜',
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col">
      <div className="p-4 border-b border-slate-700">
        <h1 className="text-lg font-bold">采购管理系统</h1>
        <p className="text-xs text-slate-400 mt-1">Agent 可用版 v1.0</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname === item.href
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            )}
          >
            <span>{item.icon}</span>
            <span>{item.title}</span>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-700">
        <div className="text-xs text-slate-400">
          <p>状态：已连接</p>
          <p className="mt-1">角色：需求人</p>
        </div>
      </div>
    </aside>
  );
}
