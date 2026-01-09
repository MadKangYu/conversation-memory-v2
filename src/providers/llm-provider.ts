import { HttpsProxyAgent } from 'https-proxy-agent';
import { ConvMemoryConfig } from '../types.js';
import { ConfigManager } from '../core/config-manager.js';
import { LLMStrategy } from './strategies/base.js';
import { GoogleStrategy } from './strategies/google.js';
import { OpenAIStrategy } from './strategies/openai.js';
import { XAIStrategy } from './strategies/xai.js';
import { OpenRouterStrategy } from './strategies/openrouter.js';

export const RECOMMENDED_MODELS = {
  chat: [
    'google/gemini-2.0-flash-exp:free',
    'openai/gpt-4o',
    'anthropic/claude-3-5-sonnet',
    'x-ai/grok-beta'
  ],
  summarization: [
    'google/gemini-2.0-flash-exp:free',
    'openai/gpt-3.5-turbo'
  ],
  vision: [
    'google/gemini-2.0-flash-exp:free',
    'openai/gpt-4o'
  ]
};

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LLMContentPart[];
}

export interface LLMContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cost?: number;
}

export interface LLMProviderConfig {
  provider: 'openrouter' | 'openai' | 'anthropic' | 'google' | 'xai';
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
}

export class LLMProvider {
  private config: LLMProviderConfig;
  private configManager: ConfigManager;
  private strategies: LLMStrategy[];

  constructor(config: Partial<LLMProviderConfig> = {}) {
    this.configManager = new ConfigManager();
    
    this.config = {
      provider: config.provider || 'openrouter',
      model: config.model || 'google/gemini-2.0-flash-exp:free',
      apiKey: config.apiKey,
      maxTokens: config.maxTokens || 1024,
      temperature: config.temperature || 0.3,
      ...config,
    };

    // 전략 등록 (순서 중요: 구체적인 것부터 -> 일반적인 것 순으로)
    this.strategies = [
      new GoogleStrategy(),
      new OpenAIStrategy(),
      new XAIStrategy(),
      new OpenRouterStrategy() // Fallback
    ];
  }

  /**
   * 현재 설정에 맞는 API Key를 가져옵니다.
   */
  private resolveApiKey(strategyId: string): string {
    // 1. 생성자에서 명시적으로 주입된 키
    if (this.config.apiKey) return this.config.apiKey;

    // 2. ConfigManager에서 관리되는 키
    const appConfig = this.configManager.getConfig();
    const keys = appConfig.apiKeys || {};

    switch (strategyId) {
      case 'google': return keys.google || '';
      case 'openai': return keys.openai || '';
      case 'xai': return keys.xai || '';
      case 'openrouter': return keys.openrouter || '';
      default: return '';
    }
  }

  /**
   * 텍스트 완성 요청
   */
  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const model = this.config.model;
    
    // 지원하는 전략 찾기
    const strategy = this.strategies.find(s => s.isSupported(model));
    if (!strategy) {
      throw new Error(`No strategy found for model: ${model}`);
    }

    // 실행 시점에 사용할 API Key 결정
    const apiKey = this.resolveApiKey(strategy.id);
    
    // Config 객체 복사 및 키 주입
    const runConfig = { ...this.config, apiKey };

    try {
      return await strategy.complete(messages, runConfig);
    } catch (error) {
      // 전략 실패 시 OpenRouter로 Fallback 시도 (단, 이미 OpenRouter가 아니었다면)
      if (strategy.id !== 'openrouter') {
        console.warn(`[LLMProvider] ${strategy.id} failed, falling back to OpenRouter...`);
        const fallbackStrategy = this.strategies.find(s => s.id === 'openrouter')!;
        const fallbackKey = this.resolveApiKey('openrouter');
        return await fallbackStrategy.complete(messages, { ...runConfig, apiKey: fallbackKey });
      }
      throw error;
    }
  }

  /**
   * 모델 변경
   */
  setModel(model: string) {
    this.config.model = model;
  }

  /**
   * Vision 지원 완성 요청 (호환성 유지용)
   */
  async completeWithVision(messages: LLMMessage[]): Promise<LLMResponse> {
    return this.complete(messages);
  }
}

export function createDefaultProvider(): LLMProvider {
  return new LLMProvider({
    provider: 'openrouter',
    model: 'google/gemini-2.0-flash-exp:free',
  });
}

export function createVisionProvider(): LLMProvider {
  return new LLMProvider({
    provider: 'openrouter',
    model: 'google/gemini-2.0-flash-exp:free',
  });
}
