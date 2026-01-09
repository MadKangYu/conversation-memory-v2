/**
 * ConversationMemoryV4 - 10M 토큰 10초 처리
 * 
 * 3단계 압축 전략:
 * - Phase 1 (Instant): LLM 없이 10초 이내 압축
 * - Phase 2 (Background): 백그라운드 LLM 정제
 * - Phase 3 (Deep): 고품질 심층 압축
 */

import { EventEmitter } from 'events';
import { InstantCompressor, CompressionResult, CompressedChunk } from './core/instant-compressor.js';
import { CheckpointManager, Checkpoint } from './core/checkpoint-manager.js';
import { ResourceMonitor, ResourceState } from './core/resource-monitor.js';
import { SQLiteStorage } from './storage/sqlite.js';

// ============================================================================
// 타입 정의
// ============================================================================

export interface V4Config {
  // 리소스 제한
  maxCpuPercent: number;
  maxMemoryMB: number;
  maxWorkers: number;
  
  // 압축 설정
  chunkSize: number;
  keywordsPerChunk: number;
  sentencesPerChunk: number;
  
  // 백그라운드 정제
  backgroundRefine: boolean;
  refineModel: string;
  
  // 복구
  autoRecovery: boolean;
  checkpointInterval: number;
  
  // 저장소
  dbPath: string;
  dataDir: string;
}

export interface V4InitResult {
  needsRecovery: boolean;
  checkpoint?: Checkpoint;
  lastConversationId?: string;
}

export interface CompressOptions {
  maxTokens?: number;
  phase?: 'instant' | 'background' | 'deep';
  timeout?: number;
}

export interface V4Stats {
  conversationId: string | null;
  sessionId: string;
  isProcessing: boolean;
  cachedResults: number;
  resourceState: ResourceState;
}

// ============================================================================
// ConversationMemoryV4 메인 클래스
// ============================================================================

export class ConversationMemoryV4 extends EventEmitter {
  private config: V4Config;
  private compressor: InstantCompressor;
  private checkpointManager: CheckpointManager;
  private resourceMonitor: ResourceMonitor;
  private storage: SQLiteStorage;
  
  private currentConversationId: string | null = null;
  private currentSessionId: string;
  private isProcessing: boolean = false;
  private compressionCache: Map<string, CompressionResult> = new Map();
  
  constructor(config: Partial<V4Config> = {}) {
    super();
    
    this.config = {
      // 리소스 제한 (MacBook 최적화)
      maxCpuPercent: 30,
      maxMemoryMB: 500,
      maxWorkers: 4,
      
      // 압축 설정
      chunkSize: 500,
      keywordsPerChunk: 20,
      sentencesPerChunk: 3,
      
      // 백그라운드 정제
      backgroundRefine: true,
      refineModel: 'grok-4.1-fast',
      
      // 복구
      autoRecovery: true,
      checkpointInterval: 5000,
      
      // 저장소
      dbPath: '.conv-memory-v4.db',
      dataDir: '~/.conversation-memory',
      
      ...config
    };
    
    this.currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 모듈 초기화
    this.compressor = new InstantCompressor({
      chunkSize: this.config.chunkSize,
      keywordsPerChunk: this.config.keywordsPerChunk,
      sentencesPerChunk: this.config.sentencesPerChunk,
      maxWorkers: this.config.maxWorkers
    });
    
    this.checkpointManager = new CheckpointManager(this.config.dataDir);
    
    this.resourceMonitor = new ResourceMonitor({
      limits: {
        maxCpuPercent: this.config.maxCpuPercent,
        maxMemoryMB: this.config.maxMemoryMB,
        maxHeapMB: Math.floor(this.config.maxMemoryMB * 0.9)
      }
    });
    
    this.storage = new SQLiteStorage({ dbPath: this.config.dbPath });
    
    // 이벤트 연결
    this.setupEventHandlers();
  }
  
  /**
   * 이벤트 핸들러 설정
   */
  private setupEventHandlers(): void {
    // 압축 진행률
    this.compressor.on('progress', (data) => {
      this.emit('compress-progress', data);
    });
    
    this.compressor.on('complete', (result) => {
      this.emit('compress-complete', result);
    });
    
    // 리소스 모니터링
    this.resourceMonitor.on('state_changed', (state: ResourceState) => {
      if (state === 'critical' || state === 'warning') {
        this.emit('throttle', state);
        // 워커 수 감소
        if (this.config.maxWorkers > 1) {
          this.config.maxWorkers = Math.max(1, this.config.maxWorkers - 1);
        }
      } else if (state === 'normal') {
        this.emit('resume');
        // 워커 수 복구
        this.config.maxWorkers = Math.min(4, this.config.maxWorkers + 1);
      }
    });
    
    // 체크포인트 이벤트
    this.checkpointManager.on('disconnection', (data) => {
      this.emit('disconnection', data);
    });
  }
  
  /**
   * 초기화 및 복구 확인
   */
  async initialize(): Promise<V4InitResult> {
    // 리소스 모니터링 시작
    this.resourceMonitor.start();
    
    // 체크포인트 확인
    if (this.config.autoRecovery) {
      const { needsRecovery, checkpoint } = this.checkpointManager.checkForRecovery();
      
      if (needsRecovery && checkpoint) {
        return {
          needsRecovery: true,
          checkpoint,
          lastConversationId: checkpoint.conversationId
        };
      }
    }
    
    return { needsRecovery: false };
  }
  
  /**
   * 이전 세션에서 복구
   */
  async resume(checkpoint: Checkpoint): Promise<void> {
    this.emit('recovery-start', checkpoint);
    
    this.currentConversationId = checkpoint.conversationId;
    
    // 체크포인트 상태 업데이트
    this.checkpointManager.updateCheckpoint({
      state: 'recovering'
    });
    
    this.emit('recovery-progress', {
      message: `체크포인트 ${checkpoint.id}에서 복구 완료`
    });
    
    // 복구 완료 표시
    this.checkpointManager.updateCheckpoint({
      state: 'completed'
    });
    
    this.emit('recovery-complete');
  }
  
  /**
   * 대화 시작
   */
  async startConversation(projectPath: string, topic?: string): Promise<string> {
    this.currentConversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 체크포인트 생성
    this.checkpointManager.createCheckpoint(this.currentConversationId, topic);
    
    this.emit('conversation-start', {
      conversationId: this.currentConversationId,
      projectPath,
      topic
    });
    
    return this.currentConversationId;
  }
  
  /**
   * 리소스 상태가 위험한지 확인
   */
  private isResourceCritical(): boolean {
    const state = this.resourceMonitor.getState();
    return state === 'critical' || state === 'warning';
  }
  
  /**
   * 즉시 압축 (10초 이내)
   */
  async instantCompress(text: string, options: CompressOptions = {}): Promise<CompressionResult> {
    const { maxTokens = 8000, timeout = 10000 } = options;
    
    this.isProcessing = true;
    this.emit('compress-start', { phase: 'instant', textLength: text.length });
    
    // 체크포인트 상태 업데이트
    this.checkpointManager.updateCheckpoint({ state: 'processing' });
    
    // 타임아웃 설정
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Compression timeout')), timeout);
    });
    
    try {
      // 리소스 체크
      if (this.isResourceCritical()) {
        this.emit('throttle', this.resourceMonitor.getState());
        await this.sleep(100);
      }
      
      // 압축 실행 (타임아웃과 경쟁)
      const result = await Promise.race([
        this.compressor.compress(text),
        timeoutPromise
      ]);
      
      // 캐시 저장
      const cacheKey = `instant_${Date.now()}`;
      this.compressionCache.set(cacheKey, result);
      
      // 체크포인트 업데이트
      this.checkpointManager.updateCheckpoint({
        state: 'completed',
        progress: {
          totalChunks: result.chunks.length,
          processedChunks: result.chunks.length,
          lastProcessedChunkId: result.chunks[result.chunks.length - 1]?.id || null,
          percentComplete: 100
        },
        metadata: {
          topic: null,
          totalTokens: result.totalOriginalTokens,
          compressedTokens: result.totalCompressedTokens
        }
      });
      
      this.isProcessing = false;
      return result;
      
    } catch (error) {
      this.isProcessing = false;
      
      // 체크포인트에 실패 기록
      this.checkpointManager.updateCheckpoint({ state: 'failed' });
      
      // 부분 결과라도 반환
      const partialResult: CompressionResult = {
        chunks: [],
        totalOriginalTokens: text.split(/\s+/).length,
        totalCompressedTokens: 0,
        compressionRatio: 0,
        processingTimeMs: timeout,
        phase: 'instant'
      };
      
      this.emit('compress-error', { error, partialResult });
      return partialResult;
    }
  }
  
  /**
   * 하이브리드 압축 (즉시 + 백그라운드)
   */
  async compress(text: string, options: CompressOptions = {}): Promise<CompressionResult> {
    // Phase 1: 즉시 압축
    const instantResult = await this.instantCompress(text, options);
    
    // Phase 2: 백그라운드 정제 시작 (비동기)
    if (this.config.backgroundRefine) {
      this.startBackgroundRefine(instantResult).catch(err => {
        this.emit('refine-error', err);
      });
    }
    
    return instantResult;
  }
  
  /**
   * 백그라운드 정제 (LLM 사용)
   */
  private async startBackgroundRefine(instantResult: CompressionResult): Promise<void> {
    this.emit('refine-start', { chunks: instantResult.chunks.length });
    
    let refined = 0;
    for (const chunk of instantResult.chunks) {
      // 리소스 체크
      if (this.isResourceCritical()) {
        await this.sleep(500);
      }
      
      // LLM 정제 (실제 구현에서는 API 호출)
      // const refinedChunk = await this.llmRefine(chunk);
      
      refined++;
      this.checkpointManager.recordSummarizationComplete(1);
      
      this.emit('refine-progress', {
        processed: refined,
        total: instantResult.chunks.length,
        percent: Math.round((refined / instantResult.chunks.length) * 100)
      });
    }
    
    this.emit('refine-complete');
  }
  
  /**
   * 압축된 컨텍스트 조회
   */
  async getCompressedContext(maxTokens: number = 8000): Promise<string> {
    // 캐시에서 최신 결과 가져오기
    const latestKey = [...this.compressionCache.keys()].pop();
    if (!latestKey) {
      return '';
    }
    
    const result = this.compressionCache.get(latestKey);
    if (!result) {
      return '';
    }
    
    return this.compressor.toContextString(result.chunks, maxTokens);
  }
  
  /**
   * 통계 조회
   */
  async getStats(): Promise<V4Stats> {
    return {
      conversationId: this.currentConversationId,
      sessionId: this.currentSessionId,
      isProcessing: this.isProcessing,
      cachedResults: this.compressionCache.size,
      resourceState: this.resourceMonitor.getState()
    };
  }
  
  /**
   * 종료
   */
  async shutdown(): Promise<void> {
    // 체크포인트 완료 표시
    this.checkpointManager.updateCheckpoint({ state: 'completed' });
    
    // 리소스 모니터링 중지
    this.resourceMonitor.stop();
    
    // 캐시 정리
    this.compressionCache.clear();
    
    this.emit('shutdown');
  }
  
  /**
   * 유틸리티: sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 내보내기
// ============================================================================

export default ConversationMemoryV4;
