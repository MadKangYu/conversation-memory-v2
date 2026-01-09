/**
 * Chunker - 대화를 토큰 기반으로 청킹
 * 500 토큰 단위로 분할, 10% 오버랩으로 연속성 유지
 */

import { Message, Chunk, ChunkStatus, ConvMemoryConfig, DEFAULT_CONFIG } from '../types.js';
import { countTokens } from '../utils/tokenizer.js';
import { generateId } from '../utils/helpers.js';

export class Chunker {
  private config: ConvMemoryConfig;
  private currentBuffer: Message[] = [];
  private currentTokenCount = 0;

  constructor(config: Partial<ConvMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 메시지를 버퍼에 추가하고 청킹 필요 여부 확인
   */
  addMessage(message: Message): Chunk | null {
    this.currentBuffer.push(message);
    this.currentTokenCount += message.tokenCount;

    // 70% 도달 시 청크 생성 (여유 공간 확보)
    const threshold = this.config.chunkTokenThreshold * 0.7;
    
    if (this.currentTokenCount >= threshold) {
      return this.createChunk();
    }

    return null;
  }

  /**
   * 현재 버퍼에서 청크 생성
   */
  private createChunk(): Chunk {
    const overlapCount = Math.ceil(
      this.currentBuffer.length * (this.config.chunkOverlapPercent / 100)
    );

    const chunkMessages = [...this.currentBuffer];
    const chunk: Chunk = {
      id: generateId('chunk'),
      conversationId: chunkMessages[0]?.conversationId || '',
      messages: chunkMessages,
      startIndex: 0,
      endIndex: chunkMessages.length - 1,
      tokenCount: this.currentTokenCount,
      status: 'pending' as ChunkStatus,
      createdAt: Date.now(),
    };

    // 오버랩 메시지 유지
    this.currentBuffer = this.currentBuffer.slice(-overlapCount);
    this.currentTokenCount = this.currentBuffer.reduce(
      (sum, msg) => sum + msg.tokenCount,
      0
    );

    return chunk;
  }

  /**
   * 메시지 배열을 청크로 분할
   */
  createChunks(messages: Message[]): Chunk[] {
    const chunks: Chunk[] = [];
    const conversationId = messages[0]?.conversationId || '';
    
    let currentChunk: Message[] = [];
    let currentTokens = 0;
    let startIndex = 0;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      currentChunk.push(message);
      currentTokens += message.tokenCount;

      if (currentTokens >= this.config.chunkTokenThreshold) {
        chunks.push({
          id: generateId('chunk'),
          conversationId,
          messages: [...currentChunk],
          startIndex,
          endIndex: i,
          tokenCount: currentTokens,
          status: 'pending',
          createdAt: Date.now(),
        });

        // 오버랩 계산
        const overlapCount = Math.ceil(
          currentChunk.length * (this.config.chunkOverlapPercent / 100)
        );
        const overlapMessages = currentChunk.slice(-overlapCount);
        
        currentChunk = overlapMessages;
        currentTokens = overlapMessages.reduce((sum, msg) => sum + msg.tokenCount, 0);
        startIndex = i - overlapCount + 1;
      }
    }

    // 남은 메시지 처리
    if (currentChunk.length > 0) {
      chunks.push({
        id: generateId('chunk'),
        conversationId,
        messages: currentChunk,
        startIndex,
        endIndex: messages.length - 1,
        tokenCount: currentTokens,
        status: 'pending',
        createdAt: Date.now(),
      });
    }

    return chunks;
  }

  /**
   * 현재 버퍼 상태 조회
   */
  getBufferStatus(): { messageCount: number; tokenCount: number; fillPercent: number } {
    return {
      messageCount: this.currentBuffer.length,
      tokenCount: this.currentTokenCount,
      fillPercent: (this.currentTokenCount / this.config.chunkTokenThreshold) * 100,
    };
  }

  /**
   * 버퍼 강제 플러시
   */
  flush(): Chunk | null {
    if (this.currentBuffer.length === 0) {
      return null;
    }

    const chunk: Chunk = {
      id: generateId('chunk'),
      conversationId: this.currentBuffer[0]?.conversationId || '',
      messages: [...this.currentBuffer],
      startIndex: 0,
      endIndex: this.currentBuffer.length - 1,
      tokenCount: this.currentTokenCount,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.currentBuffer = [];
    this.currentTokenCount = 0;

    return chunk;
  }

  /**
   * 버퍼 초기화
   */
  reset(): void {
    this.currentBuffer = [];
    this.currentTokenCount = 0;
  }
}

/**
 * 요약 프롬프트 생성
 */
export function generateSummaryPrompt(chunk: Chunk): string {
  const messagesText = chunk.messages
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n');

  return `다음 대화 내용을 분석하고 구조화된 JSON 형식으로 요약해주세요.

<conversation>
${messagesText}
</conversation>

다음 JSON 스키마에 맞춰 응답해주세요:

{
  "summary": "핵심 내용 요약 (200자 이내)",
  "decisions": [
    {
      "id": "고유 ID",
      "description": "결정 내용",
      "importance": "low|medium|high|critical"
    }
  ],
  "tasks": [
    {
      "id": "고유 ID",
      "description": "작업 내용",
      "status": "pending|in_progress|completed",
      "priority": "low|medium|high"
    }
  ],
  "codeChanges": [
    {
      "filePath": "파일 경로",
      "changeType": "create|modify|delete",
      "description": "변경 설명"
    }
  ],
  "tags": ["키워드", "태그"]
}

중요: JSON만 출력하세요. 다른 텍스트는 포함하지 마세요.`;
}
