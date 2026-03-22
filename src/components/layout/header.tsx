'use client';

import { Bell, User, Settings } from 'lucide-react';

export function Header() {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-gray-800">采购管理</h2>
      </div>
      <div className="flex items-center gap-4">
        <button className="p-2 hover:bg-gray-100 rounded-full">
          <Bell className="w-5 h-5 text-gray-600" />
        </button>
        <button className="p-2 hover:bg-gray-100 rounded-full">
          <Settings className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-medium text-gray-700">Agent</span>
        </div>
      </div>
    </header>
  );
}
