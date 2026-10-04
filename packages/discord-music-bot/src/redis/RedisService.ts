import { Redis as RedisClient } from "ioredis";
import { randomUUID } from "node:crypto";
import type { Logger } from "../utils/logger.js";

interface MemoryValue {
  value: string;
  expiresAt: number;
}

export interface CacheService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class RedisService implements CacheService {
  private client?: RedisClient;
  private readonly memory = new Map<string, MemoryValue>();
  private readonly localLocks = new Set<string>();
  private connected = false;

  constructor(private readonly url: string | undefined, private readonly logger: Logger) {}

  async connect(): Promise<void> {
    if (!this.url) {
      this.logger.warn("REDIS_URL is not set; using bounded in-process cache and rate limits");
      return;
    }
    const client = new RedisClient(this.url, {
      lazyConnect: true,
      connectTimeout: 4_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 10_000),
    });
    client.on("ready", () => {
      this.connected = true;
      this.logger.info("Redis connection ready");
    });
    client.on("close", () => {
      this.connected = false;
      this.logger.warn("Redis connection closed; in-process fallback is active");
    });
    client.on("error", (error: Error) => {
      this.connected = false;
      this.logger.warn({ err: error }, "Redis unavailable; in-process fallback is active");
    });
    this.client = client;
    try {
      await client.connect();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      this.logger.warn({ err: error }, "Initial Redis connection failed; continuing with in-process fallback");
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }
    return this.memoryGet(key);
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (this.connected && this.client) {
      try {
        await this.client.set(key, value, "EX", ttlSeconds);
        return;
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }
    this.memorySet(key, value, ttlSeconds * 1000);
  }

  async delete(key: string): Promise<void> {
    if (this.connected && this.client) {
      try {
        await this.client.del(key);
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }
    this.memory.delete(key);
  }

  async consumeCooldown(key: string, ttlMs: number): Promise<boolean> {
    if (ttlMs <= 0) return true;
    if (this.connected && this.client) {
      try {
        return (await this.client.set(key, "1", "PX", ttlMs, "NX")) === "OK";
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }
    if (this.memoryGet(key)) return false;
    this.memorySet(key, "1", ttlMs);
    return true;
  }

  async hitRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    if (this.connected && this.client) {
      try {
        const count = await this.client.incr(key);
        if (count === 1) await this.client.pexpire(key, windowMs);
        return count <= limit;
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }
    const current = Number(this.memoryGet(key) ?? "0");
    if (current >= limit) return false;
    this.memorySet(key, String(current + 1), windowMs);
    return true;
  }

  async withLock<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    let acquired = false;
    if (this.connected && this.client) {
      try {
        acquired = (await this.client.set(`lock:${key}`, token, "PX", ttlMs, "NX")) === "OK";
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }
    if (!this.connected || !this.client) {
      if (this.localLocks.has(key)) throw new Error("This operation is already running.");
      this.localLocks.add(key);
      acquired = true;
    }
    if (!acquired) throw new Error("This operation is already running.");
    try {
      return await work();
    } finally {
      this.localLocks.delete(key);
      if (this.connected && this.client) {
        try {
          await this.client.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            `lock:${key}`,
            token,
          );
        } catch (error) {
          this.noteRedisFailure(error);
        }
      }
    }
  }

  async healthcheck(): Promise<boolean> {
    if (!this.client || !this.connected) return false;
    try {
      return (await this.client.ping()) === "PONG";
    } catch (error) {
      this.noteRedisFailure(error);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
    this.connected = false;
    this.memory.clear();
  }

  private memoryGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private memorySet(key: string, value: string, ttlMs: number): void {
    if (this.memory.size > 10_000) this.pruneMemory();
    this.memory.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  private pruneMemory(): void {
    const now = Date.now();
    for (const [key, entry] of this.memory) if (entry.expiresAt <= now) this.memory.delete(key);
    if (this.memory.size > 10_000) {
      for (const key of this.memory.keys()) {
        this.memory.delete(key);
        if (this.memory.size <= 8_000) break;
      }
    }
  }

  private noteRedisFailure(error: unknown): void {
    this.connected = false;
    this.logger.warn({ err: error }, "Redis operation failed; using in-process fallback");
  }
}