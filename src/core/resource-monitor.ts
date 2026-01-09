/**
 * ResourceMonitor - MacBook CPU/메모리/캐싱 최적화
 * 
 * 목표:
 * - CPU 사용률 30% 이하 유지
 * - 메모리 사용량 500MB 이하
 * - 캐시 자동 정리
 * - 적응형 동시성 제어
 */

import * as os from 'os';
import { EventEmitter } from 'events';

// 리소스 사용량 타입
export interface ResourceUsage {
  cpu: {
    usage: number;        // 0-100%
    loadAverage: number[];// 1분, 5분, 15분
    cores: number;
  };
  memory: {
    used: number;         // bytes
    total: number;        // bytes
    usagePercent: number; // 0-100%
    heapUsed: number;     // Node.js heap
    heapTotal: number;
    external: number;
  };
  process: {
    uptime: number;       // seconds
    pid: number;
  };
}

// 리소스 제한 설정
export interface ResourceLimits {
  maxCpuPercent: number;      // 최대 CPU 사용률 (기본 30%)
  maxMemoryMB: number;        // 최대 메모리 (기본 500MB)
  maxHeapMB: number;          // 최대 힙 (기본 256MB)
  warningThreshold: number;   // 경고 임계값 (기본 0.8 = 80%)
  criticalThreshold: number;  // 위험 임계값 (기본 0.95 = 95%)
}

// 적응형 동시성 설정
export interface AdaptiveConcurrency {
  minWorkers: number;         // 최소 워커 수 (기본 1)
  maxWorkers: number;         // 최대 워커 수 (기본 4)
  currentWorkers: number;     // 현재 워커 수
  scaleUpThreshold: number;   // 증가 임계값 (CPU < 30%)
  scaleDownThreshold: number; // 감소 임계값 (CPU > 50%)
  pauseThreshold: number;     // 일시 중지 임계값 (CPU > 80%)
}

// 캐시 설정
export interface CacheConfig {
  maxSize: number;            // 최대 항목 수
  maxMemoryMB: number;        // 최대 메모리
  ttlMs: number;              // TTL (ms)
  cleanupIntervalMs: number;  // 정리 간격
}

// 리소스 상태
export type ResourceState = 'normal' | 'warning' | 'critical' | 'paused';

export class ResourceMonitor extends EventEmitter {
  private limits: ResourceLimits;
  private concurrency: AdaptiveConcurrency;
  private cacheConfig: CacheConfig;
  private monitorInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastCpuInfo: os.CpuInfo[] | null = null;
  private state: ResourceState = 'normal';
  
  // LRU 캐시
  private cache: Map<string, { value: any; timestamp: number; size: number }> = new Map();
  private cacheMemoryUsed: number = 0;

  constructor(options?: {
    limits?: Partial<ResourceLimits>;
    concurrency?: Partial<AdaptiveConcurrency>;
    cache?: Partial<CacheConfig>;
  }) {
    super();

    // 기본 리소스 제한 (MacBook 최적화)
    this.limits = {
      maxCpuPercent: 30,
      maxMemoryMB: 500,
      maxHeapMB: 256,
      warningThreshold: 0.8,
      criticalThreshold: 0.95,
      ...options?.limits,
    };

    // 기본 동시성 설정
    this.concurrency = {
      minWorkers: 1,
      maxWorkers: Math.min(4, os.cpus().length),
      currentWorkers: 2,
      scaleUpThreshold: 30,
      scaleDownThreshold: 50,
      pauseThreshold: 80,
      ...options?.concurrency,
    };

    // 기본 캐시 설정
    this.cacheConfig = {
      maxSize: 100,
      maxMemoryMB: 50,
      ttlMs: 5 * 60 * 1000, // 5분
      cleanupIntervalMs: 60 * 1000, // 1분
      ...options?.cache,
    };
  }

  /**
   * 모니터링 시작
   */
  start(intervalMs: number = 1000): void {
    this.stop();

    // CPU 정보 초기화
    this.lastCpuInfo = os.cpus();

    // 리소스 모니터링
    this.monitorInterval = setInterval(() => {
      this.checkResources();
    }, intervalMs);

    // 캐시 정리
    this.cleanupInterval = setInterval(() => {
      this.cleanupCache();
    }, this.cacheConfig.cleanupIntervalMs);

    console.log('[ResourceMonitor] Started');
  }

  /**
   * 모니터링 중지
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 리소스 확인 및 조정
   */
  private checkResources(): void {
    const usage = this.getResourceUsage();
    const previousState = this.state;

    // CPU 기반 상태 판단
    if (usage.cpu.usage > this.concurrency.pauseThreshold) {
      this.state = 'critical';
    } else if (usage.cpu.usage > this.concurrency.scaleDownThreshold) {
      this.state = 'warning';
    } else {
      this.state = 'normal';
    }

    // 메모리 기반 상태 판단 (더 심각한 상태 우선)
    const memoryUsageMB = usage.memory.heapUsed / (1024 * 1024);
    if (memoryUsageMB > this.limits.maxMemoryMB * this.limits.criticalThreshold) {
      this.state = 'critical';
    } else if (memoryUsageMB > this.limits.maxMemoryMB * this.limits.warningThreshold) {
      if (this.state !== 'critical') this.state = 'warning';
    }

    // 상태 변경 시 이벤트 발생
    if (this.state !== previousState) {
      this.emit('state_changed', { previous: previousState, current: this.state, usage });
    }

    // 적응형 동시성 조정
    this.adjustConcurrency(usage);

    // 위험 상태 시 강제 GC 및 캐시 정리
    if (this.state === 'critical') {
      this.emergencyCleanup();
    }

    this.emit('resource_check', { state: this.state, usage });
  }

  /**
   * 리소스 사용량 조회
   */
  getResourceUsage(): ResourceUsage {
    const cpus = os.cpus();
    const memUsage = process.memoryUsage();

    // CPU 사용률 계산
    let cpuUsage = 0;
    if (this.lastCpuInfo) {
      let totalIdle = 0;
      let totalTick = 0;

      for (let i = 0; i < cpus.length; i++) {
        const cpu = cpus[i];
        const lastCpu = this.lastCpuInfo[i];

        const idle = cpu.times.idle - lastCpu.times.idle;
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0) -
                     Object.values(lastCpu.times).reduce((a, b) => a + b, 0);

        totalIdle += idle;
        totalTick += total;
      }

      cpuUsage = totalTick > 0 ? ((totalTick - totalIdle) / totalTick) * 100 : 0;
    }

    this.lastCpuInfo = cpus;

    return {
      cpu: {
        usage: Math.round(cpuUsage * 10) / 10,
        loadAverage: os.loadavg(),
        cores: cpus.length,
      },
      memory: {
        used: os.totalmem() - os.freemem(),
        total: os.totalmem(),
        usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
      },
      process: {
        uptime: process.uptime(),
        pid: process.pid,
      },
    };
  }

  /**
   * 적응형 동시성 조정
   */
  private adjustConcurrency(usage: ResourceUsage): void {
    const previousWorkers = this.concurrency.currentWorkers;

    if (usage.cpu.usage < this.concurrency.scaleUpThreshold) {
      // CPU 여유 있음 - 워커 증가
      this.concurrency.currentWorkers = Math.min(
        this.concurrency.currentWorkers + 1,
        this.concurrency.maxWorkers
      );
    } else if (usage.cpu.usage > this.concurrency.scaleDownThreshold) {
      // CPU 부하 높음 - 워커 감소
      this.concurrency.currentWorkers = Math.max(
        this.concurrency.currentWorkers - 1,
        this.concurrency.minWorkers
      );
    }

    if (usage.cpu.usage > this.concurrency.pauseThreshold) {
      // CPU 과부하 - 일시 중지
      this.concurrency.currentWorkers = 0;
      this.emit('workers_paused', { reason: 'cpu_overload', usage: usage.cpu.usage });
    }

    if (previousWorkers !== this.concurrency.currentWorkers) {
      this.emit('concurrency_changed', {
        previous: previousWorkers,
        current: this.concurrency.currentWorkers,
        reason: usage.cpu.usage < this.concurrency.scaleUpThreshold ? 'scale_up' : 'scale_down',
      });
    }
  }

  /**
   * 현재 권장 워커 수 조회
   */
  getRecommendedWorkers(): number {
    return this.concurrency.currentWorkers;
  }

  /**
   * 작업 실행 가능 여부 확인
   */
  canProcess(): boolean {
    return this.state !== 'critical' && this.concurrency.currentWorkers > 0;
  }

  /**
   * 작업 실행 대기 (CPU 여유 생길 때까지)
   */
  async waitForResources(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (!this.canProcess()) {
      if (Date.now() - startTime > timeoutMs) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return true;
  }

  // ==================== 캐시 관리 ====================

  /**
   * 캐시에 저장
   */
  cacheSet(key: string, value: any): boolean {
    const size = this.estimateSize(value);
    const maxMemoryBytes = this.cacheConfig.maxMemoryMB * 1024 * 1024;

    // 메모리 초과 시 오래된 항목 제거
    while (
      this.cacheMemoryUsed + size > maxMemoryBytes ||
      this.cache.size >= this.cacheConfig.maxSize
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cacheDelete(oldestKey);
      } else {
        break;
      }
    }

    // 여전히 공간 부족 시 저장 실패
    if (this.cacheMemoryUsed + size > maxMemoryBytes) {
      return false;
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      size,
    });
    this.cacheMemoryUsed += size;

    return true;
  }

  /**
   * 캐시에서 조회
   */
  cacheGet<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // TTL 확인
    if (Date.now() - entry.timestamp > this.cacheConfig.ttlMs) {
      this.cacheDelete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * 캐시에서 삭제
   */
  cacheDelete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.cacheMemoryUsed -= entry.size;
    this.cache.delete(key);
    return true;
  }

  /**
   * 캐시 정리 (만료된 항목 제거)
   */
  private cleanupCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheConfig.ttlMs) {
        this.cacheDelete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.emit('cache_cleanup', { cleaned, remaining: this.cache.size });
    }
  }

  /**
   * 캐시 전체 삭제
   */
  cacheClear(): void {
    this.cache.clear();
    this.cacheMemoryUsed = 0;
    this.emit('cache_cleared');
  }

  /**
   * 캐시 상태 조회
   */
  getCacheStats(): {
    size: number;
    memoryUsedMB: number;
    maxMemoryMB: number;
    hitRate: number;
  } {
    return {
      size: this.cache.size,
      memoryUsedMB: Math.round((this.cacheMemoryUsed / (1024 * 1024)) * 100) / 100,
      maxMemoryMB: this.cacheConfig.maxMemoryMB,
      hitRate: 0, // TODO: 히트율 추적 구현
    };
  }

  /**
   * 객체 크기 추정
   */
  private estimateSize(obj: any): number {
    const str = JSON.stringify(obj);
    return str ? str.length * 2 : 0; // UTF-16 기준
  }

  // ==================== 긴급 정리 ====================

  /**
   * 긴급 정리 (위험 상태 시)
   */
  private emergencyCleanup(): void {
    console.warn('[ResourceMonitor] Emergency cleanup triggered');

    // 캐시 50% 정리
    const targetSize = Math.floor(this.cache.size / 2);
    let removed = 0;

    for (const key of this.cache.keys()) {
      if (removed >= targetSize) break;
      this.cacheDelete(key);
      removed++;
    }

    // 강제 GC (가능한 경우)
    if (global.gc) {
      global.gc();
      console.log('[ResourceMonitor] Forced GC executed');
    }

    this.emit('emergency_cleanup', { cacheRemoved: removed });
  }

  /**
   * 현재 상태 조회
   */
  getState(): ResourceState {
    return this.state;
  }

  /**
   * 상태 요약
   */
  getSummary(): {
    state: ResourceState;
    cpu: number;
    memoryMB: number;
    workers: number;
    cacheSize: number;
  } {
    const usage = this.getResourceUsage();
    return {
      state: this.state,
      cpu: usage.cpu.usage,
      memoryMB: Math.round(usage.memory.heapUsed / (1024 * 1024)),
      workers: this.concurrency.currentWorkers,
      cacheSize: this.cache.size,
    };
  }

  /**
   * 리소스 해제
   */
  dispose(): void {
    this.stop();
    this.cacheClear();
    this.removeAllListeners();
  }
}

export default ResourceMonitor;
