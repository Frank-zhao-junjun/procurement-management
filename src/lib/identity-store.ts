/**
 * 身份存储模块
 * 存储 actor 和 role，持久化到 localStorage
 * 支持 identity-changed 事件通知
 */

export type Role = 'requester' | 'buyer' | 'manager';

export interface Identity {
  actor: string;
  role: Role;
}

const STORAGE_KEY = 'procurement-identity';
const EVENT_NAME = 'identity-changed';

// 默认身份
const DEFAULT_IDENTITY: Identity = {
  actor: 'web:requester',
  role: 'requester',
};

/**
 * 获取当前身份
 */
export function getIdentity(): Identity {
  if (typeof window === 'undefined') return DEFAULT_IDENTITY;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Identity;
      // 验证格式
      if (parsed.actor && parsed.role) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  return DEFAULT_IDENTITY;
}

/**
 * 设置身份
 */
export function setIdentity(identity: Identity): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  
  // 触发事件
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: identity }));
}

/**
 * 设置 actor
 */
export function setActor(actor: string): void {
  const current = getIdentity();
  setIdentity({ ...current, actor });
}

/**
 * 设置 role
 */
export function setRole(role: Role): void {
  const current = getIdentity();
  setIdentity({ ...current, role });
}

/**
 * 监听身份变化
 */
export function onIdentityChanged(callback: (identity: Identity) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    callback((e as CustomEvent<Identity>).detail);
  };

  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

/**
 * 获取身份请求头
 */
export function getIdentityHeaders(): Record<string, string> {
  const identity = getIdentity();
  return {
    'X-Actor': identity.actor,
    'X-Role': identity.role,
  };
}

// 角色标签
export const ROLE_LABELS: Record<Role, string> = {
  requester: '需求人',
  buyer: '采购人',
  manager: '审批人',
};
