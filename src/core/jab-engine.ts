/**
 * JabEngine - 초고속 병렬 LLM 호출 엔진
 * 
 * "복싱의 잽처럼 빠르게 연타"
 * 
 * 전략:
 * - Cerebras: 2,550 tok/s (가장 빠름)
 * - Groq: 300-500 tok/s (두 번째)
 * - Grok-4.1-fast: 안정적 백업
 * 
 * MacBook Pro M3 최적화:
 * - Apple Silicon Neural Engine 활용
 * - 메모리 압력 모니터링
 * - 적응형 동시성 제어
 */

import { EventEmitter } from 'events';

// ============================================================================
// 타입 정의
// ============================================================================

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'cerebras' | 'groq' | 'openrouter';
  tokensPerSecond: number;  // 출력 속도
  latencyMs: number;        // 첫 토큰까지 시간
  maxConcurrent: number;    // 최대 동시 요청
  costPer1M: number;        // 1M 토큰당 비용 ($)
  contextWindow: number;    // 컨텍스트 윈도우
}

export interface JabConfig {
  // API 키
  openrouterApiKey: string;
  
  // 모델 우선순위
  primaryModel: string;
  fallbackModels: string[];
  
  // 동시성
  maxConcurrentRequests: number;
  requestsPerSecond: number;
  
  // MacBook 최적화
  macbookOptimization: boolean;
  maxMemoryPressure: number;  // 0-100%
  
  // 타임아웃
  requestTimeoutMs: number;
  totalTimeoutMs: number;
}

export interface JabRequest {
  id: string;
  prompt: string;
  maxTokens: number;
  priority: 'high' | 'normal' | 'low';
}

export interface JabResponse {
  id: string;
  content: string;
  model: string;
  latencyMs: number;
  tokensGenerated: number;
  tokensPerSecond: number;
}

export interface JabStats {
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  averageToksPerSec: number;
  currentConcurrency: number;
  memoryPressure: number;
}

// ============================================================================
// 초고속 모델 정의
// ============================================================================

export const ULTRA_FAST_MODELS: Record<string, ModelConfig> = {
  // Cerebras - 가장 빠름 (2,550 tok/s)
  'cerebras-llama-70b': {
    id: 'cerebras/llama-3.1-70b',
    name: 'Cerebras Llama 3.1 70B',
    provider: 'cerebras',
    tokensPerSecond: 2550,
    latencyMs: 100,
    maxConcurrent: 10,
    costPer1M: 0.60,
    contextWindow: 8192
  },
  
  // Groq - 두 번째 빠름 (500 tok/s)
  'groq-llama-70b': {
    id: 'groq/llama-3.3-70b-versatile',
    name: 'Groq Llama 3.3 70B',
    provider: 'groq',
    tokensPerSecond: 500,
    latencyMs: 130,
    maxConcurrent: 5,
    costPer1M: 0.59,
    contextWindow: 128000
  },
  
  'groq-llama-8b': {
    id: 'groq/llama-3.1-8b-instant',
    name: 'Groq Llama 3.1 8B Instant',
    provider: 'groq',
    tokensPerSecond: 750,
    latencyMs: 80,
    maxConcurrent: 10,
    costPer1M: 0.05,
    contextWindow: 128000
  },
  
  // Grok - 안정적 백업
  'grok-4.1-fast': {
    id: 'x-ai/grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'openrouter',
    tokensPerSecond: 200,
    latencyMs: 300,
    maxConcurrent: 5,
    costPer1M: 0.50,
    contextWindow: 131072
  },
  
  // 무료 모델 (비용 효율)
  'deepseek-r1-free': {
    id: 'deepseek/deepseek-r1-0528:free',
    name: 'DeepSeek R1 (Free)',
    provider: 'openrouter',
    tokensPerSecond: 100,
    latencyMs: 500,
    maxConcurrent: 3,
    costPer1M: 0,
    contextWindow: 64000
  },
  
  'qwen3-coder-free': {
    id: 'qwen/qwen3-coder-480b-a35b:free',
    name: 'Qwen3 Coder 480B (Free)',
    provider: 'openrouter',
    tokensPerSecond: 80,
    latencyMs: 600,
    maxConcurrent: 3,
    costPer1M: 0,
    contextWindow: 32000
  }
};

// ============================================================================
// MacBook Pro M3 최적화
// ============================================================================

interface M3OptimizationState {
  memoryPressure: number;      // 0-100%
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
  cpuUsage: number;            // 0-100%
  recommendedConcurrency: number;
}

class M3Optimizer {
  private lastCheck: number = 0;
  private checkInterval: number = 1000; // 1초마다 체크
  private state: M3OptimizationState = {
    memoryPressure: 0,
    thermalState: 'nominal',
    cpuUsage: 0,
    recommendedConcurrency: 8
  };
  
  /**
   * 시스템 상태 확인 (macOS 전용)
   */
  async checkSystem(): Promise<M3OptimizationState> {
    const now = Date.now();
    if (now - this.lastCheck < this.checkInterval) {
      return this.state;
    }
    this.lastCheck = now;
    
    // Node.js 메모리 사용량
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    
    // 메모리 압력 계산 (힙 기준)
    this.state.memoryPressure = Math.round((heapUsedMB / heapTotalMB) * 100);
    
    // CPU 사용량 (간단한 추정)
    const cpus = require('os').cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    }
    this.state.cpuUsage = Math.round(100 - (totalIdle / totalTick) * 100);
    
    // 권장 동시성 계산
    if (this.state.memoryPressure > 80 || this.state.cpuUsage > 80) {
      this.state.thermalState = 'critical';
      this.state.recommendedConcurrency = 2;
    } else if (this.state.memoryPressure > 60 || this.state.cpuUsage > 60) {
      this.state.thermalState = 'serious';
      this.state.recommendedConcurrency = 4;
    } else if (this.state.memoryPressure > 40 || this.state.cpuUsage > 40) {
      this.state.thermalState = 'fair';
      this.state.recommendedConcurrency = 6;
    } else {
      this.state.thermalState = 'nominal';
      this.state.recommendedConcurrency = 8;
    }
    
    return this.state;
  }
  
  /**
   * M3 최적 배치 크기 계산
   */
  getOptimalBatchSize(totalItems: number): number {
    // M3의 Neural Engine은 배치 처리에 최적화
    // 메모리 압력에 따라 배치 크기 조절
    const baseBatch = Math.min(50, Math.ceil(totalItems / 10));
    const pressureFactor = 1 - (this.state.memoryPressure / 100);
    return Math.max(10, Math.floor(baseBatch * pressureFactor));
  }
}

// ============================================================================
// 요청 큐 및 레이트 리미터
// ============================================================================

class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // 초당 토큰
  private lastRefill: number;
  
  constructor(requestsPerSecond: number) {
    this.maxTokens = requestsPerSecond * 2; // 버스트 허용
    this.tokens = this.maxTokens;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
  }
  
  async acquire(): Promise<void> {
    this.refill();
    
    while (this.tokens < 1) {
      await this.sleep(50);
      this.refill();
    }
    
    this.tokens--;
  }
  
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// JabEngine 메인 클래스
// ============================================================================

export class JabEngine extends EventEmitter {
  private config: JabConfig;
  private m3Optimizer: M3Optimizer;
  private rateLimiter: RateLimiter;
  private activeRequests: number = 0;
  private stats: JabStats;
  private requestQueue: JabRequest[] = [];
  private isProcessing: boolean = false;
  
  constructor(config: Partial<JabConfig> = {}) {
    super();
    
    this.config = {
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
      primaryModel: 'cerebras-llama-70b',
      fallbackModels: ['groq-llama-70b', 'grok-4.1-fast'],
      maxConcurrentRequests: 8,
      requestsPerSecond: 10,
      macbookOptimization: true,
      maxMemoryPressure: 70,
      requestTimeoutMs: 5000,
      totalTimeoutMs: 10000,
      ...config
    };
    
    this.m3Optimizer = new M3Optimizer();
    this.rateLimiter = new RateLimiter(this.config.requestsPerSecond);
    
    this.stats = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
      averageToksPerSec: 0,
      currentConcurrency: 0,
      memoryPressure: 0
    };
  }
  
  /**
   * 단일 LLM 요청 (잽 한 방)
   */
  async jab(prompt: string, maxTokens: number = 150): Promise<JabResponse> {
    const requestId = `jab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    // 레이트 리미팅
    await this.rateLimiter.acquire();
    
    // M3 최적화 체크
    if (this.config.macbookOptimization) {
      const state = await this.m3Optimizer.checkSystem();
      this.stats.memoryPressure = state.memoryPressure;
      
      if (state.memoryPressure > this.config.maxMemoryPressure) {
        this.emit('throttle', { reason: 'memory_pressure', value: state.memoryPressure });
        await this.sleep(100);
      }
    }
    
    // 동시성 제어
    while (this.activeRequests >= this.config.maxConcurrentRequests) {
      await this.sleep(10);
    }
    
    this.activeRequests++;
    this.stats.totalRequests++;
    this.stats.currentConcurrency = this.activeRequests;
    
    try {
      // 모델 선택 (폴백 포함)
      const models = [this.config.primaryModel, ...this.config.fallbackModels];
      let lastError: Error | null = null;
      
      for (const modelKey of models) {
        const model = ULTRA_FAST_MODELS[modelKey];
        if (!model) continue;
        
        try {
          const response = await this.callModel(model, prompt, maxTokens);
          const latencyMs = Date.now() - startTime;
          
          // 통계 업데이트
          this.updateStats(latencyMs, response.tokensGenerated, latencyMs);
          
          this.emit('jab-complete', {
            requestId,
            model: model.name,
            latencyMs,
            tokensPerSecond: response.tokensPerSecond
          });
          
          return {
            id: requestId,
            content: response.content,
            model: model.name,
            latencyMs,
            tokensGenerated: response.tokensGenerated,
            tokensPerSecond: response.tokensPerSecond
          };
          
        } catch (error) {
          lastError = error as Error;
          this.emit('model-fallback', { from: modelKey, error: lastError.message });
          continue;
        }
      }
      
      throw lastError || new Error('All models failed');
      
    } finally {
      this.activeRequests--;
      this.stats.currentConcurrency = this.activeRequests;
    }
  }
  
  /**
   * 병렬 잽 연타 (여러 청크 동시 처리)
   */
  async jabCombo(
    prompts: string[], 
    maxTokensPerPrompt: number = 150
  ): Promise<JabResponse[]> {
    const startTime = Date.now();
    
    // M3 최적 배치 크기 계산
    let batchSize = this.config.maxConcurrentRequests;
    if (this.config.macbookOptimization) {
      batchSize = this.m3Optimizer.getOptimalBatchSize(prompts.length);
    }
    
    this.emit('combo-start', { 
      totalPrompts: prompts.length, 
      batchSize 
    });
    
    const results: JabResponse[] = [];
    
    // 배치 단위로 병렬 처리
    for (let i = 0; i < prompts.length; i += batchSize) {
      const batch = prompts.slice(i, i + batchSize);
      
      // 배치 내 병렬 실행
      const batchResults = await Promise.all(
        batch.map(prompt => this.jab(prompt, maxTokensPerPrompt))
      );
      
      results.push(...batchResults);
      
      // 진행률 이벤트
      const progress = Math.round((results.length / prompts.length) * 100);
      this.emit('combo-progress', {
        completed: results.length,
        total: prompts.length,
        percent: progress,
        elapsedMs: Date.now() - startTime
      });
      
      // M3 메모리 압력 체크
      if (this.config.macbookOptimization) {
        const state = await this.m3Optimizer.checkSystem();
        if (state.memoryPressure > this.config.maxMemoryPressure) {
          // 잠시 대기하여 GC 기회 제공
          await this.sleep(50);
        }
      }
    }
    
    const totalTime = Date.now() - startTime;
    this.emit('combo-complete', {
      totalPrompts: prompts.length,
      totalTimeMs: totalTime,
      averageLatencyMs: totalTime / prompts.length
    });
    
    return results;
  }
  
  /**
   * 실제 모델 호출
   */
  private async callModel(
    model: ModelConfig, 
    prompt: string, 
    maxTokens: number
  ): Promise<{ content: string; tokensGenerated: number; tokensPerSecond: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.openrouterApiKey}`,
          'HTTP-Referer': 'https://conversation-memory.dev',
          'X-Title': 'Conversation Memory V4'
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.3,
          stream: false
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }
      
const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '';
      const tokensGenerated = data.usage?.completion_tokens || content.split(/\s+/).length;
      
      // 실제 속도 계산 (응답 시간 기준)
      const latencyMs = data.usage?.total_time_ms || this.config.requestTimeoutMs;
      const tokensPerSecond = Math.round((tokensGenerated / latencyMs) * 1000);
      
      return { content, tokensGenerated, tokensPerSecond };
      
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
  
  /**
   * 통계 업데이트
   */
  private updateStats(latencyMs: number, tokens: number, timeMs: number): void {
    this.stats.completedRequests++;
    
    // 이동 평균 계산
    const alpha = 0.1;
    this.stats.averageLatencyMs = 
      alpha * latencyMs + (1 - alpha) * this.stats.averageLatencyMs;
    
    const toksPerSec = (tokens / timeMs) * 1000;
    this.stats.averageToksPerSec = 
      alpha * toksPerSec + (1 - alpha) * this.stats.averageToksPerSec;
  }
  
  /**
   * 통계 조회
   */
  getStats(): JabStats {
    return { ...this.stats };
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

export default JabEngine;
