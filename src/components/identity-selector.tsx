'use client';

import { useState, useEffect } from 'react';
import { User, Bot, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { getIdentity, setIdentity, setRole, setActor, ROLE_LABELS, type Role, type Identity } from '@/lib/identity-store';

const roleColors: Record<Role, string> = {
  requester: 'bg-green-100 text-green-800 border-green-200',
  buyer: 'bg-blue-100 text-blue-800 border-blue-200',
  manager: 'bg-purple-100 text-purple-800 border-purple-200',
};

export function IdentitySelector() {
  const [identity, setLocalIdentity] = useState<Identity>({ actor: 'web:requester', role: 'requester' });
  const [showActorInput, setShowActorInput] = useState(false);
  const [customActor, setCustomActor] = useState('');

  useEffect(() => {
    // 初始化
    setLocalIdentity(getIdentity());

    // 监听身份变化
    const handleChange = (e: Event) => {
      setLocalIdentity((e as CustomEvent<Identity>).detail);
    };
    window.addEventListener('identity-changed', handleChange);
    return () => window.removeEventListener('identity-changed', handleChange);
  }, []);

  const handleRoleSelect = (role: Role) => {
    setRole(role);
  };

  const handleActorCustom = () => {
    if (customActor.trim()) {
      setActor(customActor.trim());
      setShowActorInput(false);
    }
  };

  const handleActorReset = () => {
    setActor('web:requester');
    setCustomActor('');
    setShowActorInput(false);
  };

  const isCustomActor = !identity.actor.startsWith('web:');

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1">
            {isCustomActor ? (
              <Bot className="w-4 h-4 text-blue-600" />
            ) : (
              <User className="w-4 h-4" />
            )}
            <span className="max-w-[100px] truncate">
              {ROLE_LABELS[identity.role]}
            </span>
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5 text-xs font-medium text-gray-500">角色</div>
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
            <DropdownMenuItem
              key={role}
              onClick={() => handleRoleSelect(role)}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span>{ROLE_LABELS[role]}</span>
              </div>
              {identity.role === role && (
                <Check className="w-4 h-4 text-green-600" />
              )}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Actor 模拟</div>
          <DropdownMenuItem onClick={() => setShowActorInput(!showActorInput)}>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-600" />
              <span>自定义 Agent ID</span>
            </div>
          </DropdownMenuItem>
          
          {isCustomActor && (
            <DropdownMenuItem onClick={handleActorReset}>
              <div className="flex items-center gap-2 text-gray-500">
                <User className="w-4 h-4" />
                <span>重置为 web:requester</span>
              </div>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Actor 输入框 */}
      {showActorInput && (
        <div className="flex items-center gap-1">
          <Input
            placeholder="coze_bot_001"
            value={customActor}
            onChange={(e) => setCustomActor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleActorCustom()}
            className="h-8 w-36 text-sm"
          />
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={handleActorCustom}>
            确定
          </Button>
        </div>
      )}

      {/* 当前身份 Badge */}
      <Badge variant="outline" className={`h-6 text-xs ${roleColors[identity.role]}`}>
        {ROLE_LABELS[identity.role]}
      </Badge>
      
      {isCustomActor && (
        <Badge variant="outline" className="h-6 text-xs bg-blue-50 text-blue-700 border-blue-200">
          <Bot className="w-3 h-3 mr-1" />
          {identity.actor}
        </Badge>
      )}
    </div>
  );
}
