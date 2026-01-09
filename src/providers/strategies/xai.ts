import { BaseStrategy } from './base.js';
import { LLMMessage, LLMResponse, LLMProviderConfig } from '../llm-provider.js';

export class XAIStrategy extends BaseStrategy {
  id = 'xai';

  isSupported(model: string): boolean {
    return model.startsWith('x-ai/');
  }

  async complete(messages: LLMMessage[], config: LLMProviderConfig): Promise<LLMResponse> {
    const apiKey = this.getApiKey(config, 'XAI_API_KEY');
    if (!apiKey) throw new Error('xAI API Key not found');

    const baseUrl = 'https://api.x.ai/v1';
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.model.replace('x-ai/', ''),
        messages: messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`xAI API Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    return {
      content: data.choices[0].message.content,
      usage: data.usage
    };
  }
}
