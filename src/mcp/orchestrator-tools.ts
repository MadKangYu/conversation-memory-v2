/**
 * 오케스트라 협력 도구
 * 
 * Claude Code / OpenCode와의 자동 협력을 위한 MCP 도구
 * - 자동 압축 트리거
 * - 컨텍스트 상태 모니터링
 * - 세션 관리
 */

import { ConversationMemory } from '../memory.js';

export interface CompressionStatus {
  shouldCompress: boolean;
  reason: string;
  currentTokens: number;
  threshold: number;
  compressionRatio: number;
  recommendation: string;
}

export interface ContextSnapshot {
  sessionId: string;
  totalMessages: number;
  totalTokens: number;
  compressionRatio: number;
  lastActivity: Date;
  health: 'healthy' | 'warning' | 'critical';
}

export interface AutoSaveResult {
  saved: boolean;
  messageId: string;
  tokenCount: number;
  bufferStatus: {
    current: number;
    threshold: number;
    percentage: number;
  };
  compressionTriggered: boolean;
}

/**
 * 오케스트라 협력 도구 클래스
 */
export class OrchestratorTools {
  private memory: ConversationMemory;
  private compressionThreshold: number;
  private warningThreshold: number;

  constructor(memory: ConversationMemory, options?: {
    compressionThreshold?: number;
    warningThreshold?: number;
  }) {
    this.memory = memory;
    this.compressionThreshold = options?.compressionThreshold ?? 50000; // 50K 토큰
    this.warningThreshold = options?.warningThreshold ?? 30000; // 30K 토큰
  }

  /**
   * 압축 필요 여부 확인
   * 
   * 오케스트라가 매 응답 전 호출하여 압축 필요 여부 판단
   */
  async shouldCompress(): Promise<CompressionStatus> {
    const stats = this.memory.getStats();
    const currentTokens = stats.totalTokens;
    
    const shouldCompress = currentTokens > this.compressionThreshold;
    const isWarning = currentTokens > this.warningThreshold;

    let reason: string;
    let recommendation: string;

    if (shouldCompress) {
      reason = `현재 토큰 수(${currentTokens.toLocaleString()})가 임계값(${this.compressionThreshold.toLocaleString()})을 초과했습니다.`;
      recommendation = 'memory_get_context를 호출하여 압축된 컨텍스트로 교체하세요.';
    } else if (isWarning) {
      reason = `현재 토큰 수(${currentTokens.toLocaleString()})가 경고 수준(${this.warningThreshold.toLocaleString()})에 도달했습니다.`;
      recommendation = '곧 압축이 필요합니다. 계속 진행하되 모니터링하세요.';
    } else {
      reason = `현재 토큰 수(${currentTokens.toLocaleString()})가 안전 범위 내입니다.`;
      recommendation = '정상적으로 대화를 계속하세요.';
    }

    return {
      shouldCompress,
      reason,
      currentTokens,
      threshold: this.compressionThreshold,
      compressionRatio: stats.compressionRatio,
      recommendation
    };
  }

  /**
   * 컨텍스트 스냅샷 조회
   * 
   * 현재 세션의 상태를 한눈에 파악
   */
  async getSnapshot(): Promise<ContextSnapshot> {
    const stats = this.memory.getStats();
    const currentConversationId = this.memory.getCurrentConversationId();

    let health: 'healthy' | 'warning' | 'critical';
    if (stats.totalTokens > this.compressionThreshold) {
      health = 'critical';
    } else if (stats.totalTokens > this.warningThreshold) {
      health = 'warning';
    } else {
      health = 'healthy';
    }

    return {
      sessionId: currentConversationId || 'none',
      totalMessages: stats.messages,
      totalTokens: stats.totalTokens,
      compressionRatio: stats.compressionRatio,
      lastActivity: new Date(),
      health
    };
  }

  /**
   * 메시지 자동 저장 및 상태 반환
   * 
   * 오케스트라가 모든 메시지를 저장할 때 사용
   * 압축 필요 여부도 함께 반환
   */
  async autoSaveMessage(
    role: 'user' | 'assistant',
    content: string
  ): Promise<AutoSaveResult> {
    // 메시지 저장
    const message = await this.memory.addMessage(role, content);
    const tokenCount = message.tokenCount;

    // 버퍼 상태 확인
    const bufferStatus = this.memory.getBufferStatus();

    // 압축 트리거 여부
    const compressionStatus = await this.shouldCompress();

    return {
      saved: true,
      messageId: message.id,
      tokenCount,
      bufferStatus: {
        current: bufferStatus.tokenCount,
        threshold: 500,
        percentage: Math.round(bufferStatus.fillPercent)
      },
      compressionTriggered: compressionStatus.shouldCompress
    };
  }

  /**
   * 세션 시작 시 이전 컨텍스트 로드
   * 
   * 새 세션 시작 시 자동으로 이전 컨텍스트 복원
   */
  async initializeSession(topic?: string): Promise<{
    sessionId: string;
    previousContext: string | null;
    previousTokens: number;
    isNewSession: boolean;
  }> {
    // 기존 대화 확인
    const existingConversationId = this.memory.getCurrentConversationId();
    
    if (existingConversationId && !topic) {
      // 기존 세션 계속
      const context = await this.memory.getContext();
      const stats = this.memory.getStats();
      return {
        sessionId: existingConversationId,
        previousContext: context,
        previousTokens: stats.totalTokens,
        isNewSession: false
      };
    }

    // 새 세션 시작
    const conversation = this.memory.startConversation(
      process.cwd(),
      topic || 'New Session'
    );
    
    // 이전 세션의 컨텍스트 로드 시도
    const previousContext = await this.memory.getContext();
    const stats = this.memory.getStats();
    
    return {
      sessionId: conversation.id,
      previousContext: previousContext || null,
      previousTokens: stats.totalTokens,
      isNewSession: true
    };
  }

  /**
   * 강제 압축 실행
   * 
   * 즉시 압축을 실행하고 결과 반환
   */
  async forceCompress(): Promise<{
    success: boolean;
    beforeTokens: number;
    afterTokens: number;
    compressionRatio: number;
    compressedContext: string;
  }> {
    const beforeStats = this.memory.getStats();
    
    // 강제 압축 실행
    await this.memory.forceCompress();
    
    const afterStats = this.memory.getStats();
    const context = await this.memory.getContext();

    const compressionRatio = beforeStats.totalTokens > 0
      ? Math.round((1 - afterStats.totalTokens / beforeStats.totalTokens) * 100)
      : 0;

    return {
      success: true,
      beforeTokens: beforeStats.totalTokens,
      afterTokens: afterStats.totalTokens,
      compressionRatio,
      compressedContext: context || ''
    };
  }

  /**
   * 임계값 동적 조정
   */
  setThresholds(compression: number, warning: number): void {
    this.compressionThreshold = compression;
    this.warningThreshold = warning;
  }

  /**
   * 현재 설정 조회
   */
  getConfig(): {
    compressionThreshold: number;
    warningThreshold: number;
  } {
    return {
      compressionThreshold: this.compressionThreshold,
      warningThreshold: this.warningThreshold
    };
  }
}

/**
 * MCP 도구 정의 생성
 */
export function createOrchestratorToolDefinitions() {
  return [
    {
      name: 'memory_should_compress',
      description: `압축 필요 여부를 확인합니다.

**중요**: 오케스트라(Claude Code/OpenCode)는 매 응답 전 이 도구를 호출해야 합니다.

반환값:
- shouldCompress: 압축 필요 여부 (true면 memory_get_context 호출 필요)
- currentTokens: 현재 총 토큰 수
- threshold: 압축 임계값
- recommendation: 권장 조치`,
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'memory_auto_save',
      description: `메시지를 저장하고 상태를 반환합니다.

오케스트라의 모든 메시지를 저장할 때 사용합니다.
압축 필요 여부도 함께 반환하여 추가 호출을 줄입니다.`,
      inputSchema: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['user', 'assistant'],
            description: '메시지 역할'
          },
          content: {
            type: 'string',
            description: '메시지 내용'
          }
        },
        required: ['role', 'content']
      }
    },
    {
      name: 'memory_get_snapshot',
      description: `현재 세션의 상태 스냅샷을 조회합니다.

반환값:
- sessionId: 현재 세션 ID
- totalTokens: 총 토큰 수
- health: 상태 (healthy/warning/critical)`,
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'memory_initialize_session',
      description: `세션을 초기화하고 이전 컨텍스트를 로드합니다.

새 대화 시작 시 또는 이전 세션 복원 시 사용합니다.`,
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: '대화 주제 (선택사항, 없으면 기존 세션 계속)'
          }
        },
        required: []
      }
    },
    {
      name: 'memory_set_thresholds',
      description: `압축 임계값을 동적으로 조정합니다.`,
      inputSchema: {
        type: 'object',
        properties: {
          compressionThreshold: {
            type: 'number',
            description: '압축 트리거 토큰 수 (기본 50000)'
          },
          warningThreshold: {
            type: 'number',
            description: '경고 토큰 수 (기본 30000)'
          }
        },
        required: ['compressionThreshold', 'warningThreshold']
      }
    }
  ];
}
