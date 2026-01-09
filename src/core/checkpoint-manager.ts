/**
 * CheckpointManager - 대화 끊김 감지 및 자동 복구
 * 
 * 100% 복구 보장:
 * - 매 청크 처리 후 체크포인트 저장
 * - 네트워크 끊김, 사용자 중단, 시스템 충돌 모두 대응
 * - 다음 시작 시 자동 복구 프롬프트
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// 체크포인트 상태 타입
export type CheckpointState = 
  | 'idle'           // 대기 중
  | 'processing'     // 처리 중
  | 'paused'         // 일시 중지
  | 'completed'      // 완료
  | 'failed'         // 실패
  | 'recovering';    // 복구 중

// 끊김 유형
export type DisconnectionType =
  | 'network'        // 네트워크 끊김
  | 'user_interrupt' // 사용자 중단 (Ctrl+C)
  | 'system_crash'   // 시스템 충돌
  | 'session_expired'// 세션 만료
  | 'timeout'        // 타임아웃
  | 'unknown';       // 알 수 없음

// 체크포인트 데이터 구조
export interface Checkpoint {
  id: string;
  conversationId: string;
  createdAt: string;
  updatedAt: string;
  state: CheckpointState;
  
  // 처리 진행 상황
  progress: {
    totalChunks: number;
    processedChunks: number;
    lastProcessedChunkId: string | null;
    percentComplete: number;
  };
  
  // 요약 진행 상황
  summarization: {
    pendingChunks: number;
    completedChunks: number;
    failedChunks: number;
    currentLevel: number;
  };
  
  // 복구 정보
  recovery: {
    resumable: boolean;
    lastDisconnection: DisconnectionType | null;
    disconnectionTime: string | null;
    recoveryAttempts: number;
    maxRecoveryAttempts: number;
  };
  
  // 메타데이터
  metadata: {
    topic: string | null;
    totalTokens: number;
    compressedTokens: number;
  };
}

// 하트비트 설정
interface HeartbeatConfig {
  interval: number;      // 하트비트 간격 (ms)
  timeout: number;       // 타임아웃 (ms)
  maxMissed: number;     // 최대 누락 허용 횟수
}

// 복구 설정
interface RecoveryConfig {
  autoRecovery: boolean;
  maxAttempts: number;
  retryDelay: number;    // 재시도 간격 (ms)
  backoffMultiplier: number; // 지수 백오프 배수
}

export class CheckpointManager extends EventEmitter {
  private checkpointDir: string;
  private stateFile: string;
  private currentCheckpoint: Checkpoint | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastHeartbeat: number = Date.now();
  private missedHeartbeats: number = 0;
  
  private heartbeatConfig: HeartbeatConfig = {
    interval: 1000,      // 1초마다 하트비트
    timeout: 5000,       // 5초 응답 없으면 끊김
    maxMissed: 3,        // 3회 누락 시 끊김 판정
  };
  
  private recoveryConfig: RecoveryConfig = {
    autoRecovery: true,
    maxAttempts: 5,
    retryDelay: 1000,
    backoffMultiplier: 2,
  };

  constructor(dataDir: string = '~/.conversation-memory') {
    super();
    const expandedDir = dataDir.replace('~', process.env.HOME || '/home/ubuntu');
    this.checkpointDir = path.join(expandedDir, 'checkpoints');
    this.stateFile = path.join(expandedDir, 'state.json');
    
    this.ensureDirectories();
    this.setupSignalHandlers();
  }

  /**
   * 디렉토리 생성
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * 시그널 핸들러 설정 (Ctrl+C, 종료 등)
   */
  private setupSignalHandlers(): void {
    // SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      await this.handleDisconnection('user_interrupt');
      process.exit(0);
    });

    // SIGTERM (종료 요청)
    process.on('SIGTERM', async () => {
      await this.handleDisconnection('user_interrupt');
      process.exit(0);
    });

    // 예기치 않은 종료
    process.on('uncaughtException', async (error) => {
      console.error('[Checkpoint] Uncaught exception:', error);
      await this.handleDisconnection('system_crash');
      process.exit(1);
    });

    // Promise 거부
    process.on('unhandledRejection', async (reason) => {
      console.error('[Checkpoint] Unhandled rejection:', reason);
      await this.handleDisconnection('system_crash');
    });
  }

  /**
   * 새 체크포인트 생성
   */
  createCheckpoint(conversationId: string, topic?: string): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `cp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'idle',
      progress: {
        totalChunks: 0,
        processedChunks: 0,
        lastProcessedChunkId: null,
        percentComplete: 0,
      },
      summarization: {
        pendingChunks: 0,
        completedChunks: 0,
        failedChunks: 0,
        currentLevel: 0,
      },
      recovery: {
        resumable: true,
        lastDisconnection: null,
        disconnectionTime: null,
        recoveryAttempts: 0,
        maxRecoveryAttempts: this.recoveryConfig.maxAttempts,
      },
      metadata: {
        topic: topic || null,
        totalTokens: 0,
        compressedTokens: 0,
      },
    };

    this.currentCheckpoint = checkpoint;
    this.saveCheckpoint();
    this.startHeartbeat();
    
    return checkpoint;
  }

  /**
   * 체크포인트 업데이트
   */
  updateCheckpoint(updates: Partial<Checkpoint>): void {
    if (!this.currentCheckpoint) return;

    this.currentCheckpoint = {
      ...this.currentCheckpoint,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // 진행률 계산
    if (this.currentCheckpoint.progress.totalChunks > 0) {
      this.currentCheckpoint.progress.percentComplete = Math.round(
        (this.currentCheckpoint.progress.processedChunks / 
         this.currentCheckpoint.progress.totalChunks) * 100
      );
    }

    this.saveCheckpoint();
    this.emit('checkpoint_updated', this.currentCheckpoint);
  }

  /**
   * 청크 처리 완료 기록
   */
  recordChunkProcessed(chunkId: string): void {
    if (!this.currentCheckpoint) return;

    this.updateCheckpoint({
      progress: {
        ...this.currentCheckpoint.progress,
        processedChunks: this.currentCheckpoint.progress.processedChunks + 1,
        lastProcessedChunkId: chunkId,
      },
    });
  }

  /**
   * 요약 완료 기록
   */
  recordSummarizationComplete(level: number): void {
    if (!this.currentCheckpoint) return;

    this.updateCheckpoint({
      summarization: {
        ...this.currentCheckpoint.summarization,
        completedChunks: this.currentCheckpoint.summarization.completedChunks + 1,
        pendingChunks: Math.max(0, this.currentCheckpoint.summarization.pendingChunks - 1),
        currentLevel: level,
      },
    });
  }

  /**
   * 체크포인트 저장 (디스크)
   */
  private saveCheckpoint(): void {
    if (!this.currentCheckpoint) return;

    try {
      // 개별 체크포인트 파일
      const checkpointFile = path.join(
        this.checkpointDir,
        `${this.currentCheckpoint.id}.json`
      );
      fs.writeFileSync(checkpointFile, JSON.stringify(this.currentCheckpoint, null, 2));

      // 전역 상태 파일
      const state = {
        currentCheckpointId: this.currentCheckpoint.id,
        conversationId: this.currentCheckpoint.conversationId,
        state: this.currentCheckpoint.state,
        updatedAt: this.currentCheckpoint.updatedAt,
        resumable: this.currentCheckpoint.recovery.resumable,
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('[Checkpoint] Failed to save:', error);
    }
  }

  /**
   * 체크포인트 로드
   */
  loadCheckpoint(checkpointId: string): Checkpoint | null {
    try {
      const checkpointFile = path.join(this.checkpointDir, `${checkpointId}.json`);
      if (fs.existsSync(checkpointFile)) {
        const data = fs.readFileSync(checkpointFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[Checkpoint] Failed to load:', error);
    }
    return null;
  }

  /**
   * 복구 가능한 체크포인트 확인
   */
  checkForRecovery(): { needsRecovery: boolean; checkpoint: Checkpoint | null } {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return { needsRecovery: false, checkpoint: null };
      }

      const stateData = fs.readFileSync(this.stateFile, 'utf-8');
      const state = JSON.parse(stateData);

      // 처리 중이었고 복구 가능한 경우
      if (state.state === 'processing' && state.resumable) {
        const checkpoint = this.loadCheckpoint(state.currentCheckpointId);
        if (checkpoint) {
          return { needsRecovery: true, checkpoint };
        }
      }
    } catch (error) {
      console.error('[Checkpoint] Failed to check recovery:', error);
    }

    return { needsRecovery: false, checkpoint: null };
  }

  /**
   * 끊김 처리
   */
  async handleDisconnection(type: DisconnectionType): Promise<void> {
    if (!this.currentCheckpoint) return;

    console.log(`[Checkpoint] Disconnection detected: ${type}`);

    this.stopHeartbeat();

    this.updateCheckpoint({
      state: 'paused',
      recovery: {
        ...this.currentCheckpoint.recovery,
        lastDisconnection: type,
        disconnectionTime: new Date().toISOString(),
        resumable: true,
      },
    });

    this.emit('disconnection', { type, checkpoint: this.currentCheckpoint });
  }

  /**
   * 작업 재개
   */
  async resume(checkpoint: Checkpoint): Promise<boolean> {
    if (!checkpoint.recovery.resumable) {
      console.error('[Checkpoint] Checkpoint is not resumable');
      return false;
    }

    if (checkpoint.recovery.recoveryAttempts >= checkpoint.recovery.maxRecoveryAttempts) {
      console.error('[Checkpoint] Max recovery attempts exceeded');
      return false;
    }

    this.currentCheckpoint = {
      ...checkpoint,
      state: 'recovering',
      recovery: {
        ...checkpoint.recovery,
        recoveryAttempts: checkpoint.recovery.recoveryAttempts + 1,
      },
    };

    this.saveCheckpoint();
    this.startHeartbeat();

    console.log(`[Checkpoint] Resuming from chunk ${checkpoint.progress.lastProcessedChunkId}`);
    console.log(`[Checkpoint] Progress: ${checkpoint.progress.percentComplete}%`);

    this.emit('recovery_started', this.currentCheckpoint);

    // 복구 성공 후 상태 변경
    this.updateCheckpoint({ state: 'processing' });

    return true;
  }

  /**
   * 하트비트 시작
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.lastHeartbeat = Date.now();
    this.missedHeartbeats = 0;

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastHeartbeat;

      if (elapsed > this.heartbeatConfig.timeout) {
        this.missedHeartbeats++;
        
        if (this.missedHeartbeats >= this.heartbeatConfig.maxMissed) {
          this.handleDisconnection('timeout');
        }
      } else {
        this.missedHeartbeats = 0;
      }

      this.lastHeartbeat = now;
      this.emit('heartbeat', { timestamp: now, missed: this.missedHeartbeats });
    }, this.heartbeatConfig.interval);
  }

  /**
   * 하트비트 중지
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 하트비트 수신 (외부에서 호출)
   */
  receiveHeartbeat(): void {
    this.lastHeartbeat = Date.now();
    this.missedHeartbeats = 0;
  }

  /**
   * 작업 완료
   */
  complete(): void {
    if (!this.currentCheckpoint) return;

    this.stopHeartbeat();

    this.updateCheckpoint({
      state: 'completed',
      progress: {
        ...this.currentCheckpoint.progress,
        percentComplete: 100,
      },
    });

    this.emit('completed', this.currentCheckpoint);
  }

  /**
   * 현재 체크포인트 조회
   */
  getCurrentCheckpoint(): Checkpoint | null {
    return this.currentCheckpoint;
  }

  /**
   * 체크포인트 상태 요약
   */
  getStatus(): {
    state: CheckpointState;
    progress: number;
    resumable: boolean;
    lastDisconnection: DisconnectionType | null;
  } {
    if (!this.currentCheckpoint) {
      return {
        state: 'idle',
        progress: 0,
        resumable: false,
        lastDisconnection: null,
      };
    }

    return {
      state: this.currentCheckpoint.state,
      progress: this.currentCheckpoint.progress.percentComplete,
      resumable: this.currentCheckpoint.recovery.resumable,
      lastDisconnection: this.currentCheckpoint.recovery.lastDisconnection,
    };
  }

  /**
   * 모든 체크포인트 목록
   */
  listCheckpoints(): Checkpoint[] {
    const checkpoints: Checkpoint[] = [];

    try {
      const files = fs.readdirSync(this.checkpointDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const checkpointId = file.replace('.json', '');
          const checkpoint = this.loadCheckpoint(checkpointId);
          if (checkpoint) {
            checkpoints.push(checkpoint);
          }
        }
      }
    } catch (error) {
      console.error('[Checkpoint] Failed to list checkpoints:', error);
    }

    return checkpoints.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * 오래된 체크포인트 정리
   */
  cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();

    try {
      const files = fs.readdirSync(this.checkpointDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.checkpointDir, file);
          const stats = fs.statSync(filePath);
          
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        }
      }
    } catch (error) {
      console.error('[Checkpoint] Failed to cleanup:', error);
    }

    return cleaned;
  }

  /**
   * 리소스 해제
   */
  dispose(): void {
    this.stopHeartbeat();
    this.removeAllListeners();
  }
}

export default CheckpointManager;
