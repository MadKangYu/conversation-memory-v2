import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { InstantCompressorV3 } from './instant-compressor-v3.js';
import { StorageProvider, CompressedContext, ConversationItem, Memory } from './storage/types.js';
import { SQLiteProvider } from './storage/sqlite-provider.js';

export class MemoryManager {
  private storage: StorageProvider;
  private compressor: InstantCompressorV3;
  private readonly MAX_RECENT_ITEMS = 10;
  private readonly COMPRESSION_THRESHOLD = 5;

  constructor(dbPath?: string) {
    // dbPath가 없으면 현재 디렉토리의 .forge/memory.db 사용
    if (!dbPath) {
      const projectRoot = process.cwd();
      const forgeDir = path.join(projectRoot, '.forge');
      
      // .forge 디렉토리 생성
      if (!fs.existsSync(forgeDir)) {
        fs.mkdirSync(forgeDir, { recursive: true });
      }

      // .gitignore에 .forge 추가
      const gitignorePath = path.join(projectRoot, '.gitignore');
      const ignoreContent = '\n.forge/\n';
      
      if (fs.existsSync(gitignorePath)) {
        const currentContent = fs.readFileSync(gitignorePath, 'utf-8');
        if (!currentContent.includes('.forge/')) {
          fs.appendFileSync(gitignorePath, ignoreContent);
        }
      } else {
        fs.writeFileSync(gitignorePath, ignoreContent);
      }

      dbPath = path.join(forgeDir, 'memory.db');
    }

    this.storage = new SQLiteProvider(dbPath);
    this.compressor = new InstantCompressorV3();
    
    this.storage.init().catch(console.error);
  }

  /**
   * 의미 기반 기억 검색 (RAG용)
   * 현재는 SQLite의 LIKE 쿼리를 활용한 키워드 검색으로 구현
   */
  async search(query: string, options: { limit?: number } = {}): Promise<Memory[]> {
    const limit = options.limit || 5;
    
    // 1. 쿼리에서 주요 키워드 추출 (간단히 공백으로 분리하고 2글자 이상인 것만)
    const keywords = query.split(/\s+/).filter(w => w.length > 2);
    
    if (keywords.length === 0) return [];

    // 2. 저장소에서 키워드가 포함된 로그 검색 (SQLiteProvider에 searchLogs 메서드가 있다고 가정하거나 직접 구현 필요)
    // 여기서는 getRecentLogs를 활용하여 메모리 내에서 필터링하는 방식으로 임시 구현
    // 실제 프로덕션에서는 FTS(Full Text Search) 또는 Vector DB 사용 권장
    
    const projectPath = process.cwd();
    const branch = this.getGitBranch(projectPath);
    
    // 최근 100개 정도 가져와서 검색 (성능 고려)
    const recentLogs = await this.storage.getRecentLogs(projectPath, branch, 100);
    
    const results: Memory[] = recentLogs
      .filter(log => keywords.some(k => log.content.toLowerCase().includes(k.toLowerCase())))
      .map(log => ({
        id: log.id?.toString() || Date.now().toString(),
        content: log.content,
        type: 'conversation',
        timestamp: log.timestamp,
        metadata: { role: log.role }
      }))
      .slice(0, limit);

    return results;
  }

  /**
   * 현재 작업 디렉토리의 Git 브랜치 이름을 가져옵니다.
   */
  private getGitBranch(cwd: string): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { 
        cwd, 
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'] 
      }).trim();
    } catch (e) {
      return 'unknown';
    }
  }

  /**
   * 대화 내용을 추가합니다.
   */
  public async addItem(role: 'user' | 'assistant' | 'system' | 'tool', content: string, cwd: string = process.cwd()) {
    const branch = this.getGitBranch(cwd);
    
    const item: ConversationItem = {
      role,
      content,
      timestamp: Date.now(),
      project_path: cwd,
      git_branch: branch
    };

    await this.storage.addLog(item);
    await this.checkAndCompress(cwd, branch);
  }

  /**
   * 현재 컨텍스트(프로젝트/브랜치)에 맞는 기억을 인출합니다.
   */
  public getContext(cwd: string = process.cwd()): CompressedContext {
    throw new Error("Use getContextAsync instead");
  }

  public async getContextAsync(cwd: string = process.cwd()): Promise<CompressedContext> {
    const branch = this.getGitBranch(cwd);

    // 1. 상태 조회
    let state = await this.storage.getMemoryState(cwd, branch);
    if (!state) {
      state = { summary: '', key_facts: [], last_updated: 0 };
    }

    // 2. 최근 대화 조회
    const recentItems = await this.storage.getRecentLogs(cwd, branch, this.MAX_RECENT_ITEMS);

    return {
      summary: state.summary,
      key_facts: state.key_facts,
      recent_history: recentItems,
      token_count: this.estimateTokens(state.summary) + this.estimateTokens(JSON.stringify(recentItems)),
      project_context: {
        path: cwd,
        branch: branch
      }
    };
  }

  private async checkAndCompress(projectPath: string, branch: string) {
    const count = await this.storage.getUncompressedCount(projectPath, branch);

    if (count >= this.COMPRESSION_THRESHOLD) {
      await this.runCompression(projectPath, branch);
    }
  }

  private async runCompression(projectPath: string, branch: string) {
    const newItems = await this.storage.getUncompressedLogs(projectPath, branch);

    if (newItems.length === 0) return;

    // Combine new items into a single text block for compression
    const textToCompress = newItems.map(item => `${item.role}: ${item.content}`).join('\n');
    
    // Use the high-performance V3 compressor
    const result = this.compressor.compress(textToCompress);

    // Update State
    const currentState = await this.storage.getMemoryState(projectPath, branch);
    const currentSummary = currentState ? currentState.summary : '';
    const newSummary = currentSummary ? (currentSummary + "\n" + result.finalText) : result.finalText;

    await this.storage.updateMemoryState(projectPath, branch, {
      summary: newSummary,
      key_facts: [], // V3 Compressor doesn't extract key facts separately yet
      last_updated: Date.now()
    });

    // Mark items as compressed
    const ids = newItems.map(item => item.id!).filter(id => id !== undefined);
    await this.storage.markLogsAsCompressed(ids);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
