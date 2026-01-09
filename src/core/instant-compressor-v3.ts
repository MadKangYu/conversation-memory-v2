/**
 * InstantCompressor V3 - 10M 토큰 2초 처리 극한 최적화
 * 
 * V2 대비 추가 최적화:
 * 1. 청킹 단계 제거 → 직접 스트리밍 처리
 * 2. 키워드 추출 → 해시 기반 샘플링 (전체 스캔 제거)
 * 3. 문장 추출 → 위치 기반 (첫 N개만)
 * 4. SimHash → 스킵 (이미 99.9% 압축)
 * 5. 메모리 재사용 (GC 최소화)
 */

import { EventEmitter } from 'events';

// ============================================================================
// 타입 정의
// ============================================================================

export interface CompressionResultV3 {
  finalText: string;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  compressionRatio: number;
  processingTimeMs: number;
}

export interface InstantCompressorV3Config {
  sampleRate?: number;      // 샘플링 비율 (0.01 = 1%)
  maxKeywords?: number;     // 최대 키워드 수
  maxSentences?: number;    // 최대 문장 수
}

// ============================================================================
// 초고속 처리 함수 (모든 최적화 적용)
// ============================================================================

export class InstantCompressorV3 extends EventEmitter {
  private sampleRate: number;
  private maxKeywords: number;
  private maxSentences: number;
  
  // 재사용 버퍼 (GC 최소화)
  private keywordFreq: Map<string, number> = new Map();
  
  constructor(config: InstantCompressorV3Config = {}) {
    super();
    this.sampleRate = config.sampleRate ?? 0.01;  // 1% 샘플링
    this.maxKeywords = config.maxKeywords ?? 50;
    this.maxSentences = config.maxSentences ?? 20;
  }
  
  /**
   * 초고속 압축 (단일 패스)
   */
  compress(text: string): CompressionResultV3 {
    const startTime = performance.now();
    
    const len = text.length;
    let tokenCount = 0;
    let inWord = false;
    
    // 재사용 버퍼 초기화
    this.keywordFreq.clear();
    
    const sentences: string[] = [];
    let sentenceStart = 0;
    
    // 샘플링 간격 계산
    const sampleInterval = Math.max(1, Math.floor(1 / this.sampleRate));
    let sampleCounter = 0;
    
    let wordStart = 0;
    let wordEnd = 0;
    
    // 단일 패스로 모든 처리
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i);
      
      // 공백 체크 (space, newline, tab)
      const isSpace = c === 32 || c === 10 || c === 13 || c === 9;
      
      // 문장 종료 체크 (. ! ? 。)
      const isSentenceEnd = c === 46 || c === 33 || c === 63 || c === 12290;
      
      if (isSpace) {
        if (inWord) {
          tokenCount++;
          
          // 샘플링된 단어만 키워드 후보로
          sampleCounter++;
          if (sampleCounter >= sampleInterval) {
            sampleCounter = 0;
            const word = text.slice(wordStart, wordEnd + 1).toLowerCase();
            if (word.length > 2 && word.length < 20) {
              this.keywordFreq.set(word, (this.keywordFreq.get(word) || 0) + 1);
            }
          }
          
          inWord = false;
        }
      } else {
        if (!inWord) {
          wordStart = i;
          inWord = true;
        }
        wordEnd = i;
      }
      
      // 문장 추출 (최대 N개)
      if (isSentenceEnd && sentences.length < this.maxSentences) {
        const sentence = text.slice(sentenceStart, i + 1).trim();
        if (sentence.length > 30 && sentence.length < 500) {
          sentences.push(sentence);
        }
        sentenceStart = i + 1;
      }
    }
    
    // 마지막 단어 처리
    if (inWord) {
      tokenCount++;
    }
    
    // 상위 키워드 추출
    const keywords = Array.from(this.keywordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxKeywords)
      .map(([word]) => word);
    
    // 최종 텍스트 생성
    const finalText = [
      `[키워드: ${keywords.join(', ')}]`,
      '',
      sentences.join(' ')
    ].join('\n');
    
    const compressedTokens = this.fastTokenCount(finalText);
    
    return {
      finalText,
      totalOriginalTokens: tokenCount,
      totalCompressedTokens: compressedTokens,
      compressionRatio: 1 - (compressedTokens / tokenCount),
      processingTimeMs: performance.now() - startTime
    };
  }
  
  /**
   * 빠른 토큰 카운터
   */
  private fastTokenCount(text: string): number {
    let count = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      const isSpace = c === 32 || c === 10 || c === 13 || c === 9;
      if (!isSpace && !inWord) {
        count++;
        inWord = true;
      } else if (isSpace) {
        inWord = false;
      }
    }
    return count;
  }
}

// ============================================================================
// 더 극한의 최적화: 청크 병렬 처리 버전
// ============================================================================

export class InstantCompressorV3Parallel extends EventEmitter {
  private sampleRate: number;
  private maxKeywords: number;
  private maxSentences: number;
  private chunkSize: number;
  
  constructor(config: InstantCompressorV3Config & { chunkSize?: number } = {}) {
    super();
    this.sampleRate = config.sampleRate ?? 0.005;  // 0.5% 샘플링
    this.maxKeywords = config.maxKeywords ?? 50;
    this.maxSentences = config.maxSentences ?? 20;
    this.chunkSize = config.chunkSize ?? 1000000;  // 1M 문자 단위
  }
  
  /**
   * 병렬 압축 (Promise.all 활용)
   */
  async compress(text: string): Promise<CompressionResultV3> {
    const startTime = performance.now();
    
    const len = text.length;
    
    // 작은 입력은 단일 처리
    if (len < this.chunkSize) {
      return this.compressSingle(text, startTime);
    }
    
    // 청크 분할
    const chunks: string[] = [];
    for (let i = 0; i < len; i += this.chunkSize) {
      chunks.push(text.slice(i, Math.min(i + this.chunkSize, len)));
    }
    
    // 병렬 처리 (setImmediate로 이벤트 루프 양보)
    const results = await Promise.all(
      chunks.map((chunk, idx) => 
        new Promise<{ tokens: number; keywords: Map<string, number>; sentences: string[] }>((resolve) => {
          setImmediate(() => {
            resolve(this.processChunk(chunk));
          });
        })
      )
    );
    
    // 결과 병합
    let totalTokens = 0;
    const mergedKeywords = new Map<string, number>();
    const allSentences: string[] = [];
    
    for (const result of results) {
      totalTokens += result.tokens;
      
      for (const [word, count] of result.keywords) {
        mergedKeywords.set(word, (mergedKeywords.get(word) || 0) + count);
      }
      
      if (allSentences.length < this.maxSentences) {
        allSentences.push(...result.sentences.slice(0, this.maxSentences - allSentences.length));
      }
    }
    
    // 상위 키워드 추출
    const keywords = Array.from(mergedKeywords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxKeywords)
      .map(([word]) => word);
    
    // 최종 텍스트 생성
    const finalText = [
      `[키워드: ${keywords.join(', ')}]`,
      '',
      allSentences.join(' ')
    ].join('\n');
    
    const compressedTokens = this.fastTokenCount(finalText);
    
    return {
      finalText,
      totalOriginalTokens: totalTokens,
      totalCompressedTokens: compressedTokens,
      compressionRatio: 1 - (compressedTokens / totalTokens),
      processingTimeMs: performance.now() - startTime
    };
  }
  
  /**
   * 단일 청크 처리
   */
  private processChunk(text: string): { tokens: number; keywords: Map<string, number>; sentences: string[] } {
    const len = text.length;
    let tokenCount = 0;
    let inWord = false;
    
    const keywordFreq = new Map<string, number>();
    const sentences: string[] = [];
    let sentenceStart = 0;
    
    const sampleInterval = Math.max(1, Math.floor(1 / this.sampleRate));
    let sampleCounter = 0;
    
    let wordStart = 0;
    let wordEnd = 0;
    
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i);
      const isSpace = c === 32 || c === 10 || c === 13 || c === 9;
      const isSentenceEnd = c === 46 || c === 33 || c === 63 || c === 12290;
      
      if (isSpace) {
        if (inWord) {
          tokenCount++;
          
          sampleCounter++;
          if (sampleCounter >= sampleInterval) {
            sampleCounter = 0;
            const word = text.slice(wordStart, wordEnd + 1).toLowerCase();
            if (word.length > 2 && word.length < 20) {
              keywordFreq.set(word, (keywordFreq.get(word) || 0) + 1);
            }
          }
          
          inWord = false;
        }
      } else {
        if (!inWord) {
          wordStart = i;
          inWord = true;
        }
        wordEnd = i;
      }
      
      if (isSentenceEnd && sentences.length < 5) {  // 청크당 5문장
        const sentence = text.slice(sentenceStart, i + 1).trim();
        if (sentence.length > 30 && sentence.length < 500) {
          sentences.push(sentence);
        }
        sentenceStart = i + 1;
      }
    }
    
    if (inWord) {
      tokenCount++;
    }
    
    return { tokens: tokenCount, keywords: keywordFreq, sentences };
  }
  
  /**
   * 단일 처리 (작은 입력용)
   */
  private compressSingle(text: string, startTime: number): CompressionResultV3 {
    const result = this.processChunk(text);
    
    const keywords = Array.from(result.keywords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxKeywords)
      .map(([word]) => word);
    
    const finalText = [
      `[키워드: ${keywords.join(', ')}]`,
      '',
      result.sentences.join(' ')
    ].join('\n');
    
    const compressedTokens = this.fastTokenCount(finalText);
    
    return {
      finalText,
      totalOriginalTokens: result.tokens,
      totalCompressedTokens: compressedTokens,
      compressionRatio: 1 - (compressedTokens / result.tokens),
      processingTimeMs: performance.now() - startTime
    };
  }
  
  private fastTokenCount(text: string): number {
    let count = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      const isSpace = c === 32 || c === 10 || c === 13 || c === 9;
      if (!isSpace && !inWord) {
        count++;
        inWord = true;
      } else if (isSpace) {
        inWord = false;
      }
    }
    return count;
  }
}
