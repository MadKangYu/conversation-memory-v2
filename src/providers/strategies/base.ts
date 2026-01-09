import { LLMMessage, LLMResponse, LLMProviderConfig } from '../llm-provider.js';

export interface LLMStrategy {
  id: string;
  isSupported(model: string): boolean;
  complete(messages: LLMMessage[], config: LLMProviderConfig): Promise<LLMResponse>;
}

export abstract class BaseStrategy implements LLMStrategy {
  abstract id: string;
  abstract isSupported(model: string): boolean;
  
  protected getApiKey(config: LLMProviderConfig, envVar: string): string {
    // 1. ConfigManager에서 주입된 키 (config.apiKey는 이미 resolve된 상태일 수 있음)
    if (config.apiKey && config.apiKey.length > 10) return config.apiKey;
    
    // 2. 환경 변수
    return process.env[envVar] || '';
  }

  abstract complete(messages: LLMMessage[], config: LLMProviderConfig): Promise<LLMResponse>;
}
