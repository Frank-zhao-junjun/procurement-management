import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpAuthContext } from './auth';

export type McpIdentity = McpAuthContext;

const storage = new AsyncLocalStorage<McpAuthContext>();

export function runWithMcpIdentity<T>(identity: McpAuthContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(identity, fn);
}

export function getMcpIdentity(): McpAuthContext | undefined {
  return storage.getStore();
}
