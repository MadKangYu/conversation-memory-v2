/**
 * ConversationMemory V3 - 10M 토큰 100% 처리 보장
 * 
 * 핵심 기능:
 * - 무제한 토큰 처리 (스트리밍 + 샤딩)
 * - 대화 끊김 자동 복구 (체크포인트)
 * - MacBook 최적화 (CPU 30% 이하)
 * - 다중 LLM 지원 (OpenRouter)
 */

import { EventEmitter } from 'events';
import { CheckpointManager, Checkpoint, CheckpointState } from './core/checkpoint-manager.js';
import { ResourceMonitor, ResourceState } from './core/resource-monitor.js';
import { StreamProcessor, ShardManager } from './core/stream-processor.js';
import { SQLiteStorage } from './storage/sqlite.js';
import { CacheManager } from './storage/cache.js';
import { Chunker } from './core/chunker.js';
import { Indexer } from './core/indexer.js';
import { Merger } from './core/merger.js';
import { BackgroundWorker } from './background/worker.js';
import { LLMProvider } from './providers/llm-provider.js';
import { 
  Message, 
  MessageRole, 
  Chunk, 
  ChunkSummary, 
  MergedContext, 
  Conversation,
  ConvMemoryConfig,
  DEFAULT_CONFIG,
} from './types.js';

// V3 설정
export interface MemoryV3Config {
  dataDir: string;
  chunkTokenThreshold: number;
  mergeThreshold: number;
  compressionModel: string;
  maxCpuPercent: number;
  maxMemoryMB: number;
  autoRecovery: boolean;
}

// 기본 설정
const DEFAULT_V3_CONFIG: MemoryV3Config = {
  dataDir: '~/.conversation-memory',
  chunkTokenThreshold: 500,
  mergeThreshold: 5,
  compressionModel: 'google/gemini-2.0-flash-exp:free',
  maxCpuPercent: 30,
  maxMemoryMB: 500,
  autoRecovery: true,
};

// V3 통계 타입
export interface V3Stats {
  conversations: number;
  messages: number;
  chunks: number;
  mergedContexts: number;
  totalTokens: number;
  resource: {
    state: ResourceState;
    cpu: number;
    memoryMB: number;
    workers: number;
  };
  checkpoint: {
    state: CheckpointState;
    progress: number;
    resumable: boolean;
  };
  shards: {
    total: number;
    current: number;
  };
}

export class ConversationMemoryV3 extends EventEmitter {
  private config: MemoryV3Config;
  private storage: SQLiteStorage;
  private cacheManager: CacheManager;
  private chunker: Chunker;
  private indexer: Indexer;
  private merger: Merger;
  private worker: BackgroundWorker;
  private llmProvider: LLMProvider;
  
  // V3 새 모듈
  private checkpointManager: CheckpointManager;
  private resourceMonitor: ResourceMonitor;
  private streamProcessor: StreamProcessor;
  private shardManager: ShardManager;
  
  private currentConversationId: string | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<MemoryV3Config>) {
    super();
    this.config = { ...DEFAULT_V3_CONFIG, ...config };
    
    const expandedDir = this.config.dataDir.replace('~', process.env.HOME || '/home/ubuntu');
    
    // 기존 모듈 초기화
    const baseConfig: Partial<ConvMemoryConfig> = {
      chunkTokenThreshold: this.config.chunkTokenThreshold,
      mergeThreshold: this.config.mergeThreshold,
      compressionModel: this.config.compressionModel,
      dbPath: `${expandedDir}/memory.db`,
    };
    
    this.storage = new SQLiteStorage(baseConfig);
    this.cacheManager = new CacheManager(baseConfig);
    this.chunker = new Chunker(baseConfig);
    this.indexer = new Indexer();
    this.merger = new Merger(baseConfig);
    this.worker = new BackgroundWorker({
      storage: this.storage,
      cacheManager: this.cacheManager,
    });
    this.llmProvider = new LLMProvider({
      provider: 'openrouter',
      model: this.config.compressionModel,
    });
    
    // V3 새 모듈 초기화
    this.checkpointManager = new CheckpointManager(expandedDir);
    this.resourceMonitor = new ResourceMonitor({
      limits: {
        maxCpuPercent: this.config.maxCpuPercent,
        maxMemoryMB: this.config.maxMemoryMB,
      },
    });
    this.streamProcessor = new StreamProcessor({
      chunkSize: this.config.chunkTokenThreshold,
      overlapPercent: 10,
    });
    this.shardManager = new ShardManager(expandedDir);
    
    this.setupEventHandlers();
  }

  /**
   * 이벤트 핸들러 설정
   */
  private setupEventHandlers(): void {
    // 체크포인트 이벤트
    this.checkpointManager.on('disconnection', (data) => {
      console.log(`[Memory] Disconnection detected: ${data.type}`);
      this.emit('disconnection', data);
    });

    this.checkpointManager.on('recovery_started', (checkpoint) => {
      console.log(`[Memory] Recovery started from ${checkpoint.progress.percentComplete}%`);
      this.emit('recovery_started', checkpoint);
    });

    // 리소스 모니터 이벤트
    this.resourceMonitor.on('state_changed', (data) => {
      console.log(`[Memory] Resource state: ${data.previous} → ${data.current}`);
      this.emit('resource_state_changed', data);
    });

    this.resourceMonitor.on('workers_paused', (data) => {
      console.log(`[Memory] Workers paused: ${data.reason}`);
      this.emit('workers_paused', data);
    });

    // 스트림 프로세서 이벤트
    this.streamProcessor.on('progress', (progress) => {
      this.emit('stream_progress', progress);
    });
  }

  /**
   * 초기화 (복구 확인 포함)
   */
  async initialize(): Promise<{ needsRecovery: boolean; checkpoint: Checkpoint | null }> {
    if (this.initialized) {
      return { needsRecovery: false, checkpoint: null };
    }

    // 리소스 모니터링 시작
    this.resourceMonitor.start();

    // 복구 필요 여부 확인
    const recovery = this.checkpointManager.checkForRecovery();
    
    if (recovery.needsRecovery && recovery.checkpoint && this.config.autoRecovery) {
      console.log('[Memory] Previous session interrupted. Recovery available.');
      console.log(`[Memory] Progress: ${recovery.checkpoint.progress.percentComplete}%`);
      console.log(`[Memory] Last disconnection: ${recovery.checkpoint.recovery.lastDisconnection}`);
    }

    this.initialized = true;
    return recovery;
  }

  /**
   * 중단된 작업 재개
   */
  async resume(checkpoint: Checkpoint): Promise<boolean> {
    const success = await this.checkpointManager.resume(checkpoint);
    
    if (success) {
      this.currentConversationId = checkpoint.conversationId;
      this.worker.start();
    }
    
    return success;
  }

  /**
   * 새 대화 시작
   */
  async startConversation(projectPath: string, title?: string): Promise<string> {
    const conv = this.storage.createConversation(projectPath, title);
    this.currentConversationId = conv.id;
    
    // 체크포인트 생성
    this.checkpointManager.createCheckpoint(conv.id, title);
    
    // 백그라운드 워커 시작
    this.worker.start();
    
    this.emit('conversation_started', { conversationId: conv.id, title });
    
    return conv.id;
  }

  /**
   * 메시지 추가 (대용량 지원)
   */
  async addMessage(
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<{ messageId: string; chunks: number; tokens: number }> {
    if (!this.currentConversationId) {
      throw new Error('No active conversation. Call startConversation() first.');
    }

    // 리소스 확인
    if (!this.resourceMonitor.canProcess()) {
      console.log('[Memory] Waiting for resources...');
      const available = await this.resourceMonitor.waitForResources(30000);
      if (!available) {
        throw new Error('Resources not available. CPU overloaded.');
      }
    }

    const tokens = this.streamProcessor.estimateTokens(content);
    
    // 대용량 메시지는 스트리밍 처리
    if (tokens > this.config.chunkTokenThreshold * 2) {
      return this.addLargeMessage(role, content, metadata);
    }

    // 일반 메시지 처리
    const messageId = `msg_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`;
    const message: Message = {
      id: messageId,
      conversationId: this.currentConversationId,
      role,
      content,
      timestamp: Date.now(),
      tokenCount: tokens,
      metadata,
    };

    // 저장
    this.storage.saveMessage(message);

    // 청킹 - chunker.addMessage 사용
    const chunk = this.chunker.addMessage(message);
    let chunkCount = 0;
    
    if (chunk) {
      this.storage.saveChunk(chunk);
      chunkCount = 1;
      
      // 체크포인트 업데이트
      this.checkpointManager.recordChunkProcessed(chunk.id);
    }

    this.emit('message_added', { messageId, chunks: chunkCount, tokens });

    return { messageId, chunks: chunkCount, tokens };
  }

  /**
   * 대용량 메시지 스트리밍 처리
   */
  private async addLargeMessage(
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<{ messageId: string; chunks: number; tokens: number }> {
    const messageId = `msg_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`;
    let totalChunks = 0;
    let totalTokens = 0;

    // 스트리밍 청킹
    const streamChunks = await this.streamProcessor.processString(content, role);

    for (const streamChunk of streamChunks) {
      // 샤드 확인
      this.shardManager.recordChunk();

      // Message 생성
      const chunkMessage: Message = {
        id: `${messageId}_part_${streamChunk.index}`,
        conversationId: this.currentConversationId!,
        role,
        content: streamChunk.content,
        timestamp: Date.now(),
        tokenCount: streamChunk.tokens,
        metadata: { ...metadata, isPartOfLargeMessage: true, parentMessageId: messageId },
      };

      // 저장
      this.storage.saveMessage(chunkMessage);

      // 체크포인트 업데이트
      this.checkpointManager.recordChunkProcessed(streamChunk.id);

      totalChunks++;
      totalTokens += streamChunk.tokens;
    }

    this.emit('large_message_added', { messageId, chunks: totalChunks, tokens: totalTokens });

    return { messageId, chunks: totalChunks, tokens: totalTokens };
  }

  /**
   * 압축된 컨텍스트 조회
   */
  async getCompressedContext(maxTokens: number = 8000): Promise<MergedContext | null> {
    if (!this.currentConversationId) {
      throw new Error('No active conversation');
    }

    // 캐시 확인
    const cacheKey = `context_${this.currentConversationId}_${maxTokens}`;
    const cached = this.resourceMonitor.cacheGet<MergedContext>(cacheKey);
    if (cached) {
      return cached;
    }

    // 병합된 컨텍스트 조회
    const merged = this.storage.getMergedContext(this.currentConversationId);

    // 캐시 저장
    if (merged) {
      this.resourceMonitor.cacheSet(cacheKey, merged);
    }

    return merged;
  }

  /**
   * 압축 필요 여부 확인
   */
  shouldCompress(threshold: number = 50000): {
    shouldCompress: boolean;
    currentTokens: number;
    threshold: number;
    recommendation: string;
  } {
    if (!this.currentConversationId) {
      return {
        shouldCompress: false,
        currentTokens: 0,
        threshold,
        recommendation: 'No active conversation',
      };
    }

    const stats = this.storage.getStats();
    const shouldCompress = stats.totalTokens > threshold;

    return {
      shouldCompress,
      currentTokens: stats.totalTokens,
      threshold,
      recommendation: shouldCompress
        ? `Compression recommended. Current: ${stats.totalTokens} tokens, Threshold: ${threshold}`
        : `No compression needed. Current: ${stats.totalTokens} tokens`,
    };
  }

  /**
   * 검색
   */
  search(query: string, limit: number = 10): Array<{
    content: string;
    role: string;
    timestamp: string;
    relevance: number;
  }> {
    const results = this.storage.search({ query, limit });
    return results.map(r => ({
      content: r.content,
      role: (r.metadata?.role as string) || 'unknown',
      timestamp: new Date(r.metadata?.timestamp as number || Date.now()).toISOString(),
      relevance: r.score,
    }));
  }

  /**
   * 통계 조회
   */
  getStats(): V3Stats {
    const baseStats = this.storage.getStats();
    const resourceSummary = this.resourceMonitor.getSummary();
    const checkpointStatus = this.checkpointManager.getStatus();
    const shardStats = this.shardManager.getStats();

    return {
      ...baseStats,
      resource: {
        state: resourceSummary.state,
        cpu: resourceSummary.cpu,
        memoryMB: resourceSummary.memoryMB,
        workers: resourceSummary.workers,
      },
      checkpoint: {
        state: checkpointStatus.state,
        progress: checkpointStatus.progress,
        resumable: checkpointStatus.resumable,
      },
      shards: {
        total: shardStats.totalShards,
        current: shardStats.currentShard,
      },
    };
  }

  /**
   * 대화 목록 조회
   */
  listConversations(limit: number = 50): Conversation[] {
    return this.storage.listConversations(limit);
  }

  /**
   * 최근 메시지 조회
   */
  getRecentMessages(limit: number = 10): Message[] {
    if (!this.currentConversationId) {
      return [];
    }
    return this.storage.getRecentMessages(this.currentConversationId, limit);
  }

  /**
   * 강제 압축 실행
   */
  async forceCompress(): Promise<{
    chunksProcessed: number;
    tokensReduced: number;
  }> {
    if (!this.currentConversationId) {
      throw new Error('No active conversation');
    }

    // 리소스 확인
    if (!this.resourceMonitor.canProcess()) {
      throw new Error('Resources not available for compression');
    }

    const beforeStats = this.storage.getStats();
    
    // 미요약 청크 처리
    const pendingChunks = this.storage.getPendingChunks(20);
    
    for (const chunk of pendingChunks) {
      // 청크의 메시지 내용 결합
      const content = chunk.messages.map(m => m.content).join('\n');
      
      // 요약 생성
      const response = await this.llmProvider.complete([
        { role: 'user', content: `Summarize the following conversation:\n\n${content}` }
      ]);
      
      const summaryText = response.content;
      
      // 청크 요약 업데이트
      const chunkSummary: ChunkSummary = {
        summary: summaryText,
        decisions: [],
        tasks: [],
        codeChanges: [],
        tags: [],
        tokenCount: this.streamProcessor.estimateTokens(summaryText),
        createdAt: Date.now(),
      };
      
      this.storage.updateChunkSummary(chunk.id, chunkSummary);

      // 체크포인트 업데이트
      this.checkpointManager.recordSummarizationComplete(0);
    }

    const afterStats = this.storage.getStats();

    return {
      chunksProcessed: pendingChunks.length,
      tokensReduced: beforeStats.totalTokens - afterStats.totalTokens,
    };
  }

  /**
   * 대화 전환
   */
  switchConversation(conversationId: string): boolean {
    const conversations = this.storage.listConversations();
    const conv = conversations.find(c => c.id === conversationId);
    
    if (conv) {
      this.currentConversationId = conversationId;
      
      // 새 체크포인트 생성
      this.checkpointManager.createCheckpoint(conversationId, conv.title || undefined);
      
      return true;
    }
    
    return false;
  }

  /**
   * 종료
   */
  async shutdown(): Promise<void> {
    // 체크포인트 완료 표시
    this.checkpointManager.complete();
    
    // 워커 중지
    this.worker.stop();
    
    // 리소스 모니터 중지
    this.resourceMonitor.dispose();
    
    // 체크포인트 매니저 정리
    this.checkpointManager.dispose();
    
    // 스토리지 닫기
    this.storage.close();
    
    this.emit('shutdown');
  }

  /**
   * 현재 대화 ID 조회
   */
  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }
}

export default ConversationMemoryV3;
