'use client';

import { Bell, Settings, Info } from 'lucide-react';
import { IdentitySelector } from '@/components/identity-selector';

export function Header() {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-gray-800">采购管理</h2>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Info className="w-3 h-3" />
          <span>Agent 可用</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* 身份选择器 */}
        <IdentitySelector />
        
        <button className="p-2 hover:bg-gray-100 rounded-full">
          <Bell className="w-5 h-5 text-gray-600" />
        </button>
        <button className="p-2 hover:bg-gray-100 rounded-full">
          <Settings className="w-5 h-5 text-gray-600" />
        </button>
      </div>
    </header>
  );
}
