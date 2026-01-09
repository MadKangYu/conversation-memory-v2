/**
 * InstantCompressor - LLM 없이 10초 이내 10M 토큰 압축
 * 
 * 알고리즘:
 * 1. TF-IDF: 중요 키워드 추출
 * 2. TextRank: 핵심 문장 추출
 * 3. SimHash: 중복 제거
 */

import { EventEmitter } from 'events';

// ============================================================================
// 타입 정의
// ============================================================================

export interface CompressedChunk {
  id: string;
  originalTokens: number;
  compressedTokens: number;
  keywords: string[];
  keySentences: string[];
  hash: string;
  timestamp: number;
}

export interface CompressionResult {
  chunks: CompressedChunk[];
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  compressionRatio: number;
  processingTimeMs: number;
  phase: 'instant' | 'background' | 'deep';
}

export interface InstantCompressorConfig {
  chunkSize: number;           // 청크 크기 (토큰)
  keywordsPerChunk: number;    // 청크당 추출할 키워드 수
  sentencesPerChunk: number;   // 청크당 추출할 문장 수
  similarityThreshold: number; // 중복 판단 임계값 (해밍 거리)
  maxWorkers: number;          // 최대 병렬 워커 수
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 간단한 토큰 카운터 (공백 기준)
 */
function countTokens(text: string): number {
  return text.split(/\s+/).filter(t => t.length > 0).length;
}

/**
 * 토큰 기준으로 텍스트 슬라이스
 */
function sliceByTokens(text: string, maxTokens: number): string {
  const tokens = text.split(/\s+/).filter(t => t.length > 0);
  return tokens.slice(0, maxTokens).join(' ');
}

/**
 * 문장 분리
 */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?。！？]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

/**
 * 단어 토큰화 (한글/영어 지원)
 */
function tokenize(text: string): string[] {
  // 한글: 형태소 단위로 분리 (간단한 버전)
  // 영어: 공백 + 구두점 기준 분리
  return text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * MurmurHash3 (간단한 구현)
 */
function murmurhash(str: string): bigint {
  let h = 0n;
  for (let i = 0; i < str.length; i++) {
    h = BigInt(str.charCodeAt(i)) + (h << 6n) + (h << 16n) - h;
  }
  return h & 0xFFFFFFFFFFFFFFFFn;
}

// ============================================================================
// TF-IDF 엔진
// ============================================================================

class StreamingTFIDF {
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments: number = 0;
  
  /**
   * IDF 업데이트 (스트리밍)
   */
  updateIDF(tokens: string[]): void {
    const uniqueTerms = new Set(tokens);
    uniqueTerms.forEach(term => {
      this.documentFrequency.set(
        term,
        (this.documentFrequency.get(term) || 0) + 1
      );
    });
    this.totalDocuments++;
  }
  
  /**
   * TF 계산
   */
  private calculateTF(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    tokens.forEach(token => {
      tf.set(token, (tf.get(token) || 0) + 1);
    });
    // 정규화
    const maxFreq = Math.max(...tf.values());
    tf.forEach((freq, term) => {
      tf.set(term, freq / maxFreq);
    });
    return tf;
  }
  
  /**
   * TF-IDF 점수 계산
   */
  score(tokens: string[]): Map<string, number> {
    const tf = this.calculateTF(tokens);
    const scores = new Map<string, number>();
    
    tf.forEach((freq, term) => {
      const df = this.documentFrequency.get(term) || 1;
      const idf = Math.log(this.totalDocuments / df + 1);
      scores.set(term, freq * idf);
    });
    
    return scores;
  }
  
  /**
   * 상위 N개 키워드 추출
   */
  getTopKeywords(tokens: string[], n: number): string[] {
    const scores = this.score(tokens);
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([term]) => term);
  }
}

// ============================================================================
// TextRank 엔진
// ============================================================================

class LightweightTextRank {
  /**
   * 코사인 유사도 계산
   */
  private cosineSimilarity(s1: string, s2: string): number {
    const tokens1 = new Set(tokenize(s1));
    const tokens2 = new Set(tokenize(s2));
    
    let intersection = 0;
    tokens1.forEach(t => {
      if (tokens2.has(t)) intersection++;
    });
    
    const denominator = Math.sqrt(tokens1.size) * Math.sqrt(tokens2.size);
    return denominator > 0 ? intersection / denominator : 0;
  }
  
  /**
   * 문장 간 유사도 그래프 구축
   */
  private buildGraph(sentences: string[]): number[][] {
    const n = sentences.length;
    const graph: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const similarity = this.cosineSimilarity(sentences[i], sentences[j]);
        graph[i][j] = similarity;
        graph[j][i] = similarity;
      }
    }
    
    return graph;
  }
  
  /**
   * PageRank 알고리즘 (3회 반복 - 속도 최적화)
   */
  private rank(graph: number[][], iterations: number = 3): number[] {
    const n = graph.length;
    if (n === 0) return [];
    
    let scores = Array(n).fill(1 / n);
    const damping = 0.85;
    
    for (let iter = 0; iter < iterations; iter++) {
      const newScores = Array(n).fill((1 - damping) / n);
      
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (graph[j][i] > 0) {
            const outSum = graph[j].reduce((a, b) => a + b, 0) || 1;
            newScores[i] += damping * scores[j] * graph[j][i] / outSum;
          }
        }
      }
      
      scores = newScores;
    }
    
    return scores;
  }
  
  /**
   * 상위 N개 핵심 문장 추출
   */
  getTopSentences(text: string, n: number): string[] {
    const sentences = splitSentences(text);
    if (sentences.length === 0) return [];
    if (sentences.length <= n) return sentences;
    
    const graph = this.buildGraph(sentences);
    const scores = this.rank(graph);
    
    return sentences
      .map((sentence, index) => ({ sentence, score: scores[index] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(item => item.sentence);
  }
}

// ============================================================================
// SimHash 중복 제거기
// ============================================================================

class SimHashDeduplicator {
  private hashBits: number = 64;
  private hashes: Map<string, bigint> = new Map();
  
  /**
   * SimHash 계산
   */
  hash(text: string): bigint {
    const tokens = tokenize(text);
    const v = new Array(this.hashBits).fill(0);
    
    tokens.forEach(token => {
      const h = murmurhash(token);
      for (let i = 0; i < this.hashBits; i++) {
        v[i] += (h & (1n << BigInt(i))) ? 1 : -1;
      }
    });
    
    let hash = 0n;
    for (let i = 0; i < this.hashBits; i++) {
      if (v[i] > 0) hash |= (1n << BigInt(i));
    }
    
    return hash;
  }
  
  /**
   * 해밍 거리 계산
   */
  private hammingDistance(hash1: bigint, hash2: bigint): number {
    let xor = hash1 ^ hash2;
    let distance = 0;
    
    while (xor > 0n) {
      distance += Number(xor & 1n);
      xor >>= 1n;
    }
    
    return distance;
  }
  
  /**
   * 유사 청크 존재 여부 확인
   */
  isDuplicate(id: string, text: string, threshold: number = 3): boolean {
    const newHash = this.hash(text);
    
    for (const [existingId, existingHash] of this.hashes) {
      if (existingId !== id && this.hammingDistance(newHash, existingHash) <= threshold) {
        return true;
      }
    }
    
    this.hashes.set(id, newHash);
    return false;
  }
  
  /**
   * 해시 문자열 반환
   */
  getHashString(text: string): string {
    return this.hash(text).toString(16);
  }
}

// ============================================================================
// InstantCompressor 메인 클래스
// ============================================================================

export class InstantCompressor extends EventEmitter {
  private config: InstantCompressorConfig;
  private tfidf: StreamingTFIDF;
  private textrank: LightweightTextRank;
  private deduplicator: SimHashDeduplicator;
  
  constructor(config: Partial<InstantCompressorConfig> = {}) {
    super();
    
    this.config = {
      chunkSize: 500,
      keywordsPerChunk: 20,
      sentencesPerChunk: 3,
      similarityThreshold: 3,
      maxWorkers: 4,
      ...config
    };
    
    this.tfidf = new StreamingTFIDF();
    this.textrank = new LightweightTextRank();
    this.deduplicator = new SimHashDeduplicator();
  }
  
  /**
   * 텍스트를 청크로 분할 (스트리밍)
   */
  private *chunkText(text: string): Generator<{ id: string; text: string; tokens: number }> {
    const tokens = text.split(/\s+/).filter(t => t.length > 0);
    let chunkIndex = 0;
    
    for (let i = 0; i < tokens.length; i += this.config.chunkSize) {
      const chunkTokens = tokens.slice(i, i + this.config.chunkSize);
      const chunkText = chunkTokens.join(' ');
      
      yield {
        id: `chunk_${chunkIndex++}_${Date.now()}`,
        text: chunkText,
        tokens: chunkTokens.length
      };
    }
  }
  
  /**
   * 단일 청크 압축
   */
  private compressChunk(chunk: { id: string; text: string; tokens: number }): CompressedChunk | null {
    // 중복 체크
    if (this.deduplicator.isDuplicate(chunk.id, chunk.text, this.config.similarityThreshold)) {
      return null; // 중복이면 스킵
    }
    
    const tokens = tokenize(chunk.text);
    
    // TF-IDF 업데이트 및 키워드 추출
    this.tfidf.updateIDF(tokens);
    const keywords = this.tfidf.getTopKeywords(tokens, this.config.keywordsPerChunk);
    
    // TextRank로 핵심 문장 추출
    const keySentences = this.textrank.getTopSentences(chunk.text, this.config.sentencesPerChunk);
    
    // 압축된 토큰 수 계산
    const compressedText = [...keywords, ...keySentences].join(' ');
    const compressedTokens = countTokens(compressedText);
    
    return {
      id: chunk.id,
      originalTokens: chunk.tokens,
      compressedTokens,
      keywords,
      keySentences,
      hash: this.deduplicator.getHashString(chunk.text),
      timestamp: Date.now()
    };
  }
  
  /**
   * 전체 텍스트 즉시 압축 (10초 이내 목표)
   */
  async compress(text: string): Promise<CompressionResult> {
    const startTime = Date.now();
    const chunks: CompressedChunk[] = [];
    let totalOriginalTokens = 0;
    let totalCompressedTokens = 0;
    let processedCount = 0;
    
    // 청크 생성 및 처리
    const chunkGenerator = this.chunkText(text);
    const pendingChunks: { id: string; text: string; tokens: number }[] = [];
    
    // 청크 수집
    for (const chunk of chunkGenerator) {
      pendingChunks.push(chunk);
      totalOriginalTokens += chunk.tokens;
    }
    
    const totalChunks = pendingChunks.length;
    this.emit('start', { totalChunks, totalOriginalTokens });
    
    // 병렬 처리 (배치 단위)
    const batchSize = this.config.maxWorkers;
    
    for (let i = 0; i < pendingChunks.length; i += batchSize) {
      const batch = pendingChunks.slice(i, i + batchSize);
      
      // 배치 내 청크 동시 처리
      const results = await Promise.all(
        batch.map(async (chunk) => {
          return this.compressChunk(chunk);
        })
      );
      
      // 결과 수집
      for (const result of results) {
        if (result) {
          chunks.push(result);
          totalCompressedTokens += result.compressedTokens;
        }
        processedCount++;
      }
      
      // 진행률 이벤트
      const progress = Math.round((processedCount / totalChunks) * 100);
      this.emit('progress', { 
        processed: processedCount, 
        total: totalChunks, 
        percent: progress 
      });
    }
    
    const processingTimeMs = Date.now() - startTime;
    const compressionRatio = totalOriginalTokens > 0 
      ? 1 - (totalCompressedTokens / totalOriginalTokens)
      : 0;
    
    const result: CompressionResult = {
      chunks,
      totalOriginalTokens,
      totalCompressedTokens,
      compressionRatio,
      processingTimeMs,
      phase: 'instant'
    };
    
    this.emit('complete', result);
    
    return result;
  }
  
  /**
   * 압축된 청크들을 컨텍스트 문자열로 변환
   */
  toContextString(chunks: CompressedChunk[], maxTokens: number = 8000): string {
    const parts: string[] = [];
    let currentTokens = 0;
    
    for (const chunk of chunks) {
      const chunkText = [
        `[${chunk.id}]`,
        `키워드: ${chunk.keywords.join(', ')}`,
        `핵심: ${chunk.keySentences.join(' | ')}`
      ].join('\n');
      
      const chunkTokens = countTokens(chunkText);
      
      if (currentTokens + chunkTokens > maxTokens) break;
      
      parts.push(chunkText);
      currentTokens += chunkTokens;
    }
    
    return parts.join('\n\n---\n\n');
  }
  
  /**
   * 리소스 정리
   */
  reset(): void {
    this.tfidf = new StreamingTFIDF();
    this.deduplicator = new SimHashDeduplicator();
  }
}

// ============================================================================
// 내보내기
// ============================================================================

export default InstantCompressor;
