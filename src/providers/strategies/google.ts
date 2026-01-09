import { BaseStrategy } from './base.js';
import { LLMMessage, LLMResponse, LLMProviderConfig } from '../llm-provider.js';

export class GoogleStrategy extends BaseStrategy {
  id = 'google';

  isSupported(model: string): boolean {
    return model.startsWith('google/');
  }

  async complete(messages: LLMMessage[], config: LLMProviderConfig): Promise<LLMResponse> {
    const apiKey = this.getApiKey(config, 'GOOGLE_API_KEY');
    if (!apiKey) throw new Error('Google API Key not found');

    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model.replace('google/', ''), // 접두사 제거
        messages: messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.choices[0].message.content,
      usage: data.usage
    };
  }
}
