/**
 * Image Processor - Manus 스타일 이미지 처리
 * 이미지 읽기, 분석, 텍스트 추출 지원
 */

import * as fs from 'fs';
import * as path from 'path';
import { LLMProvider, createVisionProvider } from './llm-provider.js';

export interface ImageAnalysisResult {
  description: string;
  type: 'screenshot' | 'diagram' | 'photo' | 'chart' | 'code' | 'document' | 'other';
  keyElements: string[];
  extractedText: string;
  context: string;
  metadata: {
    width?: number;
    height?: number;
    format: string;
    size: number;
    path: string;
  };
}

export interface ProcessedImage {
  base64: string;
  mimeType: string;
  path: string;
  size: number;
}

/**
 * 이미지 프로세서 클래스
 */
export class ImageProcessor {
  private llmProvider: LLMProvider;
  private supportedFormats = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

  constructor(llmProvider?: LLMProvider) {
    this.llmProvider = llmProvider || createVisionProvider();
  }

  /**
   * 이미지 파일 읽기 및 Base64 변환
   */
  async readImage(imagePath: string): Promise<ProcessedImage> {
    const absolutePath = path.resolve(imagePath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`이미지 파일을 찾을 수 없습니다: ${absolutePath}`);
    }

    const ext = path.extname(absolutePath).toLowerCase();
    if (!this.supportedFormats.includes(ext)) {
      throw new Error(`지원하지 않는 이미지 형식입니다: ${ext}. 지원 형식: ${this.supportedFormats.join(', ')}`);
    }

    const buffer = fs.readFileSync(absolutePath);
    const base64 = buffer.toString('base64');
    const mimeType = this.getMimeType(ext);
    const stats = fs.statSync(absolutePath);

    return {
      base64,
      mimeType,
      path: absolutePath,
      size: stats.size,
    };
  }

  /**
   * URL에서 이미지 다운로드
   */
  async downloadImage(url: string): Promise<ProcessedImage> {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`이미지 다운로드 실패: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return {
      base64,
      mimeType: contentType,
      path: url,
      size: buffer.byteLength,
    };
  }

  /**
   * 이미지 분석 (Vision API 사용)
   */
  async analyzeImage(
    imageSource: string | ProcessedImage,
    customPrompt?: string
  ): Promise<ImageAnalysisResult> {
    let processedImage: ProcessedImage;

    if (typeof imageSource === 'string') {
      // URL인지 파일 경로인지 판단
      if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
        processedImage = await this.downloadImage(imageSource);
      } else {
        processedImage = await this.readImage(imageSource);
      }
    } else {
      processedImage = imageSource;
    }

    const prompt = customPrompt || `이 이미지를 분석하고 다음 JSON 형식으로 응답하세요:

{
  "description": "이미지에 대한 상세하고 구체적인 설명",
  "type": "screenshot|diagram|photo|chart|code|document|other 중 하나",
  "keyElements": ["이미지에서 발견된 주요 요소들의 배열"],
  "extractedText": "이미지에서 읽을 수 있는 모든 텍스트 (없으면 빈 문자열)",
  "context": "이 이미지가 개발/작업 맥락에서 가지는 의미"
}

JSON만 응답하고 다른 텍스트는 포함하지 마세요.`;

    const response = await this.llmProvider.completeWithVision([
      { role: 'system', content: 'You are an expert at analyzing images and extracting structured information.' },
      { 
        role: 'user', 
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${processedImage.mimeType};base64,${processedImage.base64}` } }
        ]
      }
    ]);

    // JSON 파싱 시도
    let analysisData: any;
    try {
      // JSON 블록 추출 시도
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('JSON을 찾을 수 없음');
      }
    } catch {
      // 파싱 실패 시 기본값
      analysisData = {
        description: response.content,
        type: 'other',
        keyElements: [],
        extractedText: '',
        context: '',
      };
    }

    return {
      description: analysisData.description || '',
      type: analysisData.type || 'other',
      keyElements: analysisData.keyElements || [],
      extractedText: analysisData.extractedText || analysisData.text || '',
      context: analysisData.context || '',
      metadata: {
        format: processedImage.mimeType,
        size: processedImage.size,
        path: processedImage.path,
      },
    };
  }

  /**
   * 스크린샷에서 코드 추출
   */
  async extractCodeFromScreenshot(imagePath: string): Promise<{
    code: string;
    language: string;
    confidence: number;
  }> {
    const processedImage = await this.readImage(imagePath);

    const prompt = `이 스크린샷에서 코드를 추출하세요. JSON 형식으로 응답:

{
  "code": "추출된 코드 (들여쓰기 유지)",
  "language": "프로그래밍 언어",
  "confidence": 0.0-1.0 사이의 신뢰도
}

코드가 없으면 code를 빈 문자열로, confidence를 0으로 설정하세요.`;

    const response = await this.llmProvider.completeWithVision([
      { role: 'system', content: 'You are an expert at analyzing code from screenshots.' },
      { 
        role: 'user', 
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${processedImage.mimeType};base64,${processedImage.base64}` } }
        ]
      }
    ]);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // 파싱 실패
    }

    return { code: '', language: 'unknown', confidence: 0 };
  }

  /**
   * 다이어그램/플로우차트 분석
   */
  async analyzeDiagram(imagePath: string): Promise<{
    diagramType: string;
    nodes: string[];
    connections: string[];
    description: string;
  }> {
    const processedImage = await this.readImage(imagePath);

    const prompt = `이 다이어그램/플로우차트를 분석하세요. JSON 형식으로 응답:

{
  "diagramType": "flowchart|sequence|class|er|architecture|mindmap|other",
  "nodes": ["노드/박스에 있는 텍스트들"],
  "connections": ["노드 간 연결 관계 설명"],
  "description": "다이어그램 전체 설명"
}`;

    const response = await this.llmProvider.completeWithVision([
      { role: 'system', content: 'You are an expert at analyzing diagrams and technical drawings.' },
      { 
        role: 'user', 
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${processedImage.mimeType};base64,${processedImage.base64}` } }
        ]
      }
    ]);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // 파싱 실패
    }

    return {
      diagramType: 'other',
      nodes: [],
      connections: [],
      description: response.content,
    };
  }

  /**
   * 이미지를 대화 메모리에 저장할 형식으로 변환
   */
  async processForMemory(imagePath: string): Promise<{
    summary: string;
    tags: string[];
    extractedContent: string;
  }> {
    const analysis = await this.analyzeImage(imagePath);

    const tags: string[] = [];
    
    // 타입 기반 태그
    tags.push(`image-${analysis.type}`);
    
    // 키 요소에서 태그 추출
    for (const element of analysis.keyElements.slice(0, 3)) {
      const tag = element.toLowerCase().replace(/\s+/g, '-').slice(0, 20);
      if (tag.length > 2) tags.push(tag);
    }

    return {
      summary: `[이미지: ${analysis.type}] ${analysis.description.slice(0, 200)}`,
      tags,
      extractedContent: analysis.extractedText || analysis.description,
    };
  }

  /**
   * MIME 타입 결정
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    return mimeTypes[ext] || 'image/png';
  }

  /**
   * 지원 형식 확인
   */
  isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }
}

/**
 * 기본 이미지 프로세서 생성
 */
export function createImageProcessor(llmProvider?: LLMProvider): ImageProcessor {
  return new ImageProcessor(llmProvider);
}
