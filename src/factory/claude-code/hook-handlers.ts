/**
 * Claude Code Factory Druid - Hook Command Handlers
 * 
 * Claude Code Hook에서 호출되는 CLI 명령어 핸들러입니다.
 * 각 핸들러는 stdin으로 JSON을 받고, stdout으로 결과를 반환합니다.
 * 
 * 핵심 원칙:
 * 1. 빠르게 반환 (Claude Code 블로킹 최소화)
 * 2. 무거운 작업은 큐에 넣고 데몬이 처리
 * 3. PreCompact만 동기적으로 압축 결과 반환
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 큐 디렉터리
const QUEUE_DIR = path.join(os.tmpdir(), 'memory-factory-queue');
const DAEMON_PID_FILE = path.join(os.tmpdir(), 'memory-factory-daemon.pid');

// 큐 디렉터리 초기화
function ensureQueueDir(): void {
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  }
}

// stdin에서 JSON 읽기
async function readStdin(): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({ raw: data });
      }
    });
    
    process.stdin.on('error', reject);
    
    // 타임아웃 (100ms)
    setTimeout(() => {
      if (data === '') {
        resolve({});
      }
    }, 100);
  });
}

// 큐에 메시지 추가 (빠르게)
function enqueue(type: string, data: any): void {
  ensureQueueDir();
  
  const timestamp = Date.now();
  const filename = `${timestamp}-${type}.json`;
  const filepath = path.join(QUEUE_DIR, filename);
  
  // 현재 작업 디렉토리(CWD)를 모든 메시지에 포함
  // wrapper.sh가 부모 프로세스의 CWD를 상속받으므로 process.cwd()는 사용자의 실행 위치임
  const enrichedData = {
    ...data,
    cwd: process.cwd()
  };

  fs.writeFileSync(filepath, JSON.stringify({
    type,
    timestamp,
    data: enrichedData
  }));
  
  // 데몬에 신호 전송 (있으면)
  try {
    if (fs.existsSync(DAEMON_PID_FILE)) {
      const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim());
      process.kill(pid, 'SIGUSR1');
    }
  } catch (e) {
    // 데몬이 없어도 무시 (큐에 저장됨)
  }
}

// stdout으로 JSON 응답
function respond(data: any): void {
  console.log(JSON.stringify(data));
}

/**
 * 세션 시작 핸들러
 * Hook: SessionStart
 */
export async function handleSessionStart(): Promise<void> {
  const input = await readStdin();
  
  enqueue('session_start', {
    sessionId: input.session_id || `session_${Date.now()}`,
    timestamp: Date.now()
  });
  
  // 즉시 반환 (성공)
  process.exit(0);
}

/**
 * 사용자 입력 캡처 핸들러
 * Hook: UserPromptSubmit
 */
export async function handleCaptureInput(): Promise<void> {
  const input = await readStdin();
  
  enqueue('user_input', {
    content: input.prompt || input.message || '',
    timestamp: Date.now()
  });
  
  // 즉시 반환
  process.exit(0);
}

/**
 * 도구 호출 캡처 핸들러
 * Hook: PreToolUse
 */
export async function handleCaptureToolCall(): Promise<void> {
  const input = await readStdin();
  
  enqueue('tool_call', {
    tool: input.tool_name || input.tool || '',
    args: input.tool_input || input.args || {},
    timestamp: Date.now()
  });
  
  // 즉시 반환
  process.exit(0);
}

/**
 * 도구 결과 캡처 핸들러
 * Hook: PostToolUse
 */
export async function handleCaptureToolResult(): Promise<void> {
  const input = await readStdin();
  
  enqueue('tool_result', {
    tool: input.tool_name || input.tool || '',
    result: input.tool_result || input.result || '',
    timestamp: Date.now()
  });
  
  // 즉시 반환
  process.exit(0);
}

/**
 * Claude 응답 캡처 핸들러
 * Hook: Stop
 */
export async function handleCaptureOutput(): Promise<void> {
  const input = await readStdin();
  
  enqueue('assistant_output', {
    content: input.stop_message || input.message || '',
    timestamp: Date.now()
  });
  
  // 즉시 반환
  process.exit(0);
}

/**
 * 서브에이전트 응답 캡처 핸들러
 * Hook: SubagentStop
 */
export async function handleCaptureSubagentOutput(): Promise<void> {
  const input = await readStdin();
  
  enqueue('subagent_output', {
    content: input.stop_message || input.message || '',
    subagent: input.subagent_name || 'unknown',
    timestamp: Date.now()
  });
  
  // 즉시 반환
  process.exit(0);
}

/**
 * ⭐ 핵심: 압축 컨텍스트 제공 핸들러
 * Hook: PreCompact
 * 
 * 이 핸들러만 동기적으로 압축 결과를 반환합니다.
 */
export async function handleProvideContext(): Promise<void> {
  const input = await readStdin();
  
  try {
    // 압축된 컨텍스트 로드 (데몬이 미리 준비해둔 것)
    const contextFile = path.join(QUEUE_DIR, 'compressed_context.json');
    
    if (fs.existsSync(contextFile)) {
      const context = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
      
      // 현재 프로젝트(CWD)와 일치하는지 확인
      // 만약 데몬이 처리한 마지막 컨텍스트가 다른 프로젝트의 것이라면, 
      // 현재 프로젝트에 맞는 컨텍스트가 아닐 수 있음.
      // 하지만 데몬은 큐를 순차 처리하므로, 가장 최근의 session_start나 user_input에 의해
      // 업데이트된 컨텍스트가 현재 프로젝트의 것일 확률이 높음.
      // 더 정확하게 하려면 데몬이 프로젝트별로 파일을 따로 저장해야 함 (compressed_context_{hash(cwd)}.json)
      // 일단은 단순하게 구현하고, 추후 고도화
      
      // Claude Code에 컨텍스트 주입
      respond({
        decision: 'continue',
        context: [
          {
            type: 'text',
            text: `## 압축된 대화 기록 (Memory Factory)\n\n${context.summary}\n\n### 핵심 정보\n${context.keyPoints?.join('\n') || ''}`
          }
        ]
      });
    } else {
      // 압축된 컨텍스트가 없으면 그냥 진행
      respond({
        decision: 'continue'
      });
    }
  } catch (e) {
    // 에러 시에도 진행 (압축 실패가 전체를 막으면 안됨)
    respond({
      decision: 'continue'
    });
  }
  
  process.exit(0);
}

/**
 * 세션 종료 핸들러
 * Hook: SessionEnd
 */
export async function handleSessionEnd(): Promise<void> {
  const input = await readStdin();
  
  enqueue('session_end', {
    sessionId: input.session_id || '',
    timestamp: Date.now()
  });
  
  // 즉시 반환
  process.exit(0);
}

// CLI 진입점
const command = process.argv[2];

const handlers: Record<string, () => Promise<void>> = {
  'session-start': handleSessionStart,
  'capture-input': handleCaptureInput,
  'capture-tool-call': handleCaptureToolCall,
  'capture-tool-result': handleCaptureToolResult,
  'capture-output': handleCaptureOutput,
  'capture-subagent-output': handleCaptureSubagentOutput,
  'provide-context': handleProvideContext,
  'session-end': handleSessionEnd
};

if (command && handlers[command]) {
  handlers[command]().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  console.error(`Available commands: ${Object.keys(handlers).join(', ')}`);
  process.exit(1);
}
