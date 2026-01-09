/**
 * Cache Manager - 시스템 프롬프트 + 컨텍스트 캐싱
 * Claude API cache_control 지원, TTL 기반 자동 만료
 */

import { MergedContext, MCPContext, ConvMemoryConfig, DEFAULT_CONFIG } from '../types.js';
import { countTokens } from '../utils/tokenizer.js';

export interface CachedContext {
  id: string;
  conversationId: string;
  messages: MCPContext['messages'];
  tokenCount: number;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

export class CacheManager {
  private config: ConvMemoryConfig;
  private cache: Map<string, CachedContext> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<ConvMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * 병합된 컨텍스트를 캐시 가능한 메시지 배열로 변환
   */
  createCacheableContext(context: MergedContext): MCPContext {
    const systemContent = this.formatContextAsSystem(context);
    
    return {
      messages: [
        {
          role: 'system',
          content: systemContent,
        },
      ],
      cacheControl: {
        type: 'ephemeral',
      },
    };
  }

  /**
   * 컨텍스트를 시스템 프롬프트 형식으로 포맷
   */
  private formatContextAsSystem(context: MergedContext): string {
    const parts: string[] = [];

    // 요약
    parts.push('## 대화 컨텍스트 요약');
    parts.push(context.summary);
    parts.push('');

    // 결정 사항
    if (context.decisions.length > 0) {
      parts.push('## 주요 결정 사항');
      for (const decision of context.decisions) {
        const importance = decision.importance === 'critical' ? '🔴' :
                          decision.importance === 'high' ? '🟠' :
                          decision.importance === 'medium' ? '🟡' : '🟢';
        parts.push(`- ${importance} ${decision.description}`);
      }
      parts.push('');
    }

    // 진행 중인 작업
    const activeTasks = context.tasks.filter(t => t.status !== 'completed');
    if (activeTasks.length > 0) {
      parts.push('## 진행 중인 작업');
      for (const task of activeTasks) {
        const status = task.status === 'in_progress' ? '🔄' : '⏳';
        const priority = task.priority === 'high' ? '[높음]' :
                        task.priority === 'medium' ? '[중간]' : '[낮음]';
        parts.push(`- ${status} ${priority} ${task.description}`);
      }
      parts.push('');
    }

    // 코드 변경 사항
    if (context.codeChanges.length > 0) {
      parts.push('## 최근 코드 변경');
      for (const change of context.codeChanges.slice(-10)) {
        const type = change.changeType === 'create' ? '➕' :
                    change.changeType === 'modify' ? '✏️' : '➖';
        parts.push(`- ${type} \`${change.filePath}\`: ${change.description}`);
      }
      parts.push('');
    }

    // 주요 태그
    if (context.tags.length > 0) {
      parts.push('## 관련 키워드');
      const topTags = context.tags.slice(0, 15).map(t => t.tag);
      parts.push(topTags.join(', '));
    }

    return parts.join('\n');
  }

  /**
   * 컨텍스트 캐시 저장
   */
  set(conversationId: string, context: MergedContext): CachedContext {
    const mcpContext = this.createCacheableContext(context);
    const now = Date.now();
    
    const cached: CachedContext = {
      id: context.id,
      conversationId,
      messages: mcpContext.messages,
      tokenCount: countTokens(mcpContext.messages[0].content),
      createdAt: now,
      expiresAt: now + this.config.cacheTtlSeconds * 1000,
      hitCount: 0,
    };

    // 캐시 크기 제한
    if (this.cache.size >= this.config.maxCacheEntries) {
      this.evictOldest();
    }

    this.cache.set(conversationId, cached);
    return cached;
  }

  /**
   * 캐시된 컨텍스트 조회
   */
  get(conversationId: string): CachedContext | null {
    const cached = this.cache.get(conversationId);
    
    if (!cached) return null;
    
    // 만료 확인
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(conversationId);
      return null;
    }

    // 히트 카운트 증가
    cached.hitCount++;
    return cached;
  }

  /**
   * 캐시 무효화
   */
  invalidate(conversationId: string): void {
    this.cache.delete(conversationId);
  }

  /**
   * 전체 캐시 클리어
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 가장 오래된 캐시 항목 제거
   */
  private evictOldest(): void {
    let oldest: { key: string; createdAt: number } | null = null;

    for (const [key, value] of this.cache) {
      if (!oldest || value.createdAt < oldest.createdAt) {
        oldest = { key, createdAt: value.createdAt };
      }
    }

    if (oldest) {
      this.cache.delete(oldest.key);
    }
  }

  /**
   * 만료된 캐시 정리
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now > value.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 정리 타이머 시작
   */
  private startCleanupTimer(): void {
    // 1분마다 정리
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * 정리 타이머 중지
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 캐시 통계
   */
  getStats(): {
    size: number;
    totalHits: number;
    totalTokens: number;
  } {
    let totalHits = 0;
    let totalTokens = 0;

    for (const cached of this.cache.values()) {
      totalHits += cached.hitCount;
      totalTokens += cached.tokenCount;
    }

    return {
      size: this.cache.size,
      totalHits,
      totalTokens,
    };
  }

  /**
   * 오케스트라용 컨텍스트 메시지 배열 생성
   */
  getContextForOrchestrator(conversationId: string): MCPContext['messages'] | null {
    const cached = this.get(conversationId);
    if (!cached) return null;
    return cached.messages;
  }
}

export const cacheManager = new CacheManager();
