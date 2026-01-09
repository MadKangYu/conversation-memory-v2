/**
 * InstantCompressor 성능 벤치마크 테스트
 * 
 * 테스트 항목:
 * 1. 처리 속도 (토큰/초)
 * 2. 압축률 (%)
 * 3. 메모리 사용량 (MB)
 */

import { InstantCompressor } from '../src/core/instant-compressor';

interface BenchmarkResult {
  testName: string;
  inputTokens: number;
  outputTokens: number;
  compressionRatio: number;
  processingTimeMs: number;
  tokensPerSecond: number;
  memoryUsedMB: number;
  peakMemoryMB: number;
}

// 테스트 데이터 생성
function generateTestData(tokenCount: number): string {
  const sampleTexts = [
    "React 프로젝트에서 상태 관리를 위해 Zustand를 선택했습니다. Redux보다 간단하고 보일러플레이트가 적습니다.",
    "TypeScript를 사용하면 타입 안정성이 보장되어 런타임 에러를 줄일 수 있습니다. 인터페이스와 제네릭을 활용하세요.",
    "API 서버는 Express와 Fastify 중 선택할 수 있습니다. 성능이 중요하다면 Fastify를 추천합니다.",
    "데이터베이스 설계 시 정규화를 고려하되, 읽기 성능을 위해 적절한 비정규화도 필요합니다.",
    "JWT 토큰 기반 인증을 구현할 때는 refresh token 전략을 함께 사용하는 것이 좋습니다.",
    "CI/CD 파이프라인을 구축하면 배포 자동화와 품질 관리가 용이해집니다. GitHub Actions를 추천합니다.",
    "마이크로서비스 아키텍처는 확장성이 좋지만, 초기 복잡도가 높습니다. 모놀리식으로 시작하세요.",
    "캐싱 전략은 Redis를 활용하면 효과적입니다. TTL 설정과 캐시 무효화 전략을 잘 설계하세요.",
    "로깅과 모니터링은 프로덕션 환경에서 필수입니다. ELK 스택이나 Datadog을 고려해보세요.",
    "테스트 코드 작성은 장기적으로 개발 속도를 높입니다. Jest와 Testing Library를 사용하세요."
  ];
  
  const words: string[] = [];
  let currentTokens = 0;
  
  while (currentTokens < tokenCount) {
    const text = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
    words.push(text);
    // 대략적인 토큰 계산 (한글 2자 = 1토큰, 영어 4자 = 1토큰)
    currentTokens += Math.ceil(text.length / 3);
  }
  
  return words.join('\n\n');
}

// 토큰 수 추정
function estimateTokens(text: string): number {
  // 한글: 2자당 1토큰, 영어: 4자당 1토큰, 공백/특수문자: 1자당 0.25토큰
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const otherChars = text.length - koreanChars - englishChars;
  
  return Math.ceil(koreanChars / 2 + englishChars / 4 + otherChars / 4);
}

// 메모리 사용량 측정
function getMemoryUsage(): number {
  const used = process.memoryUsage();
  return Math.round(used.heapUsed / 1024 / 1024 * 100) / 100;
}

// 벤치마크 실행
async function runBenchmark(testName: string, tokenCount: number): Promise<BenchmarkResult> {
  const compressor = new InstantCompressor();
  
  // 테스트 데이터 생성
  console.log(`\n[${testName}] 테스트 데이터 생성 중... (목표: ${tokenCount.toLocaleString()} 토큰)`);
  const testData = generateTestData(tokenCount);
  const actualInputTokens = estimateTokens(testData);
  
  // GC 실행 (가능한 경우)
  if (global.gc) {
    global.gc();
  }
  
  const initialMemory = getMemoryUsage();
  let peakMemory = initialMemory;
  
  // 메모리 모니터링
  const memoryInterval = setInterval(() => {
    const currentMemory = getMemoryUsage();
    if (currentMemory > peakMemory) {
      peakMemory = currentMemory;
    }
  }, 10);
  
  // 압축 실행 (올바른 API 사용)
  console.log(`[${testName}] 압축 시작...`);
  const startTime = performance.now();
  
  const result = await compressor.compress(testData);
  
  const endTime = performance.now();
  clearInterval(memoryInterval);
  
  const processingTimeMs = Math.round(endTime - startTime);
  const outputTokens = result.totalCompressedTokens;
  const compressionRatio = Math.round(result.compressionRatio * 100 * 100) / 100;
  const tokensPerSecond = Math.round(actualInputTokens / (processingTimeMs / 1000));
  const memoryUsed = Math.round((peakMemory - initialMemory) * 100) / 100;
  
  return {
    testName,
    inputTokens: actualInputTokens,
    outputTokens,
    compressionRatio,
    processingTimeMs,
    tokensPerSecond,
    memoryUsedMB: memoryUsed,
    peakMemoryMB: peakMemory
  };
}

// 결과 출력
function printResults(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('📊 InstantCompressor 성능 벤치마크 결과');
  console.log('='.repeat(100));
  
  console.log('\n┌─────────────────┬──────────────┬──────────────┬────────────┬──────────────┬──────────────┬────────────┐');
  console.log('│ 테스트          │ 입력 토큰    │ 출력 토큰    │ 압축률     │ 처리 시간    │ 토큰/초      │ 메모리     │');
  console.log('├─────────────────┼──────────────┼──────────────┼────────────┼──────────────┼──────────────┼────────────┤');
  
  for (const r of results) {
    const testName = r.testName.padEnd(15);
    const inputTokens = r.inputTokens.toLocaleString().padStart(10);
    const outputTokens = r.outputTokens.toLocaleString().padStart(10);
    const compressionRatio = `${r.compressionRatio}%`.padStart(8);
    const processingTime = `${r.processingTimeMs}ms`.padStart(10);
    const tokensPerSec = r.tokensPerSecond.toLocaleString().padStart(10);
    const memory = `${r.memoryUsedMB}MB`.padStart(8);
    
    console.log(`│ ${testName} │ ${inputTokens} │ ${outputTokens} │ ${compressionRatio} │ ${processingTime} │ ${tokensPerSec} │ ${memory} │`);
  }
  
  console.log('└─────────────────┴──────────────┴──────────────┴────────────┴──────────────┴──────────────┴────────────┘');
  
  // 요약
  console.log('\n📈 성능 요약:');
  const avgCompressionRatio = results.reduce((sum, r) => sum + r.compressionRatio, 0) / results.length;
  const avgTokensPerSec = results.reduce((sum, r) => sum + r.tokensPerSecond, 0) / results.length;
  const maxTokensPerSec = Math.max(...results.map(r => r.tokensPerSecond));
  
  console.log(`   • 평균 압축률: ${avgCompressionRatio.toFixed(2)}%`);
  console.log(`   • 평균 처리 속도: ${avgTokensPerSec.toLocaleString()} 토큰/초`);
  console.log(`   • 최대 처리 속도: ${maxTokensPerSec.toLocaleString()} 토큰/초`);
  
  // 10M 토큰 예상 시간
  const estimated10MTime = Math.round(10000000 / avgTokensPerSec);
  console.log(`\n⏱️ 10M 토큰 예상 처리 시간: ${estimated10MTime}초 (${(estimated10MTime / 60).toFixed(1)}분)`);
  
  // 10초 이내 달성 여부
  if (estimated10MTime <= 10) {
    console.log('✅ 10M 토큰 10초 이내 처리: 달성!');
  } else {
    console.log(`⚠️ 10M 토큰 10초 이내 처리: 미달성 (${estimated10MTime - 10}초 초과)`);
    console.log(`   → JabEngine 병렬 처리로 보완 필요`);
  }
}

// 메인 실행
async function main(): Promise<void> {
  console.log('🚀 InstantCompressor 성능 벤치마크 시작\n');
  console.log('테스트 환경:');
  console.log(`   • Node.js: ${process.version}`);
  console.log(`   • Platform: ${process.platform}`);
  console.log(`   • Architecture: ${process.arch}`);
  console.log(`   • Memory: ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`);
  
  const results: BenchmarkResult[] = [];
  
  // 다양한 크기의 테스트
  const testCases = [
    { name: '10K 토큰', tokens: 10000 },
    { name: '50K 토큰', tokens: 50000 },
    { name: '100K 토큰', tokens: 100000 },
    { name: '500K 토큰', tokens: 500000 },
    { name: '1M 토큰', tokens: 1000000 },
  ];
  
  for (const testCase of testCases) {
    try {
      const result = await runBenchmark(testCase.name, testCase.tokens);
      results.push(result);
      console.log(`[${testCase.name}] 완료: ${result.processingTimeMs}ms, ${result.compressionRatio}% 압축`);
    } catch (error) {
      console.error(`[${testCase.name}] 실패:`, error);
    }
  }
  
  printResults(results);
}

main().catch(console.error);
