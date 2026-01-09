/**
 * Storage Provider Interface
 * 
 * 로컬(SQLite)과 클라우드(Supabase) 저장소를 추상화하는 인터페이스입니다.
 * MemoryManager는 이 인터페이스를 통해 데이터를 저장하고 조회합니다.
 */

export interface ConversationItem {
  id?: string | number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  project_path: string;
  git_branch: string;
  is_compressed?: boolean;
}

export interface Memory {
  id: number;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface MemoryState {
  summary: string;
  key_facts: string[];
  last_updated: number;
}

export interface CompressedContext {
  summary: string;
  key_facts: string[];
  recent_history: ConversationItem[];
  token_count: number;
  project_context: {
    path: string;
    branch: string;
  };
}

export interface StorageProvider {
  /**
   * 초기화 (DB 연결, 테이블 생성 등)
   */
  init(): Promise<void>;

  /**
   * 대화 로그 추가
   */
  addLog(item: ConversationItem): Promise<void>;

  /**
   * 특정 프로젝트/브랜치의 최근 대화 로그 조회
   */
  getRecentLogs(projectPath: string, gitBranch: string, limit: number): Promise<ConversationItem[]>;

  /**
   * 압축되지 않은 로그 조회
   */
  getUncompressedLogs(projectPath: string, gitBranch: string): Promise<ConversationItem[]>;

  /**
   * 로그를 압축됨으로 표시
   */
  markLogsAsCompressed(ids: (string | number)[]): Promise<void>;

  /**
   * 메모리 상태(요약) 조회
   */
  getMemoryState(projectPath: string, gitBranch: string): Promise<MemoryState | null>;

  /**
   * 메모리 상태(요약) 업데이트
   */
  updateMemoryState(projectPath: string, gitBranch: string, state: MemoryState): Promise<void>;

  /**
   * 압축 필요 여부 확인 (압축되지 않은 로그 개수 반환)
   */
  getUncompressedCount(projectPath: string, gitBranch: string): Promise<number>;
}
