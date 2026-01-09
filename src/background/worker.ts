/**
 * Background Worker - 비동기 압축 처리
 * 대기 청크 모니터링, 요약 프롬프트 생성, 비동기 압축 처리
 */

import { SQLiteStorage } from '../storage/sqlite.js';
import { CacheManager } from '../storage/cache.js';
import { Merger } from '../core/merger.js';
import { generateSummaryPrompt } from '../core/chunker.js';
import { indexer } from '../core/indexer.js';
import {
  Chunk,
  ChunkSummary,
  PendingTask,
  ConvMemoryConfig,
  DEFAULT_CONFIG,
} from '../types.js';
import { generateId, delay, getEnvOptional } from '../utils/helpers.js';
import { countTokens } from '../utils/tokenizer.js';
import { LLMProvider, RECOMMENDED_MODELS } from '../providers/llm-provider.js';

export interface WorkerOptions {
  storage: SQLiteStorage;
  cacheManager: CacheManager;
  config?: Partial<ConvMemoryConfig>;
  onSummarize?: (chunk: Chunk, prompt: string) => Promise<string>;
}

export class BackgroundWorker {
  private storage: SQLiteStorage;
  private cacheManager: CacheManager;
  private merger: Merger;
  private config: ConvMemoryConfig;
  private isRunning = false;
  private onSummarize?: (chunk: Chunk, prompt: string) => Promise<string>;

  constructor(options: WorkerOptions) {
    this.storage = options.storage;
    this.cacheManager = options.cacheManager;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.merger = new Merger(this.config);
    this.onSummarize = options.onSummarize;
  }

  /**
   * 워커 시작
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Worker] 백그라운드 워커 시작');

    while (this.isRunning) {
      try {
        await this.processNextTask();
      } catch (error) {
        console.error('[Worker] 작업 처리 오류:', error);
      }

      await delay(this.config.workerIntervalMs);
    }
  }

  /**
   * 워커 중지
   */
  stop(): void {
    this.isRunning = false;
    console.log('[Worker] 백그라운드 워커 중지');
  }

  /**
   * 다음 작업 처리
   */
  private async processNextTask(): Promise<void> {
    // 대기 중인 청크 확인
    const pendingChunks = this.storage.getPendingChunks(1);
    
    if (pendingChunks.length > 0) {
      await this.processSummarizeTask(pendingChunks[0]);
      return;
    }

    // 병합 필요 여부 확인
    await this.checkAndMerge();
  }

  /**
   * 요약 작업 처리
   */
  private async processSummarizeTask(chunk: Chunk): Promise<void> {
    console.log(`[Worker] 청크 요약 시작: ${chunk.id}`);

    try {
      // 상태 업데이트
      this.storage.updateChunkStatus(chunk.id, 'summarizing');

      // 요약 프롬프트 생성
      const prompt = generateSummaryPrompt(chunk);

      // 외부 요약 함수 호출 또는 기본 처리
      let summaryJson: string;
      
      if (this.onSummarize) {
        summaryJson = await this.onSummarize(chunk, prompt);
      } else {
        // 기본: OpenRouter API 호출
        summaryJson = await this.callLLMForSummary(prompt);
      }

      // JSON 파싱
      const summary = this.parseSummaryResponse(summaryJson, chunk);

      // 저장
      this.storage.updateChunkSummary(chunk.id, summary);

      console.log(`[Worker] 청크 요약 완료: ${chunk.id}`);
    } catch (error) {
      console.error(`[Worker] 청크 요약 실패: ${chunk.id}`, error);
      this.storage.updateChunkStatus(chunk.id, 'pending');
    }
  }

  /**
   * LLM API 호출하여 요약 생성 (다중 LLM 지원)
   * 지원 모델: Gemini, Claude, Grok, GPT 등 (OpenRouter 통합)
   */
  private async callLLMForSummary(prompt: string): Promise<string> {
    const apiKey = getEnvOptional('OPENROUTER_API_KEY') || getEnvOptional('OPENAI_API_KEY');
    
    if (!apiKey) {
      // API 키 없으면 폴백 요약 반환
      console.log('[Worker] API 키 없음, 폴백 요약 사용');
      return '{}';
    }

    // LLM 프로바이더 생성 (모델 우선순위: 설정 > 무료 모델)
    const model = this.config.compressionModel || 'google/gemini-2.0-flash-exp:free';
    
    const llmProvider = new LLMProvider({
      provider: 'openrouter',
      model,
      apiKey,
      maxTokens: 1000,
      temperature: 0.3,
    });

    try {
      const response = await llmProvider.complete([
        { role: 'user', content: prompt },
      ]);

      console.log(`[Worker] LLM 요약 완료 (모델: ${model}, 비용: $${response.cost?.toFixed(6) || 0})`);
      return response.content;
    } catch (error) {
      // 첫 번째 모델 실패 시 폴백 모델 시도
      console.error(`[Worker] ${model} 실패, 폴백 모델 시도`);
      
      const fallbackModels = [
        'google/gemini-flash-1.5',
        'openai/gpt-4o-mini',
        'anthropic/claude-3-5-haiku-20241022',
      ];

      for (const fallbackModel of fallbackModels) {
        try {
          llmProvider.setModel(fallbackModel);
          const response = await llmProvider.complete([
            { role: 'user', content: prompt },
          ]);
          console.log(`[Worker] 폴백 모델 성공: ${fallbackModel}`);
          return response.content;
        } catch {
          continue;
        }
      }

      throw error;
    }
  }

  /**
   * 사용 가능한 요약 모델 목록 조회
   */
  static getAvailableModels(): typeof RECOMMENDED_MODELS.summarization {
    return RECOMMENDED_MODELS.summarization;
  }

  /**
   * 요약 응답 파싱
   */
  private parseSummaryResponse(json: string, chunk: Chunk): ChunkSummary {
    try {
      // JSON 블록 추출
      const jsonMatch = json.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON을 찾을 수 없습니다');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 인덱서로 추가 태그 추출
      const chunkText = chunk.messages.map(m => m.content).join('\n');
      const extractedTags = indexer.extractTags(chunkText);

      return {
        summary: parsed.summary || '',
        decisions: parsed.decisions || [],
        tasks: parsed.tasks || [],
        codeChanges: parsed.codeChanges || [],
        tags: [...new Set([...(parsed.tags || []), ...extractedTags])],
        tokenCount: countTokens(parsed.summary || ''),
        createdAt: Date.now(),
      };
    } catch (error) {
      console.error('[Worker] 요약 파싱 실패:', error);
      
      // 폴백: 기본 요약 생성
      const chunkText = chunk.messages.map(m => m.content).join('\n');
      const extractedTags = indexer.extractTags(chunkText);

      return {
        summary: `대화 청크 (${chunk.messages.length}개 메시지)`,
        decisions: [],
        tasks: [],
        codeChanges: [],
        tags: extractedTags,
        tokenCount: 10,
        createdAt: Date.now(),
      };
    }
  }

  /**
   * 병합 필요 여부 확인 및 실행
   */
  private async checkAndMerge(): Promise<void> {
    // 각 대화별로 요약된 청크 확인
    const conversations = this.storage.listConversations(10);

    for (const conv of conversations) {
      const summarizedChunks = this.storage.getSummarizedChunks(conv.id);

      if (summarizedChunks.length >= this.config.mergeThreshold) {
        await this.mergeChunks(conv.id, summarizedChunks);
      }
    }
  }

  /**
   * 청크 병합
   */
  private async mergeChunks(conversationId: string, chunks: Chunk[]): Promise<void> {
    console.log(`[Worker] 청크 병합 시작: ${conversationId} (${chunks.length}개)`);

    try {
      const summaries = chunks
        .filter(c => c.summary)
        .map(c => c.summary!);

      const chunkIds = chunks.map(c => c.id);

      // 병합
      const mergedContext = this.merger.merge(summaries, chunkIds, conversationId);

      // 저장
      this.storage.saveMergedContext(mergedContext);

      // 청크 상태 업데이트
      for (const chunk of chunks) {
        this.storage.updateChunkStatus(chunk.id, 'merged');
      }

      // 캐시 갱신
      this.cacheManager.set(conversationId, mergedContext);

      console.log(`[Worker] 청크 병합 완료: ${conversationId}`);
    } catch (error) {
      console.error(`[Worker] 청크 병합 실패: ${conversationId}`, error);
    }
  }

  /**
   * 수동 요약 제출 (외부에서 요약 결과 제출)
   */
  submitSummary(chunkId: string, summaryJson: string): void {
    const chunks = this.storage.getPendingChunks(100);
    const chunk = chunks.find(c => c.id === chunkId);

    if (!chunk) {
      throw new Error(`청크를 찾을 수 없습니다: ${chunkId}`);
    }

    const summary = this.parseSummaryResponse(summaryJson, chunk);
    this.storage.updateChunkSummary(chunkId, summary);
  }

  /**
   * 대기 중인 요약 프롬프트 조회
   */
  getPendingSummaryPrompts(count: number = 5): Array<{ chunkId: string; prompt: string }> {
    const chunks = this.storage.getPendingChunks(count);
    return chunks.map(chunk => ({
      chunkId: chunk.id,
      prompt: generateSummaryPrompt(chunk),
    }));
  }

  /**
   * 강제 병합 실행
   */
  async forceMerge(conversationId: string): Promise<void> {
    const chunks = this.storage.getSummarizedChunks(conversationId);
    if (chunks.length > 0) {
      await this.mergeChunks(conversationId, chunks);
    }
  }

  /**
   * 워커 상태 조회
   */
  getStatus(): {
    isRunning: boolean;
    pendingChunks: number;
    pendingTasks: number;
  } {
    return {
      isRunning: this.isRunning,
      pendingChunks: this.storage.getPendingChunks(100).length,
      pendingTasks: this.storage.getPendingTaskCount(),
    };
  }
}
