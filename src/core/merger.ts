/**
 * Merger - 구조화된 JSON을 LLM 없이 코드로 병합
 * 중복 제거 (Jaccard 유사도), 태그 가중치 계산 (빈도 + 최신성)
 */

import {
  ChunkSummary,
  MergedContext,
  Decision,
  Task,
  CodeChange,
  TagWeight,
  ConvMemoryConfig,
  DEFAULT_CONFIG,
} from '../types.js';
import { generateId } from '../utils/helpers.js';

export class Merger {
  private config: ConvMemoryConfig;

  constructor(config: Partial<ConvMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 여러 청크 요약을 하나의 컨텍스트로 병합
   */
  merge(
    summaries: ChunkSummary[],
    chunkIds: string[],
    conversationId: string
  ): MergedContext {
    const now = Date.now();

    return {
      id: generateId('ctx'),
      conversationId,
      summary: this.mergeSummaries(summaries),
      decisions: this.mergeDecisions(summaries),
      tasks: this.mergeTasks(summaries),
      codeChanges: this.mergeCodeChanges(summaries),
      tags: this.mergeTags(summaries),
      chunkIds,
      tokenCount: this.estimateTokenCount(summaries),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 요약 텍스트 병합
   */
  private mergeSummaries(summaries: ChunkSummary[]): string {
    // 시간순으로 정렬된 요약들을 연결
    const uniqueSummaries = this.deduplicateStrings(
      summaries.map(s => s.summary),
      this.config.jaccardThreshold
    );

    return uniqueSummaries.join('\n\n');
  }

  /**
   * 결정 사항 병합 및 중복 제거
   */
  private mergeDecisions(summaries: ChunkSummary[]): Decision[] {
    const allDecisions = summaries.flatMap(s => s.decisions);
    const seen = new Map<string, Decision>();

    for (const decision of allDecisions) {
      const key = this.normalizeText(decision.description);
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, decision);
      } else {
        // 더 높은 중요도 유지
        if (this.compareImportance(decision.importance, existing.importance) > 0) {
          seen.set(key, decision);
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 작업 병합 및 상태 업데이트
   */
  private mergeTasks(summaries: ChunkSummary[]): Task[] {
    const allTasks = summaries.flatMap(s => s.tasks);
    const seen = new Map<string, Task>();

    for (const task of allTasks) {
      const key = this.normalizeText(task.description);
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, task);
      } else {
        // 최신 상태로 업데이트
        if (this.compareTaskStatus(task.status, existing.status) > 0) {
          seen.set(key, { ...existing, status: task.status });
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 코드 변경 사항 병합
   */
  private mergeCodeChanges(summaries: ChunkSummary[]): CodeChange[] {
    const allChanges = summaries.flatMap(s => s.codeChanges);
    const seen = new Map<string, CodeChange>();

    for (const change of allChanges) {
      const key = change.filePath;
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, change);
      } else {
        // 최신 변경 유형으로 업데이트
        seen.set(key, {
          ...existing,
          changeType: change.changeType,
          description: `${existing.description}; ${change.description}`,
        });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 태그 병합 및 가중치 계산
   */
  private mergeTags(summaries: ChunkSummary[]): TagWeight[] {
    const tagStats = new Map<string, { frequency: number; lastSeen: number }>();
    const now = Date.now();

    // 각 요약의 태그 수집 (시간순 가정)
    summaries.forEach((summary, index) => {
      const recency = (index + 1) / summaries.length; // 0~1, 최신일수록 높음
      
      for (const tag of summary.tags) {
        const normalizedTag = tag.toLowerCase().trim();
        const existing = tagStats.get(normalizedTag);

        if (existing) {
          tagStats.set(normalizedTag, {
            frequency: existing.frequency + 1,
            lastSeen: Math.max(existing.lastSeen, recency),
          });
        } else {
          tagStats.set(normalizedTag, {
            frequency: 1,
            lastSeen: recency,
          });
        }
      }
    });

    // 가중치 계산: 빈도 * 0.6 + 최신성 * 0.4
    const tagWeights: TagWeight[] = [];
    const maxFrequency = Math.max(...Array.from(tagStats.values()).map(s => s.frequency), 1);

    for (const [tag, stats] of tagStats) {
      const normalizedFrequency = stats.frequency / maxFrequency;
      const weight = normalizedFrequency * 0.6 + stats.lastSeen * 0.4;

      tagWeights.push({
        tag,
        weight,
        frequency: stats.frequency,
        lastSeen: now,
      });
    }

    // 가중치 내림차순 정렬
    return tagWeights.sort((a, b) => b.weight - a.weight);
  }

  /**
   * 문자열 중복 제거 (Jaccard 유사도 기반)
   */
  private deduplicateStrings(strings: string[], threshold: number): string[] {
    const result: string[] = [];

    for (const str of strings) {
      const isDuplicate = result.some(
        existing => this.jaccardSimilarity(existing, str) >= threshold
      );

      if (!isDuplicate) {
        result.push(str);
      }
    }

    return result;
  }

  /**
   * Jaccard 유사도 계산
   */
  private jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(this.tokenize(a));
    const setB = new Set(this.tokenize(b));

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * 텍스트 토큰화
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s.,;:!?()\[\]{}'"]+/)
      .filter(t => t.length > 1);
  }

  /**
   * 텍스트 정규화
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[\s.,;:!?()\[\]{}'"]+/g, ' ')
      .trim();
  }

  /**
   * 중요도 비교
   */
  private compareImportance(a: string, b: string): number {
    const order = { low: 0, medium: 1, high: 2, critical: 3 };
    return (order[a as keyof typeof order] || 0) - (order[b as keyof typeof order] || 0);
  }

  /**
   * 작업 상태 비교
   */
  private compareTaskStatus(a: string, b: string): number {
    const order = { pending: 0, in_progress: 1, completed: 2 };
    return (order[a as keyof typeof order] || 0) - (order[b as keyof typeof order] || 0);
  }

  /**
   * 토큰 수 추정
   */
  private estimateTokenCount(summaries: ChunkSummary[]): number {
    return summaries.reduce((sum, s) => sum + (s.tokenCount || 0), 0);
  }

  /**
   * 두 컨텍스트 병합
   */
  mergeContexts(a: MergedContext, b: MergedContext): MergedContext {
    const summaries: ChunkSummary[] = [
      {
        summary: a.summary,
        decisions: a.decisions,
        tasks: a.tasks,
        codeChanges: a.codeChanges,
        tags: a.tags.map(t => t.tag),
        tokenCount: a.tokenCount,
        createdAt: a.createdAt,
      },
      {
        summary: b.summary,
        decisions: b.decisions,
        tasks: b.tasks,
        codeChanges: b.codeChanges,
        tags: b.tags.map(t => t.tag),
        tokenCount: b.tokenCount,
        createdAt: b.createdAt,
      },
    ];

    return this.merge(
      summaries,
      [...a.chunkIds, ...b.chunkIds],
      a.conversationId
    );
  }
}

export const merger = new Merger();
