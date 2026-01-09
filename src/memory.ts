/**
 * ConversationMemory - 메인 메모리 관리 클래스
 * 모든 모듈을 통합하여 단일 인터페이스 제공
 */

import { SQLiteStorage } from './storage/sqlite.js';
import { CacheManager } from './storage/cache.js';
import { Chunker, generateSummaryPrompt } from './core/chunker.js';
import { Merger } from './core/merger.js';
import { indexer } from './core/indexer.js';
import { BackgroundWorker } from './background/worker.js';
import { countTokens } from './utils/tokenizer.js';
import { generateId } from './utils/helpers.js';
import {
  Message,
  Conversation,
  MergedContext,
  SearchResult,
  ConvMemoryConfig,
  DEFAULT_CONFIG,
  StatsOutput,
} from './types.js';

export class ConversationMemory {
  private storage: SQLiteStorage;
  private cacheManager: CacheManager;
  private chunker: Chunker;
  private merger: Merger;
  private worker: BackgroundWorker;
  private config: ConvMemoryConfig;
  private currentConversationId: string | null = null;
  private workerStarted = false;

  constructor(config: Partial<ConvMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.storage = new SQLiteStorage(this.config);
    this.cacheManager = new CacheManager(this.config);
    this.chunker = new Chunker(this.config);
    this.merger = new Merger(this.config);
    
    this.worker = new BackgroundWorker({
      storage: this.storage,
      cacheManager: this.cacheManager,
      config: this.config,
    });
  }

  /**
   * 백그라운드 워커 시작
   */
  async startWorker(): Promise<void> {
    if (!this.workerStarted) {
      this.workerStarted = true;
      // 비동기로 워커 시작 (블로킹하지 않음)
      this.worker.start().catch(console.error);
    }
  }

  /**
   * 새 대화 시작
   */
  startConversation(projectPath: string, title?: string): Conversation {
    // 기존 대화 확인
    const existing = this.storage.getConversationByProject(projectPath);
    if (existing) {
      this.currentConversationId = existing.id;
      this.chunker.reset();
      return existing;
    }

    // 새 대화 생성
    const conversation = this.storage.createConversation(projectPath, title);
    this.currentConversationId = conversation.id;
    this.chunker.reset();
    
    return conversation;
  }

  /**
   * 현재 대화 ID 가져오기
   */
  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  /**
   * 대화 ID 설정
   */
  setCurrentConversation(conversationId: string): void {
    const conversation = this.storage.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`대화를 찾을 수 없습니다: ${conversationId}`);
    }
    this.currentConversationId = conversationId;
    this.chunker.reset();
  }

  /**
   * 메시지 추가
   */
  async addMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    conversationId?: string
  ): Promise<Message> {
    const convId = conversationId || this.currentConversationId;
    if (!convId) {
      throw new Error('대화가 시작되지 않았습니다. startConversation()을 먼저 호출하세요.');
    }

    // 메시지 생성
    const message: Message = {
      id: generateId('msg'),
      conversationId: convId,
      role,
      content,
      timestamp: Date.now(),
      tokenCount: countTokens(content),
    };

    // 저장
    this.storage.saveMessage(message);

    // 청킹 확인
    const chunk = this.chunker.addMessage(message);
    if (chunk) {
      chunk.conversationId = convId;
      this.storage.saveChunk(chunk);
      
      // 캐시 무효화
      this.cacheManager.invalidate(convId);
      
      // 워커 시작 (아직 시작되지 않은 경우)
      await this.startWorker();
    }

    return message;
  }

  /**
   * 현재 대화의 압축된 컨텍스트 조회
   */
  async getContext(conversationId?: string): Promise<string | null> {
    const convId = conversationId || this.currentConversationId;
    if (!convId) return null;

    // 캐시 확인
    const cached = this.cacheManager.get(convId);
    if (cached) {
      return cached.messages[0]?.content || null;
    }

    // 병합된 컨텍스트 조회
    const context = this.storage.getMergedContext(convId);
    if (context) {
      // 캐시 저장
      const cachedContext = this.cacheManager.set(convId, context);
      return cachedContext.messages[0]?.content || null;
    }

    return null;
  }

  /**
   * 오케스트라용 컨텍스트 메시지 배열 조회
   */
  async getContextMessages(conversationId?: string): Promise<Array<{ role: string; content: string }> | null> {
    const convId = conversationId || this.currentConversationId;
    if (!convId) return null;

    const messages = this.cacheManager.getContextForOrchestrator(convId);
    if (messages) return messages;

    // 캐시 미스 시 컨텍스트 로드
    await this.getContext(convId);
    return this.cacheManager.getContextForOrchestrator(convId);
  }

  /**
   * 검색
   */
  search(query: string, conversationId?: string, limit: number = 10): SearchResult[] {
    return this.storage.search({
      query,
      conversationId: conversationId || this.currentConversationId || undefined,
      limit,
    });
  }

  /**
   * 대화 목록 조회
   */
  listConversations(limit: number = 20): Conversation[] {
    return this.storage.listConversations(limit);
  }

  /**
   * 최근 메시지 조회
   */
  getRecentMessages(conversationId?: string, count: number = 10): Message[] {
    const convId = conversationId || this.currentConversationId;
    if (!convId) return [];
    return this.storage.getRecentMessages(convId, count);
  }

  /**
   * 강제 압축 (현재 버퍼 플러시)
   */
  async forceCompress(conversationId?: string): Promise<void> {
    const convId = conversationId || this.currentConversationId;
    if (!convId) return;

    // 버퍼 플러시
    const chunk = this.chunker.flush();
    if (chunk) {
      chunk.conversationId = convId;
      this.storage.saveChunk(chunk);
    }

    // 강제 병합
    await this.worker.forceMerge(convId);

    // 캐시 무효화
    this.cacheManager.invalidate(convId);
  }

  /**
   * 대화 아카이브
   */
  archiveConversation(conversationId?: string): void {
    const convId = conversationId || this.currentConversationId;
    if (!convId) return;
    
    this.storage.archiveConversation(convId);
    this.cacheManager.invalidate(convId);
    
    if (this.currentConversationId === convId) {
      this.currentConversationId = null;
      this.chunker.reset();
    }
  }

  /**
   * 통계 조회
   */
  getStats(): StatsOutput {
    const dbStats = this.storage.getStats();
    const cacheStats = this.cacheManager.getStats();
    const workerStatus = this.worker.getStatus();

    // 압축률 계산 (추정)
    const estimatedOriginalTokens = dbStats.totalTokens * 3; // 원본은 약 3배로 추정
    const savedTokens = estimatedOriginalTokens - dbStats.totalTokens;
    const compressionRatio = dbStats.totalTokens > 0 
      ? (savedTokens / estimatedOriginalTokens) * 100 
      : 0;

    return {
      conversations: dbStats.conversations,
      messages: dbStats.messages,
      chunks: dbStats.chunks,
      mergedContexts: dbStats.mergedContexts,
      totalTokens: dbStats.totalTokens,
      savedTokens,
      compressionRatio,
    };
  }

  /**
   * 버퍼 상태 조회
   */
  getBufferStatus(): { messageCount: number; tokenCount: number; fillPercent: number } {
    return this.chunker.getBufferStatus();
  }

  /**
   * 워커 상태 조회
   */
  getWorkerStatus(): { isRunning: boolean; pendingChunks: number; pendingTasks: number } {
    return this.worker.getStatus();
  }

  /**
   * 대기 중인 요약 프롬프트 조회 (수동 요약용)
   */
  getPendingSummaryPrompts(count: number = 5): Array<{ chunkId: string; prompt: string }> {
    return this.worker.getPendingSummaryPrompts(count);
  }

  /**
   * 수동 요약 제출
   */
  submitSummary(chunkId: string, summaryJson: string): void {
    this.worker.submitSummary(chunkId, summaryJson);
  }

  /**
   * 종료
   */
  async close(): Promise<void> {
    this.worker.stop();
    this.cacheManager.stopCleanupTimer();
    this.storage.close();
  }
}

// 싱글톤 인스턴스 (선택적 사용)
let defaultInstance: ConversationMemory | null = null;

export function getMemory(config?: Partial<ConvMemoryConfig>): ConversationMemory {
  if (!defaultInstance) {
    defaultInstance = new ConversationMemory(config);
  }
  return defaultInstance;
}

export function resetMemory(): void {
  if (defaultInstance) {
    defaultInstance.close();
    defaultInstance = null;
  }
}
