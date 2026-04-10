/**
 * 缓存层 - Redis + 内存缓存降级
 * 
 * 支持：
 * - Redis（生产环境）
 * - 内存缓存（开发/无 Redis 环境）
 * 
 * 缓存策略：
 * - Read-Through: 缓存未命中时从数据源读取并缓存
 * - Write-Through: 写入时同时更新缓存
 */

import { createHash } from 'node:crypto';

// ============ 配置 ============

interface CacheConfig {
  ttl: number;       // 默认 TTL（秒）
  maxSize: number;    // 最大缓存条目数（仅内存缓存）
  redisUrl?: string;  // Redis 连接 URL
}

const DEFAULT_CONFIG: CacheConfig = {
  ttl: 300,          // 5 分钟
  maxSize: 1000,     // 最多 1000 条
};

// ============ 内存缓存实现 ============

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    // 超出大小限制，删除最早的条目
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }

    const expiresAt = Date.now() + (ttl || this.ttl) * 1000;
    this.store.set(key, { value, expiresAt });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  // 清理过期条目
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }

  size(): number {
    return this.store.size;
  }
}

// ============ 缓存服务 ============

class CacheService {
  private memoryCache: MemoryCache<unknown>;
  private redis: unknown = null;
  private useRedis = false;
  private config: CacheConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memoryCache = new MemoryCache<unknown>(this.config.maxSize, this.config.ttl);
    
    // 尝试初始化 Redis
    this.initRedis();
    
    // 定期清理过期缓存（每分钟）
    this.startCleanupTimer();
  }

  private async initRedis(): Promise<void> {
    const redisUrl = this.config.redisUrl || process.env.REDIS_URL;
    
    if (!redisUrl) {
      console.info('[Cache] Redis not configured, using memory cache');
      return;
    }

    try {
      // 动态导入 Redis（避免在没有 Redis 时报错）
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const redis = require('redis');
      
      const client = redis.createClient({ url: redisUrl });
      client.on('error', (err: Error) => {
        console.warn('[Cache] Redis error, falling back to memory:', err.message);
        this.useRedis = false;
      });
      
      await client.connect();
      this.redis = client;
      this.useRedis = true;
      console.info('[Cache] Redis connected successfully');
    } catch (error) {
      console.warn('[Cache] Redis connection failed, using memory cache:', (error as Error).message);
      this.useRedis = false;
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.memoryCache.cleanup();
    }, 60 * 1000);
  }

  /**
   * 生成缓存键
   */
  generateKey(prefix: string, ...parts: string[]): string {
    const hash = createHash('sha256')
      .update(parts.join(':'))
      .digest('hex')
      .substring(0, 16);
    return `${prefix}:${hash}`;
  }

  /**
   * 获取缓存
   */
  async get<T>(key: string): Promise<T | null> {
    if (this.useRedis && this.redis) {
      try {
        const { client } = this.redis as { client: { get: (k: string) => Promise<string | null> } };
        const value = await client.get(key);
        return value ? JSON.parse(value) : null;
      } catch {
        // Redis 失败，降级到内存
      }
    }
    return this.memoryCache.get(key) as T | null;
  }

  /**
   * 设置缓存
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const actualTtl = ttl || this.config.ttl;

    if (this.useRedis && this.redis) {
      try {
        const { client } = this.redis as { client: { setEx: (k: string, t: number, v: string) => Promise<void> } };
        await client.setEx(key, actualTtl, JSON.stringify(value));
        return;
      } catch {
        // Redis 失败，降级到内存
      }
    }
    
    this.memoryCache.set(key, value, actualTtl);
  }

  /**
   * 删除缓存
   */
  async delete(key: string): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        const { client } = this.redis as { client: { del: (k: string) => Promise<number> } };
        await client.del(key);
        return;
      } catch {
        // Redis 失败，降级到内存
      }
    }
    this.memoryCache.delete(key);
  }

  /**
   * 清除前缀匹配的所有缓存
   */
  async clearPrefix(prefix: string): Promise<void> {
    if (this.useRedis && this.redis) {
      try {
        const { client } = this.redis as { client: { keys: (p: string) => Promise<string[]>; del: (k: string) => Promise<number> } };
        const keys = await client.keys(`${prefix}*`);
        for (const key of keys) {
          await client.del(key);
        }
        return;
      } catch {
        // Redis 失败，降级到内存
      }
    }
    // 内存缓存不支持前缀清除，只能全部清除
    this.memoryCache.clear();
  }

  /**
   * Read-Through 模式：缓存未命中时从数据源读取
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // 先尝试从缓存获取
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // 缓存未命中，从数据源获取
    const value = await fetcher();
    
    // 存入缓存
    await this.set(key, value, ttl);
    
    return value;
  }

  /**
   * 获取缓存统计
   */
  getStats(): { type: string; size: number } {
    return {
      type: this.useRedis ? 'redis' : 'memory',
      size: this.useRedis ? -1 : this.memoryCache.size(),
    };
  }

  /**
   * 关闭缓存连接
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    if (this.redis) {
      try {
        const { client } = this.redis as { client: { quit: () => Promise<void> } };
        await client.quit();
      } catch {
        // ignore
      }
    }
  }
}

// ============ 导出单例 ============

export const cache = new CacheService({
  ttl: parseInt(process.env.CACHE_TTL || '300', 10),
  maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
  redisUrl: process.env.REDIS_URL,
});

// ============ 导出类型和辅助函数 ============

export type { CacheConfig };
export { CacheService };
