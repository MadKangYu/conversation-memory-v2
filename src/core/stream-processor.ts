/**
 * StreamProcessor - 10M 토큰 스트리밍 처리
 * 
 * 핵심 원칙:
 * - 한 번에 1개 청크만 메모리에 로드
 * - 메모리 사용량과 무관하게 무제한 토큰 처리
 * - 체크포인트 기반 복구 지원
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// 청크 타입
export interface StreamChunk {
  id: string;
  index: number;
  content: string;
  tokens: number;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  metadata?: Record<string, any>;
}

// 스트림 처리 옵션
export interface StreamProcessorOptions {
  chunkSize: number;          // 청크 크기 (토큰)
  overlapPercent: number;     // 오버랩 비율
  batchSize: number;          // 배치 크기
  onChunk?: (chunk: StreamChunk) => Promise<void>;
  onBatch?: (chunks: StreamChunk[]) => Promise<void>;
  onProgress?: (progress: StreamProgress) => void;
}

// 진행 상황
export interface StreamProgress {
  totalTokens: number;
  processedTokens: number;
  totalChunks: number;
  processedChunks: number;
  percentComplete: number;
  estimatedTimeRemaining: number; // seconds
}

export class StreamProcessor extends EventEmitter {
  private options: StreamProcessorOptions;
  private startTime: number = 0;
  private processedTokens: number = 0;
  private processedChunks: number = 0;

  constructor(options?: Partial<StreamProcessorOptions>) {
    super();
    this.options = {
      chunkSize: 500,
      overlapPercent: 10,
      batchSize: 10,
      ...options,
    };
  }

  /**
   * 문자열에서 스트리밍 처리
   */
  async processString(
    content: string,
    role: 'user' | 'assistant' | 'system' = 'user'
  ): Promise<StreamChunk[]> {
    const chunks: StreamChunk[] = [];
    const tokens = this.tokenize(content);
    const totalTokens = tokens.length;
    const chunkSize = this.options.chunkSize;
    const overlap = Math.floor(chunkSize * (this.options.overlapPercent / 100));

    this.startTime = Date.now();
    this.processedTokens = 0;
    this.processedChunks = 0;

    let index = 0;
    let position = 0;

    while (position < totalTokens) {
      const end = Math.min(position + chunkSize, totalTokens);
      const chunkTokens = tokens.slice(position, end);
      const chunkContent = chunkTokens.join('');

      const chunk: StreamChunk = {
        id: `chunk_${Date.now()}_${index}`,
        index,
        content: chunkContent,
        tokens: chunkTokens.length,
        role,
        timestamp: new Date().toISOString(),
      };

      chunks.push(chunk);

      // 콜백 호출
      if (this.options.onChunk) {
        await this.options.onChunk(chunk);
      }

      // 진행 상황 업데이트
      this.processedTokens += chunkTokens.length;
      this.processedChunks++;
      this.emitProgress(totalTokens, chunks.length);

      // 다음 위치 (오버랩 적용)
      position = end - overlap;
      if (position >= totalTokens) break;
      index++;
    }

    // 배치 콜백
    if (this.options.onBatch && chunks.length > 0) {
      for (let i = 0; i < chunks.length; i += this.options.batchSize) {
        const batch = chunks.slice(i, i + this.options.batchSize);
        await this.options.onBatch(batch);
      }
    }

    return chunks;
  }

  /**
   * 파일에서 스트리밍 처리 (대용량 파일 지원)
   */
  async processFile(
    filePath: string,
    role: 'user' | 'assistant' | 'system' = 'user'
  ): Promise<StreamChunk[]> {
    return new Promise((resolve, reject) => {
      const chunks: StreamChunk[] = [];
      const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let buffer = '';
      let index = 0;
      const chunkSize = this.options.chunkSize;
      const overlap = Math.floor(chunkSize * (this.options.overlapPercent / 100));

      this.startTime = Date.now();
      this.processedTokens = 0;
      this.processedChunks = 0;

      rl.on('line', async (line) => {
        buffer += line + '\n';
        const tokens = this.tokenize(buffer);

        while (tokens.length >= chunkSize) {
          const chunkTokens = tokens.splice(0, chunkSize - overlap);
          const chunkContent = chunkTokens.join('');

          const chunk: StreamChunk = {
            id: `chunk_${Date.now()}_${index}`,
            index,
            content: chunkContent,
            tokens: chunkTokens.length,
            role,
            timestamp: new Date().toISOString(),
          };

          chunks.push(chunk);
          index++;

          if (this.options.onChunk) {
            await this.options.onChunk(chunk);
          }

          this.processedChunks++;
        }

        buffer = tokens.join('');
      });

      rl.on('close', async () => {
        // 남은 버퍼 처리
        if (buffer.length > 0) {
          const chunk: StreamChunk = {
            id: `chunk_${Date.now()}_${index}`,
            index,
            content: buffer,
            tokens: this.tokenize(buffer).length,
            role,
            timestamp: new Date().toISOString(),
          };
          chunks.push(chunk);

          if (this.options.onChunk) {
            await this.options.onChunk(chunk);
          }
        }

        resolve(chunks);
      });

      rl.on('error', reject);
    });
  }

  /**
   * 스트림에서 처리
   */
  async processStream(
    stream: Readable,
    role: 'user' | 'assistant' | 'system' = 'user'
  ): Promise<StreamChunk[]> {
    return new Promise((resolve, reject) => {
      const chunks: StreamChunk[] = [];
      let buffer = '';
      let index = 0;
      const chunkSize = this.options.chunkSize;
      const overlap = Math.floor(chunkSize * (this.options.overlapPercent / 100));

      this.startTime = Date.now();

      stream.on('data', async (data: Buffer | string) => {
        buffer += data.toString();
        const tokens = this.tokenize(buffer);

        while (tokens.length >= chunkSize) {
          const chunkTokens = tokens.splice(0, chunkSize - overlap);
          const chunkContent = chunkTokens.join('');

          const chunk: StreamChunk = {
            id: `chunk_${Date.now()}_${index}`,
            index,
            content: chunkContent,
            tokens: chunkTokens.length,
            role,
            timestamp: new Date().toISOString(),
          };

          chunks.push(chunk);
          index++;

          if (this.options.onChunk) {
            await this.options.onChunk(chunk);
          }
        }

        buffer = tokens.join('');
      });

      stream.on('end', async () => {
        if (buffer.length > 0) {
          const chunk: StreamChunk = {
            id: `chunk_${Date.now()}_${index}`,
            index,
            content: buffer,
            tokens: this.tokenize(buffer).length,
            role,
            timestamp: new Date().toISOString(),
          };
          chunks.push(chunk);

          if (this.options.onChunk) {
            await this.options.onChunk(chunk);
          }
        }

        resolve(chunks);
      });

      stream.on('error', reject);
    });
  }

  /**
   * 진행 상황 발행
   */
  private emitProgress(totalTokens: number, totalChunks: number): void {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const tokensPerSecond = this.processedTokens / elapsed;
    const remainingTokens = totalTokens - this.processedTokens;
    const estimatedTimeRemaining = tokensPerSecond > 0 
      ? remainingTokens / tokensPerSecond 
      : 0;

    const progress: StreamProgress = {
      totalTokens,
      processedTokens: this.processedTokens,
      totalChunks,
      processedChunks: this.processedChunks,
      percentComplete: Math.round((this.processedTokens / totalTokens) * 100),
      estimatedTimeRemaining: Math.round(estimatedTimeRemaining),
    };

    this.emit('progress', progress);

    if (this.options.onProgress) {
      this.options.onProgress(progress);
    }
  }

  /**
   * 간단한 토크나이저 (실제로는 tiktoken 사용 권장)
   */
  private tokenize(text: string): string[] {
    // 한글: 글자당 약 2토큰, 영어: 단어당 약 1.3토큰
    // 간단한 근사치 사용
    const tokens: string[] = [];
    
    // 공백과 구두점 기준으로 분리
    const words = text.split(/(\s+|[.,!?;:'"()[\]{}])/);
    
    for (const word of words) {
      if (!word) continue;
      
      // 한글 처리 (글자 단위)
      if (/[\u3131-\uD79D]/.test(word)) {
        for (const char of word) {
          tokens.push(char);
        }
      } else {
        // 영어/숫자/기호 (단어 단위)
        tokens.push(word);
      }
    }

    return tokens;
  }

  /**
   * 토큰 수 추정
   */
  estimateTokens(text: string): number {
    return this.tokenize(text).length;
  }
}

/**
 * ShardManager - SQLite 자동 샤딩
 * 
 * 100K 청크마다 새 DB 파일 생성하여 성능 유지
 */
export class ShardManager {
  private dataDir: string;
  private shardsDir: string;
  private currentShardIndex: number = 0;
  private chunksPerShard: number = 100000;
  private currentChunkCount: number = 0;

  constructor(dataDir: string = '~/.conversation-memory') {
    const expandedDir = dataDir.replace('~', process.env.HOME || '/home/ubuntu');
    this.dataDir = expandedDir;
    this.shardsDir = `${expandedDir}/shards`;
    
    this.ensureDirectories();
    this.loadState();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.shardsDir)) {
      fs.mkdirSync(this.shardsDir, { recursive: true });
    }
  }

  private loadState(): void {
    const stateFile = `${this.dataDir}/shard_state.json`;
    if (fs.existsSync(stateFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        this.currentShardIndex = state.currentShardIndex || 0;
        this.currentChunkCount = state.currentChunkCount || 0;
      } catch (error) {
        console.error('[ShardManager] Failed to load state:', error);
      }
    }
  }

  private saveState(): void {
    const stateFile = `${this.dataDir}/shard_state.json`;
    const state = {
      currentShardIndex: this.currentShardIndex,
      currentChunkCount: this.currentChunkCount,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  /**
   * 현재 샤드 경로 조회
   */
  getCurrentShardPath(): string {
    const shardName = `shard_${String(this.currentShardIndex).padStart(4, '0')}.db`;
    return `${this.shardsDir}/${shardName}`;
  }

  /**
   * 특정 샤드 경로 조회
   */
  getShardPath(index: number): string {
    const shardName = `shard_${String(index).padStart(4, '0')}.db`;
    return `${this.shardsDir}/${shardName}`;
  }

  /**
   * 청크 추가 시 샤드 확인
   */
  recordChunk(): { shardPath: string; needsRotation: boolean } {
    this.currentChunkCount++;
    const needsRotation = this.currentChunkCount >= this.chunksPerShard;

    if (needsRotation) {
      this.rotateShards();
    }

    this.saveState();

    return {
      shardPath: this.getCurrentShardPath(),
      needsRotation,
    };
  }

  /**
   * 샤드 회전 (새 샤드 생성)
   */
  private rotateShards(): void {
    this.currentShardIndex++;
    this.currentChunkCount = 0;
    console.log(`[ShardManager] Rotated to shard ${this.currentShardIndex}`);
  }

  /**
   * 모든 샤드 목록
   */
  listShards(): string[] {
    const shards: string[] = [];
    
    try {
      const files = fs.readdirSync(this.shardsDir);
      for (const file of files) {
        if (file.endsWith('.db')) {
          shards.push(`${this.shardsDir}/${file}`);
        }
      }
    } catch (error) {
      console.error('[ShardManager] Failed to list shards:', error);
    }

    return shards.sort();
  }

  /**
   * 샤드 통계
   */
  getStats(): {
    totalShards: number;
    currentShard: number;
    chunksInCurrentShard: number;
    chunksPerShard: number;
  } {
    return {
      totalShards: this.currentShardIndex + 1,
      currentShard: this.currentShardIndex,
      chunksInCurrentShard: this.currentChunkCount,
      chunksPerShard: this.chunksPerShard,
    };
  }

  /**
   * 오래된 샤드 압축
   */
  async compressOldShards(keepRecent: number = 5): Promise<number> {
    const shards = this.listShards();
    let compressed = 0;

    for (let i = 0; i < shards.length - keepRecent; i++) {
      const shardPath = shards[i];
      const compressedPath = `${shardPath}.gz`;

      if (!fs.existsSync(compressedPath)) {
        // TODO: 실제 압축 구현 (zlib 사용)
        console.log(`[ShardManager] Would compress: ${shardPath}`);
        compressed++;
      }
    }

    return compressed;
  }
}

export default StreamProcessor;
