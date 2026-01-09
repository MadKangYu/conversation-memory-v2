/**
 * Claude Code Factory Druid - Background Daemon
 * 
 * 백그라운드에서 실행되며 큐의 메시지를 처리하고 압축을 수행합니다.
 * Hook 핸들러는 빠르게 큐에 넣고 반환하고, 데몬이 무거운 작업을 처리합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemoryManager } from '../../core/memory-manager';

// 설정
const QUEUE_DIR = path.join(os.tmpdir(), 'memory-factory-queue');
const DAEMON_PID_FILE = path.join(os.tmpdir(), 'memory-factory-daemon.pid');
const DATA_DIR = path.join(os.homedir(), '.memory-factory');
const DB_PATH = path.join(DATA_DIR, 'conversations.db');

// 메모리 매니저 인스턴스
let memoryManager: MemoryManager;

// 현재 세션 데이터
interface SessionData {
  sessionId: string;
  cwd: string; // 프로젝트 경로 추가
  messages: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
  }>;
  startTime: number;
}

let currentSession: SessionData | null = null;

/**
 * 데몬 초기화
 */
async function initialize(): Promise<void> {
  // 디렉터리 생성
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Singleton 체크: 이미 실행 중인지 확인
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim());
      process.kill(pid, 0); // 프로세스 존재 확인
      console.error(`[Daemon] 이미 실행 중입니다 (PID: ${pid}). 종료합니다.`);
      process.exit(1);
    } catch (e) {
      // 프로세스가 없으면(Stale PID file) 무시하고 계속 진행
      console.log('[Daemon] 이전 PID 파일이 존재하지만 프로세스가 없습니다. 덮어씁니다.');
    }
  }

  // PID 파일 생성
  fs.writeFileSync(DAEMON_PID_FILE, process.pid.toString());

  // 메모리 매니저 초기화 (DB 연동)
  memoryManager = new MemoryManager(DB_PATH);

  console.log(`[Daemon] 초기화 완료 (PID: ${process.pid})`);
  console.log(`[Daemon] 큐 디렉터리: ${QUEUE_DIR}`);
  console.log(`[Daemon] 데이터 디렉터리: ${DATA_DIR}`);
}

/**
 * 큐에서 메시지 처리
 */
async function processQueue(): Promise<void> {
  const files = fs.readdirSync(QUEUE_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('compressed'))
    .sort();  // 타임스탬프 순서로 정렬

  for (const file of files) {
    const filepath = path.join(QUEUE_DIR, file);
    
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const message = JSON.parse(content);
      
      await handleMessage(message);
      
      // 처리 완료 후 파일 삭제
      fs.unlinkSync(filepath);
    } catch (e) {
      console.error(`[Daemon] 메시지 처리 실패: ${file}`, e);
      // 실패한 파일은 .error 확장자로 이동
      fs.renameSync(filepath, filepath + '.error');
    }
  }
}

/**
 * 메시지 타입별 처리
 */
async function handleMessage(message: any): Promise<void> {
  const { type, data, timestamp } = message;
  
  // 메시지에 포함된 cwd 정보 사용 (없으면 현재 데몬 실행 경로 - 주의: 데몬은 보통 홈에서 실행됨)
  // 따라서 Hook에서 반드시 cwd를 보내줘야 함. 없을 경우를 대비해 data.cwd 체크
  const sessionCwd = data.cwd || (currentSession ? currentSession.cwd : process.cwd());

  switch (type) {
    case 'session_start':
      currentSession = {
        sessionId: data.sessionId,
        cwd: sessionCwd,
        messages: [],
        startTime: timestamp
      };
      console.log(`[Daemon] 세션 시작: ${data.sessionId} (Path: ${sessionCwd})`);
      break;

    case 'user_input':
      if (currentSession) {
        currentSession.messages.push({
          role: 'user',
          content: data.content,
          timestamp
        });
        // DB에 추가 (프로젝트 경로 전달)
        await memoryManager.addItem('user', data.content, currentSession.cwd);
        console.log(`[Daemon] 사용자 입력 캡처 (${data.content.length} chars)`);
      }
      break;

    case 'tool_call':
      if (currentSession) {
        const content = `[Tool Call: ${data.tool}] ${JSON.stringify(data.args)}`;
        currentSession.messages.push({
          role: 'tool',
          content,
          timestamp
        });
        // DB에 추가
        await memoryManager.addItem('system', content, currentSession.cwd);
      }
      break;

    case 'tool_result':
      if (currentSession) {
        const content = `[Tool Result: ${data.tool}] ${data.result}`;
        currentSession.messages.push({
          role: 'tool',
          content,
          timestamp
        });
        // DB에 추가
        await memoryManager.addItem('system', content, currentSession.cwd);
      }
      break;

    case 'assistant_output':
      if (currentSession) {
        currentSession.messages.push({
          role: 'assistant',
          content: data.content,
          timestamp
        });
        // DB에 추가
        await memoryManager.addItem('assistant', data.content, currentSession.cwd);
        console.log(`[Daemon] 어시스턴트 출력 캡처 (${data.content.length} chars)`);
        
        // 응답 완료 시 압축 수행
        await performCompression();
      }
      break;

    case 'subagent_output':
      if (currentSession) {
        const content = `[Subagent: ${data.subagent}] ${data.content}`;
        currentSession.messages.push({
          role: 'assistant',
          content,
          timestamp
        });
        // DB에 추가
        await memoryManager.addItem('assistant', content, currentSession.cwd);
      }
      break;

    case 'session_end':
      if (currentSession) {
        // 최종 압축 및 저장
        await performCompression();
        await saveSession();
        console.log(`[Daemon] 세션 종료: ${currentSession.sessionId}`);
        currentSession = null;
      }
      break;

    default:
      console.log(`[Daemon] 알 수 없는 메시지 타입: ${type}`);
  }
}

/**
 * 압축 수행 및 컨텍스트 파일 생성
 */
async function performCompression(): Promise<void> {
  if (!currentSession || currentSession.messages.length === 0) {
    return;
  }

  console.log(`[Daemon] 컨텍스트 업데이트 확인...`);

  // MemoryManager에서 최신 컨텍스트 가져오기 (현재 세션의 cwd 기준)
  // 비동기 메서드 사용
  const context = await memoryManager.getContextAsync(currentSession.cwd);

  // 압축된 컨텍스트를 파일로 저장 (PreCompact Hook이 읽음)
  const contextFile = path.join(QUEUE_DIR, 'compressed_context.json');
  fs.writeFileSync(contextFile, JSON.stringify({
    sessionId: currentSession.sessionId,
    summary: context.summary,
    keyPoints: context.key_facts,
    messageCount: currentSession.messages.length,
    projectContext: context.project_context, // 프로젝트 정보 포함
    lastUpdated: Date.now()
  }));

  console.log(`[Daemon] 컨텍스트 파일 업데이트: ${contextFile}`);
}

/**
 * 세션 데이터 영구 저장
 */
async function saveSession(): Promise<void> {
  if (!currentSession) return;

  const sessionFile = path.join(DATA_DIR, `session_${currentSession.sessionId}.json`);
  fs.writeFileSync(sessionFile, JSON.stringify(currentSession, null, 2));
  console.log(`[Daemon] 세션 저장: ${sessionFile}`);
}

/**
 * 시그널 핸들러
 */
function setupSignalHandlers(): void {
  // SIGUSR1: 큐 처리 트리거
  process.on('SIGUSR1', () => {
    console.log('[Daemon] SIGUSR1 수신 - 큐 처리');
    processQueue().catch(console.error);
  });

  // SIGTERM/SIGINT: 정상 종료
  process.on('SIGTERM', () => {
    console.log('[Daemon] SIGTERM 수신 - 종료');
    cleanup();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[Daemon] SIGINT 수신 - 종료');
    cleanup();
    process.exit(0);
  });
}

/**
 * 정리 작업
 */
function cleanup(): void {
  // PID 파일 삭제
  if (fs.existsSync(DAEMON_PID_FILE)) {
    fs.unlinkSync(DAEMON_PID_FILE);
  }

  // 현재 세션 저장
  if (currentSession) {
    saveSession().catch(console.error);
  }
}

/**
 * 메인 루프
 */
async function main(): Promise<void> {
  await initialize();
  setupSignalHandlers();

  console.log('[Daemon] 메인 루프 시작');

  // 주기적으로 큐 확인 (1초마다)
  setInterval(() => {
    processQueue().catch(console.error);
  }, 1000);

  // 초기 큐 처리
  await processQueue();

  // 프로세스 유지
  console.log('[Daemon] 대기 중...');
}

// 데몬 시작
main().catch((e) => {
  console.error('[Daemon] 치명적 오류:', e);
  cleanup();
  process.exit(1);
});
