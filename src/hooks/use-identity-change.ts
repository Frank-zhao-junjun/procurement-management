'use client';

import { useEffect } from 'react';

/**
 * 监听身份变化的 Hook
 * 身份变化时调用 onIdentityChange 回调
 */
export function useIdentityChange(onIdentityChange: () => void) {
  useEffect(() => {
    const handleChange = () => {
      onIdentityChange();
    };

    window.addEventListener('identity-changed', handleChange);
    return () => window.removeEventListener('identity-changed', handleChange);
  }, [onIdentityChange]);
}
