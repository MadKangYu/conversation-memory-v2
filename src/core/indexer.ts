/**
 * Indexer - LLM 없이 규칙 기반 추출
 * 파일 경로, 함수명, 기술 용어, 해시태그, 결정 힌트 추출
 */

export interface ExtractedMetadata {
  filePaths: string[];
  functionNames: string[];
  techTerms: string[];
  hashtags: string[];
  decisionHints: string[];
  urls: string[];
  numbers: string[];
}

// 파일 경로 패턴
const FILE_PATH_PATTERNS = [
  /(?:^|[\s'"(])([./]?(?:[\w-]+\/)+[\w.-]+\.[a-zA-Z]{1,10})(?:[\s'")\]:,]|$)/gm,
  /(?:src|lib|dist|build|node_modules|packages?)\/[\w./-]+/g,
];

// 함수/메서드 패턴
const FUNCTION_PATTERNS = [
  /(?:function|const|let|var|def|fn)\s+(\w+)\s*[(<]/g,
  /(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/g,
  /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?:=>|{)/g,
  /\.(\w+)\s*\(/g,
];

// 기술 용어 패턴
const TECH_TERMS = new Set([
  // Languages
  'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'kotlin', 'swift',
  // Frameworks
  'react', 'vue', 'angular', 'next', 'nuxt', 'svelte', 'express', 'fastapi', 'django',
  // Tools
  'webpack', 'vite', 'esbuild', 'rollup', 'babel', 'eslint', 'prettier',
  // Databases
  'sqlite', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch',
  // Cloud
  'aws', 'gcp', 'azure', 'vercel', 'netlify', 'cloudflare',
  // Concepts
  'api', 'rest', 'graphql', 'grpc', 'websocket', 'oauth', 'jwt', 'cors',
  'docker', 'kubernetes', 'ci', 'cd', 'git', 'github', 'gitlab',
  'mcp', 'llm', 'ai', 'ml', 'openai', 'anthropic', 'claude', 'gpt',
]);

// 결정 힌트 키워드
const DECISION_KEYWORDS = [
  '결정', '선택', '채택', '사용하기로', '하기로 했', '으로 진행',
  'decided', 'choose', 'selected', 'will use', 'going with', 'opted for',
  '확정', '최종', 'final', 'confirmed',
];

// URL 패턴
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

// 해시태그 패턴
const HASHTAG_PATTERN = /#[\w가-힣]+/g;

// 숫자 패턴 (버전, 포트 등)
const NUMBER_PATTERNS = [
  /v?\d+\.\d+(?:\.\d+)?/g,  // 버전
  /:\d{2,5}/g,              // 포트
  /\d+(?:k|K|m|M|g|G|t|T)?(?:b|B)?/g,  // 크기
];

export class Indexer {
  /**
   * 텍스트에서 메타데이터 추출
   */
  extract(text: string): ExtractedMetadata {
    return {
      filePaths: this.extractFilePaths(text),
      functionNames: this.extractFunctionNames(text),
      techTerms: this.extractTechTerms(text),
      hashtags: this.extractHashtags(text),
      decisionHints: this.extractDecisionHints(text),
      urls: this.extractUrls(text),
      numbers: this.extractNumbers(text),
    };
  }

  /**
   * 파일 경로 추출
   */
  private extractFilePaths(text: string): string[] {
    const paths = new Set<string>();
    
    for (const pattern of FILE_PATH_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern));
      for (const match of matches) {
        const path = match[1] || match[0];
        if (path && this.isValidFilePath(path)) {
          paths.add(path.trim());
        }
      }
    }

    return Array.from(paths);
  }

  /**
   * 유효한 파일 경로인지 확인
   */
  private isValidFilePath(path: string): boolean {
    // 너무 짧거나 긴 경로 제외
    if (path.length < 3 || path.length > 200) return false;
    
    // 일반적인 파일 확장자 확인
    const validExtensions = /\.(ts|js|tsx|jsx|py|rs|go|java|kt|swift|json|yaml|yml|md|txt|sql|sh|bash|css|scss|html|vue|svelte)$/i;
    return validExtensions.test(path);
  }

  /**
   * 함수/메서드명 추출
   */
  private extractFunctionNames(text: string): string[] {
    const names = new Set<string>();
    
    for (const pattern of FUNCTION_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern));
      for (const match of matches) {
        const name = match[1];
        if (name && this.isValidFunctionName(name)) {
          names.add(name);
        }
      }
    }

    return Array.from(names);
  }

  /**
   * 유효한 함수명인지 확인
   */
  private isValidFunctionName(name: string): boolean {
    // 예약어 제외
    const reserved = new Set(['if', 'else', 'for', 'while', 'return', 'const', 'let', 'var', 'function', 'class', 'import', 'export', 'from', 'async', 'await']);
    if (reserved.has(name.toLowerCase())) return false;
    
    // 너무 짧거나 긴 이름 제외
    if (name.length < 2 || name.length > 50) return false;
    
    // 숫자로 시작하면 제외
    if (/^\d/.test(name)) return false;

    return true;
  }

  /**
   * 기술 용어 추출
   */
  private extractTechTerms(text: string): string[] {
    const terms = new Set<string>();
    const words = text.toLowerCase().split(/[\s.,;:!?()\[\]{}'"]+/);
    
    for (const word of words) {
      if (TECH_TERMS.has(word)) {
        terms.add(word);
      }
    }

    return Array.from(terms);
  }

  /**
   * 해시태그 추출
   */
  private extractHashtags(text: string): string[] {
    const matches = text.match(HASHTAG_PATTERN) || [];
    return [...new Set(matches)];
  }

  /**
   * 결정 힌트 추출
   */
  private extractDecisionHints(text: string): string[] {
    const hints: string[] = [];
    const sentences = text.split(/[.!?。！？]\s*/);
    
    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      for (const keyword of DECISION_KEYWORDS) {
        if (lowerSentence.includes(keyword.toLowerCase())) {
          hints.push(sentence.trim());
          break;
        }
      }
    }

    return hints.slice(0, 10); // 최대 10개
  }

  /**
   * URL 추출
   */
  private extractUrls(text: string): string[] {
    const matches = text.match(URL_PATTERN) || [];
    return [...new Set(matches)];
  }

  /**
   * 숫자 패턴 추출 (버전, 포트 등)
   */
  private extractNumbers(text: string): string[] {
    const numbers = new Set<string>();
    
    for (const pattern of NUMBER_PATTERNS) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        numbers.add(match);
      }
    }

    return Array.from(numbers);
  }

  /**
   * 모든 태그 추출 (통합)
   */
  extractTags(text: string): string[] {
    const metadata = this.extract(text);
    const tags = new Set<string>();

    // 기술 용어 추가
    metadata.techTerms.forEach(t => tags.add(t));
    
    // 해시태그 추가 (# 제거)
    metadata.hashtags.forEach(h => tags.add(h.replace('#', '')));
    
    // 파일 확장자 추가
    metadata.filePaths.forEach(p => {
      const ext = p.split('.').pop();
      if (ext) tags.add(ext);
    });

    return Array.from(tags);
  }
}

export const indexer = new Indexer();
