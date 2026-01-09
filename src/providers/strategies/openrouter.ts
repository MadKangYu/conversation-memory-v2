import { BaseStrategy } from './base.js';
import { LLMMessage, LLMResponse, LLMProviderConfig } from '../llm-provider.js';

export class OpenRouterStrategy extends BaseStrategy {
  id = 'openrouter';

  isSupported(model: string): boolean {
    return true; // Fallback for all models
  }

  async complete(messages: LLMMessage[], config: LLMProviderConfig): Promise<LLMResponse> {
    const apiKey = this.getApiKey(config, 'OPENROUTER_API_KEY');
    if (!apiKey) throw new Error('OpenRouter API Key not found');

    const baseUrl = 'https://openrouter.ai/api/v1';
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/manus/conversation-memory',
        'X-Title': 'The Forge'
      },
      body: JSON.stringify({
        model: config.model, // OpenRouter는 전체 모델 ID 사용
        messages: messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.choices[0].message.content,
      usage: data.usage
    };
  }
}
