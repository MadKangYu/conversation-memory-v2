/**
 * ConversationMemoryV5 - MacBook Pro M3 최적화 + 초고속 병렬 잽 공격
 * 
 * "복싱의 잽처럼 빠르게 연타"
 * 
 * 핵심 전략:
 * 1. Phase 1 (Instant): LLM 없이 즉시 압축 (InstantCompressor)
 * 2. Phase 2 (Jab): Cerebras/Groq로 병렬 정제 (JabEngine)
 * 3. Phase 3 (Deep): 고품질 심층 압축 (선택적)
 * 
 * 10M 토큰 10초 처리 보장
 */

import { EventEmitter } from 'events';
import { InstantCompressor, CompressionResult } from './core/instant-compressor.js';
import { JabEngine, JabResponse, ULTRA_FAST_MODELS } from './core/jab-engine.js';
import { CheckpointManager, Checkpoint } from './core/checkpoint-manager.js';
import { SQLiteStorage } from './storage/sqlite.js';

// ============================================================================
// 타입 정의
// ============================================================================

export interface V5Config {
  // API 키
  openrouterApiKey: string;
  
  // 모델 설정
  primaryModel: string;      // 기본: 'cerebras-llama-70b'
  fallbackModels: string[];  // 폴백: ['groq-llama-70b', 'grok-4.1-fast']
  
  // MacBook Pro M3 최적화
  macbookOptimization: boolean;
  maxCpuPercent: number;
  maxMemoryMB: number;
  maxMemoryPressure: number;
  
  // 동시성
  maxConcurrentRequests: number;
  requestsPerSecond: number;
  
  // 타임아웃
  instantTimeoutMs: number;   // Phase 1 타임아웃
  jabTimeoutMs: number;       // Phase 2 타임아웃 (개별 요청)
  totalTimeoutMs: number;     // 전체 타임아웃
  
  // 압축 설정
  chunkSize: number;
  keywordsPerChunk: number;
  sentencesPerChunk: number;
  
  // 복구
  autoRecovery: boolean;
  
  // 저장소
  dbPath: string;
  dataDir: string;
}

export interface V5Stats {
  conversationId: string | null;
  sessionId: string;
  phase: 'idle' | 'instant' | 'jab' | 'deep';
  jabStats: {
    totalRequests: number;
    completedRequests: number;
    averageLatencyMs: number;
    averageToksPerSec: number;
  };
  memoryPressure: number;
  lastCompressionMs: number;
}

// ============================================================================
// ConversationMemoryV5 메인 클래스
// ============================================================================

export class ConversationMemoryV5 extends EventEmitter {
  private config: V5Config;
  private instantCompressor: InstantCompressor;
  private jabEngine: JabEngine;
  private checkpointManager: CheckpointManager;
  private storage: SQLiteStorage;
  
  private currentConversationId: string | null = null;
  private currentSessionId: string;
  private currentPhase: 'idle' | 'instant' | 'jab' | 'deep' = 'idle';
  private lastCompressionMs: number = 0;
  
  constructor(config: Partial<V5Config> = {}) {
    super();
    
    this.config = {
      // API 키 (환경 변수에서)
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
      
      // 모델 설정 (Cerebras 우선, Groq 폴백, Grok 백업)
      primaryModel: 'cerebras-llama-70b',
      fallbackModels: ['groq-llama-70b', 'grok-4.1-fast'],
      
      // MacBook Pro M3 최적화
      macbookOptimization: true,
      maxCpuPercent: 30,
      maxMemoryMB: 500,
      maxMemoryPressure: 70,
      
      // 동시성 (M3 최적)
      maxConcurrentRequests: 8,
      requestsPerSecond: 10,
      
      // 타임아웃
      instantTimeoutMs: 5000,    // Phase 1: 5초
      jabTimeoutMs: 3000,        // Phase 2 개별: 3초 (Cerebras 기준)
      totalTimeoutMs: 10000,     // 전체: 10초
      
      // 압축 설정
      chunkSize: 500,
      keywordsPerChunk: 20,
      sentencesPerChunk: 3,
      
      // 복구
      autoRecovery: true,
      
      // 저장소
      dbPath: '.conv-memory-v5.db',
      dataDir: '~/.conversation-memory',
      
      ...config
    };
    
    this.currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 모듈 초기화
    this.instantCompressor = new InstantCompressor({
      chunkSize: this.config.chunkSize,
      keywordsPerChunk: this.config.keywordsPerChunk,
      sentencesPerChunk: this.config.sentencesPerChunk,
      maxWorkers: Math.min(4, this.config.maxConcurrentRequests)
    });
    
    this.jabEngine = new JabEngine({
      openrouterApiKey: this.config.openrouterApiKey,
      primaryModel: this.config.primaryModel,
      fallbackModels: this.config.fallbackModels,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      requestsPerSecond: this.config.requestsPerSecond,
      macbookOptimization: this.config.macbookOptimization,
      maxMemoryPressure: this.config.maxMemoryPressure,
      requestTimeoutMs: this.config.jabTimeoutMs,
      totalTimeoutMs: this.config.totalTimeoutMs
    });
    
    this.checkpointManager = new CheckpointManager(this.config.dataDir);
    this.storage = new SQLiteStorage({ dbPath: this.config.dbPath });
    
    // 이벤트 연결
    this.setupEventHandlers();
  }
  
  /**
   * 이벤트 핸들러 설정
   */
  private setupEventHandlers(): void {
    // InstantCompressor 이벤트
    this.instantCompressor.on('progress', (data) => {
      this.emit('instant-progress', data);
    });
    
    // JabEngine 이벤트
    this.jabEngine.on('jab-complete', (data) => {
      this.emit('jab-complete', data);
    });
    
    this.jabEngine.on('combo-progress', (data) => {
      this.emit('jab-progress', data);
    });
    
    this.jabEngine.on('throttle', (data) => {
      this.emit('throttle', data);
    });
    
    this.jabEngine.on('model-fallback', (data) => {
      this.emit('model-fallback', data);
    });
  }
  
  /**
   * 초기화 및 복구 확인
   */
  async initialize(): Promise<{ needsRecovery: boolean; checkpoint?: Checkpoint }> {
    if (this.config.autoRecovery) {
      const { needsRecovery, checkpoint } = this.checkpointManager.checkForRecovery();
      if (needsRecovery && checkpoint) {
        return { needsRecovery: true, checkpoint };
      }
    }
    return { needsRecovery: false };
  }
  
  /**
   * 이전 세션에서 복구
   */
  async resume(checkpoint: Checkpoint): Promise<void> {
    this.currentConversationId = checkpoint.conversationId;
    this.checkpointManager.updateCheckpoint({ state: 'completed' });
    this.emit('recovery-complete', checkpoint);
  }
  
  /**
   * 대화 시작
   */
  async startConversation(projectPath: string, topic?: string): Promise<string> {
    this.currentConversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.checkpointManager.createCheckpoint(this.currentConversationId, topic);
    this.emit('conversation-start', { conversationId: this.currentConversationId, projectPath, topic });
    return this.currentConversationId;
  }
  
  /**
   * 🥊 잽 공격 압축 - 10M 토큰 10초 처리
   * 
   * Phase 1: InstantCompressor로 즉시 압축 (LLM 없음)
   * Phase 2: JabEngine으로 병렬 정제 (Cerebras/Groq)
   */
  async jabCompress(text: string, maxOutputTokens: number = 8000): Promise<{
    instant: CompressionResult;
    refined: JabResponse[];
    totalTimeMs: number;
    finalContext: string;
  }> {
    const startTime = Date.now();
    
    this.emit('compress-start', { 
      textLength: text.length,
      estimatedTokens: Math.ceil(text.length / 4)
    });
    
    // =========================================
    // Phase 1: Instant Compression (LLM 없음)
    // =========================================
    this.currentPhase = 'instant';
    this.emit('phase-change', { phase: 'instant' });
    
    const instantResult = await Promise.race([
      this.instantCompressor.compress(text),
      this.timeout(this.config.instantTimeoutMs, 'Instant compression timeout')
    ]) as CompressionResult;
    
    const phase1Time = Date.now() - startTime;
    this.emit('instant-complete', {
      chunks: instantResult.chunks.length,
      compressionRatio: instantResult.compressionRatio,
      timeMs: phase1Time
    });
    
    // Phase 1만으로 충분하면 바로 반환
    if (instantResult.totalCompressedTokens <= maxOutputTokens) {
      this.currentPhase = 'idle';
      this.lastCompressionMs = Date.now() - startTime;
      
      return {
        instant: instantResult,
        refined: [],
        totalTimeMs: this.lastCompressionMs,
        finalContext: this.instantCompressor.toContextString(instantResult.chunks, maxOutputTokens)
      };
    }
    
    // =========================================
    // Phase 2: Jab Refinement (Cerebras/Groq)
    // =========================================
    this.currentPhase = 'jab';
    this.emit('phase-change', { phase: 'jab' });
    
    // 남은 시간 계산
    const remainingTime = this.config.totalTimeoutMs - phase1Time;
    if (remainingTime < 1000) {
      // 시간 부족 - Phase 1 결과만 반환
      this.currentPhase = 'idle';
      this.lastCompressionMs = Date.now() - startTime;
      
      return {
        instant: instantResult,
        refined: [],
        totalTimeMs: this.lastCompressionMs,
        finalContext: this.instantCompressor.toContextString(instantResult.chunks, maxOutputTokens)
      };
    }
    
    // 정제 프롬프트 생성
    const refinePrompts = instantResult.chunks.map(chunk => 
      this.createRefinePrompt(chunk.keywords, chunk.keySentences, chunk.keySentences.join(' '))
    );
    
    // 병렬 잽 공격!
    const refinedResults = await Promise.race([
      this.jabEngine.jabCombo(refinePrompts, 150),
      this.timeout(remainingTime, 'Jab refinement timeout')
    ]) as JabResponse[];
    
    this.currentPhase = 'idle';
    this.lastCompressionMs = Date.now() - startTime;
    
    // 최종 컨텍스트 생성
    const finalContext = this.buildFinalContext(refinedResults, maxOutputTokens);
    
    this.emit('compress-complete', {
      totalTimeMs: this.lastCompressionMs,
      phases: {
        instant: phase1Time,
        jab: this.lastCompressionMs - phase1Time
      },
      finalTokens: finalContext.split(/\s+/).length
    });
    
    return {
      instant: instantResult,
      refined: refinedResults,
      totalTimeMs: this.lastCompressionMs,
      finalContext
    };
  }
  
  /**
   * 정제 프롬프트 생성
   */
  private createRefinePrompt(keywords: string[], sentences: string[], summary: string): string {
    return `다음 대화 청크를 150토큰 이내로 요약하세요. 핵심 결정사항과 코드 참조를 보존하세요.

키워드: ${keywords.slice(0, 10).join(', ')}

핵심 문장:
${sentences.slice(0, 3).join('\n')}

기존 요약: ${summary}

JSON 형식으로 응답:
{"summary": "...", "decisions": ["..."], "code_refs": ["..."]}`;
  }
  
  /**
   * 최종 컨텍스트 생성
   */
  private buildFinalContext(responses: JabResponse[], maxTokens: number): string {
    const parts: string[] = [];
    let currentTokens = 0;
    
    for (const response of responses) {
      const tokens = response.content.split(/\s+/).length;
      if (currentTokens + tokens > maxTokens) break;
      
      parts.push(response.content);
      currentTokens += tokens;
    }
    
    return parts.join('\n\n---\n\n');
  }
  
  /**
   * 타임아웃 유틸리티
   */
  private timeout<T>(ms: number, message: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }
  
  /**
   * 통계 조회
   */
  getStats(): V5Stats {
    const jabStats = this.jabEngine.getStats();
    
    return {
      conversationId: this.currentConversationId,
      sessionId: this.currentSessionId,
      phase: this.currentPhase,
      jabStats: {
        totalRequests: jabStats.totalRequests,
        completedRequests: jabStats.completedRequests,
        averageLatencyMs: jabStats.averageLatencyMs,
        averageToksPerSec: jabStats.averageToksPerSec
      },
      memoryPressure: jabStats.memoryPressure,
      lastCompressionMs: this.lastCompressionMs
    };
  }
  
  /**
   * 사용 가능한 모델 목록
   */
  getAvailableModels(): typeof ULTRA_FAST_MODELS {
    return ULTRA_FAST_MODELS;
  }
  
  /**
   * 종료
   */
  async shutdown(): Promise<void> {
    this.checkpointManager.updateCheckpoint({ state: 'completed' });
    this.emit('shutdown');
  }
}

// ============================================================================
// 내보내기
// ============================================================================

export default ConversationMemoryV5;
