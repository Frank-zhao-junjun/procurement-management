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

type Role = 'requester' | 'buyer' | 'manager';

interface Identity {
  mode: 'role' | 'agent';
  role?: Role;
  agentId?: string;
}

const STORAGE_KEY = 'procurement-identity';

export function getStoredIdentity(): Identity {
  if (typeof window === 'undefined') return { mode: 'role', role: 'requester' };
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // ignore
    }
  }
  return { mode: 'role', role: 'requester' };
}

export function storeIdentity(identity: Identity): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

const roleLabels: Record<Role, string> = {
  requester: '申请人',
  buyer: '采购员',
  manager: '审批经理',
};

const roleColors: Record<Role, string> = {
  requester: 'bg-green-100 text-green-800 border-green-200',
  buyer: 'bg-blue-100 text-blue-800 border-blue-200',
  manager: 'bg-purple-100 text-purple-800 border-purple-200',
};

export function IdentitySelector() {
  const [identity, setIdentity] = useState<Identity>({ mode: 'role', role: 'requester' });
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [showAgentInput, setShowAgentInput] = useState(false);

  useEffect(() => {
    const stored = getStoredIdentity();
    setIdentity(stored);
    setIsAgentMode(stored.mode === 'agent');
    if (stored.agentId) {
      setAgentId(stored.agentId);
    }
  }, []);

  const handleRoleSelect = (role: Role) => {
    const newIdentity: Identity = { mode: 'role', role };
    setIdentity(newIdentity);
    storeIdentity(newIdentity);
    setIsAgentMode(false);
    setShowAgentInput(false);
  };

  const handleAgentModeToggle = () => {
    if (!isAgentMode) {
      setIsAgentMode(true);
      setShowAgentInput(true);
      setIdentity({ mode: 'agent', agentId: agentId || undefined });
    } else {
      setIsAgentMode(false);
      setShowAgentInput(false);
      setIdentity({ mode: 'role', role: 'requester' });
      storeIdentity({ mode: 'role', role: 'requester' });
    }
  };

  const handleAgentIdChange = (value: string) => {
    setAgentId(value);
    const newIdentity: Identity = { mode: 'agent', agentId: value || undefined };
    setIdentity(newIdentity);
    storeIdentity(newIdentity);
  };

  const currentLabel = isAgentMode && agentId
    ? `Agent: ${agentId}`
    : identity.role
      ? roleLabels[identity.role]
      : '未选择';

  return (
    <div className="flex items-center gap-2">
      {/* 角色快速选择 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1">
            {isAgentMode ? (
              <Bot className="w-4 h-4 text-blue-600" />
            ) : (
              <User className="w-4 h-4" />
            )}
            <span className="max-w-[120px] truncate">{currentLabel}</span>
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5 text-xs font-medium text-gray-500">选择角色</div>
          {(Object.keys(roleLabels) as Role[]).map((role) => (
            <DropdownMenuItem
              key={role}
              onClick={() => handleRoleSelect(role)}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span>{roleLabels[role]}</span>
              </div>
              {identity.mode === 'role' && identity.role === role && (
                <Check className="w-4 h-4 text-green-600" />
              )}
            </DropdownMenuItem>
          ))}
          
          <DropdownMenuSeparator />
          
          <div className="px-2 py-1.5 text-xs font-medium text-gray-500">Agent 模式</div>
          <DropdownMenuItem onClick={handleAgentModeToggle}>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-600" />
              <span>{isAgentMode ? '退出 Agent 模式' : '以 Agent 身份操作'}</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Agent ID 输入 */}
      {showAgentInput && (
        <div className="flex items-center gap-1">
          <Input
            placeholder="输入 agent_id"
            value={agentId}
            onChange={(e) => handleAgentIdChange(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>
      )}

      {/* 当前身份 Badge */}
      {identity.mode === 'role' && identity.role && (
        <Badge variant="outline" className={`h-6 text-xs ${roleColors[identity.role]}`}>
          {roleLabels[identity.role]}
        </Badge>
      )}
      {identity.mode === 'agent' && identity.agentId && (
        <Badge variant="outline" className="h-6 text-xs bg-blue-50 text-blue-700 border-blue-200">
          <Bot className="w-3 h-3 mr-1" />
          {identity.agentId}
        </Badge>
      )}
    </div>
  );
}
