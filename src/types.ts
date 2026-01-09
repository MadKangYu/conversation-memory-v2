/**
 * Conversation Memory V2 - Type Definitions
 * OpenCode/ClaudeCode 호환 CLI 에이전트
 */

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Chunk Types
// ============================================================================

export type ChunkStatus = 'pending' | 'summarizing' | 'summarized' | 'merged';

export interface Chunk {
  id: string;
  conversationId: string;
  messages: Message[];
  startIndex: number;
  endIndex: number;
  tokenCount: number;
  status: ChunkStatus;
  createdAt: number;
  summary?: ChunkSummary;
}

export interface ChunkSummary {
  summary: string;
  decisions: Decision[];
  tasks: Task[];
  codeChanges: CodeChange[];
  tags: string[];
  tokenCount: number;
  createdAt: number;
}

// ============================================================================
// Structured Output Schema
// ============================================================================

export type Importance = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type Priority = 'low' | 'medium' | 'high';
export type ChangeType = 'create' | 'modify' | 'delete';

export interface Decision {
  id: string;
  description: string;
  importance: Importance;
}

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
}

export interface CodeChange {
  filePath: string;
  changeType: ChangeType;
  description: string;
}

// ============================================================================
// Merged Context Types
// ============================================================================

export interface MergedContext {
  id: string;
  conversationId: string;
  summary: string;
  decisions: Decision[];
  tasks: Task[];
  codeChanges: CodeChange[];
  tags: TagWeight[];
  chunkIds: string[];
  tokenCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface TagWeight {
  tag: string;
  weight: number;
  frequency: number;
  lastSeen: number;
}

// ============================================================================
// Conversation Types
// ============================================================================

export interface Conversation {
  id: string;
  projectPath: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tokenCount: number;
  isArchived: boolean;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry {
  id: string;
  conversationId: string;
  content: string;
  tokenCount: number;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

// ============================================================================
// Background Worker Types
// ============================================================================

export interface PendingTask {
  id: string;
  type: 'summarize' | 'merge' | 'index';
  targetId: string;
  priority: number;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface WorkerStats {
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageProcessingTime: number;
  lastRunAt: number;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchResult {
  id: string;
  type: 'message' | 'chunk' | 'context';
  content: string;
  score: number;
  highlights: string[];
  metadata: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  conversationId?: string;
  limit?: number;
  offset?: number;
  types?: ('message' | 'chunk' | 'context')[];
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ConvMemoryConfig {
  // Chunking
  chunkTokenThreshold: number;
  chunkOverlapPercent: number;
  
  // Compression
  compressionModel: string;
  compressionApiKey?: string;
  compressionBaseUrl?: string;
  
  // Merging
  mergeThreshold: number;
  jaccardThreshold: number;
  
  // Cache
  cacheTtlSeconds: number;
  maxCacheEntries: number;
  
  // Database
  dbPath: string;
  
  // Background Worker
  workerIntervalMs: number;
  maxRetries: number;
}

export const DEFAULT_CONFIG: ConvMemoryConfig = {
  chunkTokenThreshold: 500,
  chunkOverlapPercent: 10,
  compressionModel: 'claude-haiku-4-5',
  mergeThreshold: 5,
  jaccardThreshold: 0.7,
  cacheTtlSeconds: 3600,
  maxCacheEntries: 100,
  dbPath: '.conv-memory/memory.db',
  workerIntervalMs: 5000,
  maxRetries: 3,
};

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface MCPContext {
  messages: Array<{
    role: MessageRole;
    content: string;
  }>;
  cacheControl?: {
    type: 'ephemeral';
  };
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIOptions {
  verbose?: boolean;
  config?: string;
  projectPath?: string;
}

export interface StatsOutput {
  conversations: number;
  messages: number;
  chunks: number;
  mergedContexts: number;
  totalTokens: number;
  savedTokens: number;
  compressionRatio: number;
}
