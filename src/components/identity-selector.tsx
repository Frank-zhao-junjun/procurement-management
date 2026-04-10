'use client';

import { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getIdentity, type Identity } from '@/lib/identity-store';

const roleColors: Record<string, string> = {
  requester: 'bg-green-100 text-green-800 border-green-200',
  buyer: 'bg-blue-100 text-blue-800 border-blue-200',
  manager: 'bg-purple-100 text-purple-800 border-purple-200',
};

const roleLabels: Record<string, string> = {
  requester: '需求人',
  buyer: '采购人',
  manager: '审批人',
};

export function IdentitySelector() {
  const [identity, setLocalIdentity] = useState<Identity>({ actor: 'anonymous', role: 'requester' });

  useEffect(() => {
    // 初始化
    setLocalIdentity(getIdentity());

    // 监听身份变化（只读模式，不允许前端修改）
    const handleChange = (e: Event) => {
      setLocalIdentity((e as CustomEvent<Identity>).detail);
    };
    window.addEventListener('identity-changed', handleChange);
    return () => window.removeEventListener('identity-changed', handleChange);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className={roleColors[identity.role] || 'bg-gray-100 text-gray-800'}>
        <User className="w-3 h-3 mr-1" />
        {roleLabels[identity.role] || identity.role}
      </Badge>
      <span className="text-xs text-gray-500 truncate max-w-[120px]" title={identity.actor}>
        {identity.actor}
      </span>
    </div>
  );
}
