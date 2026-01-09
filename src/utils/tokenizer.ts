/**
 * Tokenizer - 토큰 수 계산
 * tiktoken 라이브러리 사용 또는 간단한 추정
 */

interface TokenEncoder {
  encode: (text: string) => { length: number };
}

let tiktokenEncoder: TokenEncoder | null = null;

/**
 * tiktoken 인코더 초기화 (지연 로딩)
 */
async function getEncoder(): Promise<TokenEncoder> {
  if (tiktokenEncoder) return tiktokenEncoder;

  try {
    const tiktoken = await import('tiktoken');
    const encoder = tiktoken.get_encoding('cl100k_base');
    tiktokenEncoder = {
      encode: (text: string) => encoder.encode(text),
    };
    return tiktokenEncoder;
  } catch {
    // tiktoken 사용 불가 시 간단한 추정기 반환
    return {
      encode: (text: string) => {
        // 대략적인 토큰 추정: 4자당 1토큰 (영어), 2자당 1토큰 (한글)
        const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
        const otherChars = text.length - koreanChars;
        const estimatedTokens = Math.ceil(koreanChars / 2) + Math.ceil(otherChars / 4);
        return { length: estimatedTokens };
      },
    };
  }
}

/**
 * 텍스트의 토큰 수 계산
 */
export async function countTokensAsync(text: string): Promise<number> {
  const encoder = await getEncoder();
  return encoder.encode(text).length;
}

/**
 * 텍스트의 토큰 수 계산 (동기, 추정치)
 */
export function countTokens(text: string): number {
  // 대략적인 토큰 추정
  const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const otherChars = text.length - koreanChars;
  return Math.ceil(koreanChars / 2) + Math.ceil(otherChars / 4);
}

/**
 * 메시지 배열의 총 토큰 수 계산
 */
export function countMessagesTokens(
  messages: Array<{ content: string }>
): number {
  return messages.reduce((sum, msg) => sum + countTokens(msg.content), 0);
}

/**
 * 토큰 수를 기준으로 텍스트 자르기
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = countTokens(text);
  if (currentTokens <= maxTokens) return text;

  // 비율 기반 자르기
  const ratio = maxTokens / currentTokens;
  const targetLength = Math.floor(text.length * ratio * 0.9); // 10% 여유
  return text.slice(0, targetLength) + '...';
}

/**
 * 토큰 수 포맷 (K 단위)
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * 토큰 비용 계산 (USD)
 */
export function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  // 모델별 가격 (1M 토큰당 USD)
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-haiku-4-5': { input: 0.25, output: 1.25 },
    'claude-sonnet-4': { input: 3, output: 15 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-opus-4': { input: 15, output: 75 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  };

  const modelPricing = pricing[model] || pricing['claude-haiku-4-5'];
  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;

  return inputCost + outputCost;
}
