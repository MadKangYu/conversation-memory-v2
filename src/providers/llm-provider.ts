/**
 * LLM Provider - 다중 LLM 지원 (OpenRouter 통합)
 * Gemini, Claude, Grok, GPT 등 지원
 * 2025년 1월 기준 최신 모델 지원
 */

import { ConvMemoryConfig } from '../types.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LLMContentPart[];
}

export interface LLMContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;  // base64 data URL 또는 HTTP URL
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cost?: number;
}

export interface LLMProviderConfig {
  provider: 'openrouter' | 'openai' | 'anthropic' | 'google';
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * 2025년 1월 기준 추천 모델 목록
 */
export const RECOMMENDED_MODELS = {
  // 요약용 (저비용, 빠름)
  summarization: [
    { provider: 'openrouter', model: 'anthropic/claude-3-5-haiku-20241022', costPer1M: 1.0, description: 'Claude 3.5 Haiku - 빠르고 저렴' },
    { provider: 'openrouter', model: 'google/gemini-2.0-flash-exp:free', costPer1M: 0, description: 'Gemini 2.0 Flash - 무료' },
    { provider: 'openrouter', model: 'google/gemini-flash-1.5', costPer1M: 0.075, description: 'Gemini 1.5 Flash - 매우 저렴' },
    { provider: 'openrouter', model: 'openai/gpt-4o-mini', costPer1M: 0.15, description: 'GPT-4o Mini - 저렴하고 빠름' },
    { provider: 'openrouter', model: 'x-ai/grok-2-1212', costPer1M: 2.0, description: 'Grok 2 - xAI 최신 모델' },
  ],
  // Vision용 (이미지 처리)
  vision: [
    { provider: 'openrouter', model: 'google/gemini-2.0-flash-exp:free', costPer1M: 0, description: 'Gemini 2.0 Flash - 무료 Vision' },
    { provider: 'openrouter', model: 'anthropic/claude-3-5-sonnet-20241022', costPer1M: 3.0, description: 'Claude 3.5 Sonnet - 최고 Vision' },
    { provider: 'openrouter', model: 'openai/gpt-4o', costPer1M: 2.5, description: 'GPT-4o - 강력한 Vision' },
    { provider: 'openrouter', model: 'x-ai/grok-vision-beta', costPer1M: 5.0, description: 'Grok Vision - xAI Vision' },
  ],
} as const;

/**
 * 통합 LLM Provider 클래스
 */
export class LLMProvider {
  private config: LLMProviderConfig;
  private baseUrl: string;

  constructor(config: Partial<LLMProviderConfig> = {}) {
    // 환경 변수에서 API 키 자동 로드
    const apiKey = config.apiKey || 
      process.env.OPENROUTER_API_KEY || 
      process.env.OPENAI_API_KEY || 
      process.env.ANTHROPIC_API_KEY ||
      process.env.GOOGLE_API_KEY || '';

    this.config = {
      provider: config.provider || 'openrouter',
      model: config.model || 'google/gemini-2.0-flash-exp:free',  // 기본: 무료 모델
      apiKey,
      maxTokens: config.maxTokens || 1024,
      temperature: config.temperature || 0.3,
      ...config,
    };

    // 프로바이더별 Base URL 설정
    this.baseUrl = config.baseUrl || this.getDefaultBaseUrl();
  }

  private getDefaultBaseUrl(): string {
    switch (this.config.provider) {
      case 'openrouter':
        return 'https://openrouter.ai/api/v1';
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'anthropic':
        return 'https://api.anthropic.com/v1';
      case 'google':
        return 'https://generativelanguage.googleapis.com/v1beta';
      default:
        return 'https://openrouter.ai/api/v1';
    }
  }

  /**
   * 텍스트 완성 요청
   */
  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('API 키가 설정되지 않았습니다. OPENROUTER_API_KEY 환경 변수를 설정하세요.');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'https://github.com/conversation-memory-v2',
        'X-Title': 'Conversation Memory V2',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API 오류: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model?: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    
    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model || this.config.model,
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      cost: this.calculateCost(data.usage),
    };
  }

  /**
   * 이미지 포함 요청 (Vision)
   */
  async completeWithVision(
    textPrompt: string,
    images: Array<{ base64?: string; url?: string; mimeType?: string }>
  ): Promise<LLMResponse> {
    const content: LLMContentPart[] = [
      { type: 'text', text: textPrompt },
    ];

    for (const image of images) {
      if (image.base64) {
        const mimeType = image.mimeType || 'image/png';
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${image.base64}`,
            detail: 'auto',
          },
        });
      } else if (image.url) {
        content.push({
          type: 'image_url',
          image_url: {
            url: image.url,
            detail: 'auto',
          },
        });
      }
    }

    const messages: LLMMessage[] = [
      { role: 'user', content },
    ];

    return this.complete(messages);
  }

  /**
   * 청크 요약 (최적화된 프롬프트)
   */
  async summarizeChunk(chunkContent: string, context?: string): Promise<string> {
    const systemPrompt = `당신은 대화 내용을 구조화된 JSON으로 요약하는 전문가입니다.
다음 형식으로 정확히 응답하세요:

{
  "summary": "핵심 내용 1-2문장 요약",
  "keyDecisions": ["결정사항1", "결정사항2"],
  "codeArtifacts": ["파일명.확장자"],
  "openIssues": ["미해결 이슈"],
  "tags": ["태그1", "태그2"]
}

규칙:
- 코드 블록이나 기술적 세부사항은 요약에서 제외
- 핵심 결정사항과 맥락만 보존
- tags는 최대 5개, 소문자 영어로`;

    const userPrompt = context 
      ? `이전 컨텍스트:\n${context}\n\n새 대화 내용:\n${chunkContent}`
      : `대화 내용:\n${chunkContent}`;

    const response = await this.complete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    return response.content;
  }

  /**
   * 이미지 분석 (Manus 스타일)
   */
  async analyzeImage(
    imageData: { base64?: string; url?: string; mimeType?: string },
    prompt?: string
  ): Promise<string> {
    const defaultPrompt = `이 이미지를 분석하고 다음 정보를 JSON 형식으로 제공하세요:

{
  "description": "이미지에 대한 상세 설명",
  "type": "screenshot|diagram|photo|chart|code|document|other",
  "keyElements": ["주요 요소들"],
  "text": "이미지에서 추출된 텍스트 (있는 경우)",
  "context": "개발/작업 맥락에서의 의미"
}`;

    const response = await this.completeWithVision(
      prompt || defaultPrompt,
      [imageData]
    );

    return response.content;
  }

  /**
   * 비용 계산 (대략적)
   */
  private calculateCost(usage?: { prompt_tokens: number; completion_tokens: number }): number {
    if (!usage) return 0;

    // OpenRouter 기준 대략적인 비용 (1M 토큰당 USD)
    const modelCosts: Record<string, { input: number; output: number }> = {
      'google/gemini-2.0-flash-exp:free': { input: 0, output: 0 },
      'google/gemini-flash-1.5': { input: 0.075, output: 0.3 },
      'anthropic/claude-3-5-haiku-20241022': { input: 1.0, output: 5.0 },
      'anthropic/claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
      'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
      'openai/gpt-4o': { input: 2.5, output: 10.0 },
      'x-ai/grok-2-1212': { input: 2.0, output: 10.0 },
    };

    const costs = modelCosts[this.config.model] || { input: 0.1, output: 0.4 };
    
    return (
      (usage.prompt_tokens / 1_000_000) * costs.input +
      (usage.completion_tokens / 1_000_000) * costs.output
    );
  }

  /**
   * 현재 설정 정보
   */
  getConfig(): LLMProviderConfig {
    return { ...this.config, apiKey: '***' };  // API 키 마스킹
  }

  /**
   * 모델 변경
   */
  setModel(model: string): void {
    this.config.model = model;
  }

  /**
   * API 키 유효성 검사
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.complete([
        { role: 'user', content: 'test' },
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 기본 LLM Provider 인스턴스 생성
 */
export function createDefaultProvider(): LLMProvider {
  return new LLMProvider({
    provider: 'openrouter',
    model: 'google/gemini-2.0-flash-exp:free',  // 무료 모델 기본값
  });
}

/**
 * Vision 지원 Provider 생성
 */
export function createVisionProvider(): LLMProvider {
  return new LLMProvider({
    provider: 'openrouter',
    model: 'google/gemini-2.0-flash-exp:free',  // 무료 Vision 지원
  });
}
