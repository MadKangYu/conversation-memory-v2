/**
 * SQLite Storage - SQLite + FTS5 기반 저장소
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import {
  Message,
  Chunk,
  ChunkSummary,
  MergedContext,
  Conversation,
  CacheEntry,
  PendingTask,
  SearchResult,
  SearchOptions,
  ConvMemoryConfig,
  DEFAULT_CONFIG,
} from '../types.js';
import { generateId } from '../utils/helpers.js';

export class SQLiteStorage {
  private db: Database.Database;
  private config: ConvMemoryConfig;

  constructor(config: Partial<ConvMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 디렉토리 생성
    const dbDir = dirname(this.config.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    this.initSchema();
  }

  /**
   * 스키마 초기화
   */
  private initSchema(): void {
    this.db.exec(`
      -- Conversations
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_path);
      CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

      -- Messages
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(timestamp);

      -- Messages FTS (Full-Text Search)
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid'
      );

      -- Triggers for FTS sync
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      -- Chunks
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        start_index INTEGER NOT NULL,
        end_index INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        summary_json TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chunk_conv ON chunks(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_chunk_status ON chunks(status);

      -- Merged Contexts
      CREATE TABLE IF NOT EXISTS merged_contexts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        decisions_json TEXT NOT NULL,
        tasks_json TEXT NOT NULL,
        code_changes_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        chunk_ids_json TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ctx_conv ON merged_contexts(conversation_id);

      -- Merged Contexts FTS
      CREATE VIRTUAL TABLE IF NOT EXISTS contexts_fts USING fts5(
        summary,
        content='merged_contexts',
        content_rowid='rowid'
      );

      -- Cache
      CREATE TABLE IF NOT EXISTS cache (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        hit_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_cache_conv ON cache(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);

      -- Pending Tasks
      CREATE TABLE IF NOT EXISTS pending_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        attempts INTEGER DEFAULT 0,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_task_priority ON pending_tasks(priority DESC, created_at);
    `);
  }

  // ============================================================================
  // Conversation Operations
  // ============================================================================

  createConversation(projectPath: string, title?: string): Conversation {
    const now = Date.now();
    const conv: Conversation = {
      id: generateId('conv'),
      projectPath,
      title,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      tokenCount: 0,
      isArchived: false,
    };

    this.db.prepare(`
      INSERT INTO conversations (id, project_path, title, created_at, updated_at, message_count, token_count, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(conv.id, conv.projectPath, conv.title, conv.createdAt, conv.updatedAt, conv.messageCount, conv.tokenCount, 0);

    return conv;
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToConversation(row);
  }

  getConversationByProject(projectPath: string): Conversation | null {
    const row = this.db.prepare(
      'SELECT * FROM conversations WHERE project_path = ? AND is_archived = 0 ORDER BY updated_at DESC LIMIT 1'
    ).get(projectPath) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToConversation(row);
  }

  listConversations(limit: number = 50): Conversation[] {
    const rows = this.db.prepare(
      'SELECT * FROM conversations WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT ?'
    ).all(limit) as Record<string, unknown>[];
    return rows.map(this.rowToConversation);
  }

  archiveConversation(id: string): void {
    this.db.prepare('UPDATE conversations SET is_archived = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  private rowToConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      projectPath: row.project_path as string,
      title: row.title as string | undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      messageCount: row.message_count as number,
      tokenCount: row.token_count as number,
      isArchived: Boolean(row.is_archived),
    };
  }

  // ============================================================================
  // Message Operations
  // ============================================================================

  saveMessage(message: Message): void {
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp, token_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.timestamp,
      message.tokenCount,
      message.metadata ? JSON.stringify(message.metadata) : null
    );

    // 대화 통계 업데이트
    this.db.prepare(`
      UPDATE conversations 
      SET message_count = message_count + 1, 
          token_count = token_count + ?,
          updated_at = ?
      WHERE id = ?
    `).run(message.tokenCount, Date.now(), message.conversationId);
  }

  getMessages(conversationId: string, limit?: number): Message[] {
    const query = limit
      ? 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp LIMIT ?'
      : 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp';
    
    const rows = (limit
      ? this.db.prepare(query).all(conversationId, limit)
      : this.db.prepare(query).all(conversationId)) as Record<string, unknown>[];
    
    return rows.map(this.rowToMessage);
  }

  getRecentMessages(conversationId: string, count: number): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?
      ) ORDER BY timestamp
    `).all(conversationId, count) as Record<string, unknown>[];
    return rows.map(this.rowToMessage);
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content as string,
      timestamp: row.timestamp as number,
      tokenCount: row.token_count as number,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  // ============================================================================
  // Chunk Operations
  // ============================================================================

  saveChunk(chunk: Chunk): void {
    this.db.prepare(`
      INSERT INTO chunks (id, conversation_id, messages_json, start_index, end_index, token_count, status, created_at, summary_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id,
      chunk.conversationId,
      JSON.stringify(chunk.messages),
      chunk.startIndex,
      chunk.endIndex,
      chunk.tokenCount,
      chunk.status,
      chunk.createdAt,
      chunk.summary ? JSON.stringify(chunk.summary) : null
    );
  }

  updateChunkSummary(chunkId: string, summary: ChunkSummary): void {
    this.db.prepare(`
      UPDATE chunks SET summary_json = ?, status = 'summarized' WHERE id = ?
    `).run(JSON.stringify(summary), chunkId);
  }

  updateChunkStatus(chunkId: string, status: string): void {
    this.db.prepare('UPDATE chunks SET status = ? WHERE id = ?').run(status, chunkId);
  }

  getPendingChunks(limit: number = 10): Chunk[] {
    const rows = this.db.prepare(`
      SELECT * FROM chunks WHERE status = 'pending' ORDER BY created_at LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map(this.rowToChunk);
  }

  getSummarizedChunks(conversationId: string): Chunk[] {
    const rows = this.db.prepare(`
      SELECT * FROM chunks WHERE conversation_id = ? AND status = 'summarized' ORDER BY created_at
    `).all(conversationId) as Record<string, unknown>[];
    return rows.map(this.rowToChunk);
  }

  private rowToChunk(row: Record<string, unknown>): Chunk {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      messages: JSON.parse(row.messages_json as string),
      startIndex: row.start_index as number,
      endIndex: row.end_index as number,
      tokenCount: row.token_count as number,
      status: row.status as 'pending' | 'summarizing' | 'summarized' | 'merged',
      createdAt: row.created_at as number,
      summary: row.summary_json ? JSON.parse(row.summary_json as string) : undefined,
    };
  }

  // ============================================================================
  // Merged Context Operations
  // ============================================================================

  saveMergedContext(context: MergedContext): void {
    this.db.prepare(`
      INSERT INTO merged_contexts (id, conversation_id, summary, decisions_json, tasks_json, code_changes_json, tags_json, chunk_ids_json, token_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      context.id,
      context.conversationId,
      context.summary,
      JSON.stringify(context.decisions),
      JSON.stringify(context.tasks),
      JSON.stringify(context.codeChanges),
      JSON.stringify(context.tags),
      JSON.stringify(context.chunkIds),
      context.tokenCount,
      context.createdAt,
      context.updatedAt
    );

    // FTS 업데이트
    const rowid = this.db.prepare('SELECT rowid FROM merged_contexts WHERE id = ?').get(context.id) as { rowid: number };
    if (rowid) {
      this.db.prepare('INSERT INTO contexts_fts(rowid, summary) VALUES (?, ?)').run(rowid.rowid, context.summary);
    }
  }

  getMergedContext(conversationId: string): MergedContext | null {
    const row = this.db.prepare(`
      SELECT * FROM merged_contexts WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1
    `).get(conversationId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToMergedContext(row);
  }

  private rowToMergedContext(row: Record<string, unknown>): MergedContext {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      summary: row.summary as string,
      decisions: JSON.parse(row.decisions_json as string),
      tasks: JSON.parse(row.tasks_json as string),
      codeChanges: JSON.parse(row.code_changes_json as string),
      tags: JSON.parse(row.tags_json as string),
      chunkIds: JSON.parse(row.chunk_ids_json as string),
      tokenCount: row.token_count as number,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  search(options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];
    const { query, conversationId, limit = 20 } = options;

    // 메시지 검색
    if (!options.types || options.types.includes('message')) {
      const msgQuery = conversationId
        ? `SELECT m.*, snippet(messages_fts, 0, '<b>', '</b>', '...', 32) as snippet 
           FROM messages_fts 
           JOIN messages m ON messages_fts.rowid = m.rowid 
           WHERE messages_fts MATCH ? AND m.conversation_id = ?
           ORDER BY rank LIMIT ?`
        : `SELECT m.*, snippet(messages_fts, 0, '<b>', '</b>', '...', 32) as snippet 
           FROM messages_fts 
           JOIN messages m ON messages_fts.rowid = m.rowid 
           WHERE messages_fts MATCH ?
           ORDER BY rank LIMIT ?`;

      const rows = (conversationId
        ? this.db.prepare(msgQuery).all(query, conversationId, limit)
        : this.db.prepare(msgQuery).all(query, limit)) as Record<string, unknown>[];

      for (const row of rows) {
        results.push({
          id: row.id as string,
          type: 'message',
          content: row.content as string,
          score: 1,
          highlights: [row.snippet as string],
          metadata: { role: row.role, timestamp: row.timestamp },
        });
      }
    }

    // 컨텍스트 검색
    if (!options.types || options.types.includes('context')) {
      const ctxQuery = conversationId
        ? `SELECT mc.*, snippet(contexts_fts, 0, '<b>', '</b>', '...', 32) as snippet 
           FROM contexts_fts 
           JOIN merged_contexts mc ON contexts_fts.rowid = mc.rowid 
           WHERE contexts_fts MATCH ? AND mc.conversation_id = ?
           ORDER BY rank LIMIT ?`
        : `SELECT mc.*, snippet(contexts_fts, 0, '<b>', '</b>', '...', 32) as snippet 
           FROM contexts_fts 
           JOIN merged_contexts mc ON contexts_fts.rowid = mc.rowid 
           WHERE contexts_fts MATCH ?
           ORDER BY rank LIMIT ?`;

      const rows = (conversationId
        ? this.db.prepare(ctxQuery).all(query, conversationId, limit)
        : this.db.prepare(ctxQuery).all(query, limit)) as Record<string, unknown>[];

      for (const row of rows) {
        results.push({
          id: row.id as string,
          type: 'context',
          content: row.summary as string,
          score: 1,
          highlights: [row.snippet as string],
          metadata: { updatedAt: row.updated_at },
        });
      }
    }

    return results;
  }

  // ============================================================================
  // Pending Tasks Operations
  // ============================================================================

  addPendingTask(task: PendingTask): void {
    this.db.prepare(`
      INSERT INTO pending_tasks (id, type, target_id, priority, created_at, attempts, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, task.type, task.targetId, task.priority, task.createdAt, task.attempts, task.lastError);
  }

  getNextPendingTask(): PendingTask | null {
    const row = this.db.prepare(`
      SELECT * FROM pending_tasks ORDER BY priority DESC, created_at LIMIT 1
    `).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      type: row.type as 'summarize' | 'merge' | 'index',
      targetId: row.target_id as string,
      priority: row.priority as number,
      createdAt: row.created_at as number,
      attempts: row.attempts as number,
      lastError: row.last_error as string | undefined,
    };
  }

  completePendingTask(taskId: string): void {
    this.db.prepare('DELETE FROM pending_tasks WHERE id = ?').run(taskId);
  }

  failPendingTask(taskId: string, error: string): void {
    this.db.prepare(`
      UPDATE pending_tasks SET attempts = attempts + 1, last_error = ? WHERE id = ?
    `).run(error, taskId);
  }

  getPendingTaskCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM pending_tasks').get() as { count: number };
    return row.count;
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getStats(): {
    conversations: number;
    messages: number;
    chunks: number;
    mergedContexts: number;
    totalTokens: number;
  } {
    const convCount = (this.db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }).c;
    const msgCount = (this.db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;
    const chunkCount = (this.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number }).c;
    const ctxCount = (this.db.prepare('SELECT COUNT(*) as c FROM merged_contexts').get() as { c: number }).c;
    const tokenSum = (this.db.prepare('SELECT COALESCE(SUM(token_count), 0) as t FROM conversations').get() as { t: number }).t;

    return {
      conversations: convCount,
      messages: msgCount,
      chunks: chunkCount,
      mergedContexts: ctxCount,
      totalTokens: tokenSum,
    };
  }

  /**
   * 데이터베이스 닫기
   */
  close(): void {
    this.db.close();
  }
}
