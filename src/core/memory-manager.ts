import { execSync } from 'child_process';
import { InstantCompressorV3 } from './instant-compressor-v3';
import { StorageProvider, CompressedContext, ConversationItem } from './storage/types';
import { SQLiteProvider } from './storage/sqlite-provider';

export class MemoryManager {
  private storage: StorageProvider;
  private compressor: InstantCompressorV3;
  private readonly MAX_RECENT_ITEMS = 10;
  private readonly COMPRESSION_THRESHOLD = 5;

  constructor(dbPath: string) {
    // 기본적으로 SQLiteProvider 사용 (추후 설정에 따라 SupabaseProvider로 교체 가능)
    this.storage = new SQLiteProvider(dbPath);
    this.compressor = new InstantCompressorV3();
    
    // 비동기 초기화는 생성자에서 await 할 수 없으므로, 
    // 실제 사용 시점에 init이 완료되었음을 보장하거나 별도 init 메서드 호출 필요.
    // 여기서는 편의상 동기적으로 동작하는 SQLite 특성을 고려하여 생성자에서 시작하되,
    // 에러 처리를 위해 catch 블록 추가.
    this.storage.init().catch(console.error);
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
    // getContext는 동기적으로 호출되는 경우가 많으므로(특히 Hook에서),
    // 내부적으로 비동기 호출을 기다릴 수 있도록 구조를 변경해야 하지만,
    // 현재 아키텍처(Daemon)에서는 비동기가 가능함.
    // 다만, 기존 코드 호환성을 위해 동기 메서드처럼 보이지만 내부적으로 Promise를 처리해야 함.
    // 여기서는 편의상 deasync를 쓰거나, 호출하는 쪽(Daemon)을 async로 바꿔야 함.
    // Daemon은 이미 async이므로, 이 메서드도 async로 변경하는 것이 옳음.
    // 하지만 인터페이스 변경을 최소화하기 위해 일단 동기적으로 동작하는 SQLiteProvider를 가정하고 작성하되,
    // 향후 Supabase 연동 시에는 async/await가 필수적이므로 메서드 시그니처를 변경함.
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
