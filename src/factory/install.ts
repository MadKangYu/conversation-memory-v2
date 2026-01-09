#!/usr/bin/env node
/**
 * Memory Factory Install - 통합 설치 스크립트
 * 
 * 한 번의 명령어로 Claude Code 또는 OpenCode에 팩토리 드루이드를 설치합니다.
 * 
 * 사용법:
 *   npx memory-factory install          # 자동 감지
 *   npx memory-factory install --claude # Claude Code 전용
 *   npx memory-factory install --opencode # OpenCode 전용
 *   npx memory-factory uninstall        # 제거
 *   npx memory-factory status           # 상태 확인
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';

// ============================================================================
// 설정
// ============================================================================

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const OPENCODE_PLUGIN_DIR = path.join(os.homedir(), '.config', 'opencode', 'plugin');
const OPENCODE_PLUGIN_FILE = path.join(OPENCODE_PLUGIN_DIR, 'memory-factory.ts');
const DATA_DIR = path.join(os.homedir(), '.memory-factory');
const DAEMON_PID_FILE = path.join(os.tmpdir(), 'memory-factory-daemon.pid');

// ============================================================================
// 플랫폼 감지
// ============================================================================

interface PlatformInfo {
  claudeCode: boolean;
  openCode: boolean;
  claudeVersion?: string;
  openCodeVersion?: string;
}

function detectPlatforms(): PlatformInfo {
  const info: PlatformInfo = {
    claudeCode: false,
    openCode: false
  };

  // Claude Code 감지
  try {
    const claudeConfigDir = path.join(os.homedir(), '.claude');
    if (fs.existsSync(claudeConfigDir)) {
      info.claudeCode = true;
      // 버전 확인 시도
      try {
        const result = execSync('claude --version 2>/dev/null', { encoding: 'utf-8' });
        info.claudeVersion = result.trim();
      } catch (e) {
        // 버전 확인 실패해도 OK
      }
    }
  } catch (e) {
    // 무시
  }

  // OpenCode 감지
  try {
    const openCodeConfigDir = path.join(os.homedir(), '.config', 'opencode');
    if (fs.existsSync(openCodeConfigDir)) {
      info.openCode = true;
      // 버전 확인 시도
      try {
        const result = execSync('opencode --version 2>/dev/null', { encoding: 'utf-8' });
        info.openCodeVersion = result.trim();
      } catch (e) {
        // 버전 확인 실패해도 OK
      }
    }
  } catch (e) {
    // 무시
  }

  // 둘 다 없으면 명령어로 확인
  if (!info.claudeCode && !info.openCode) {
    try {
      execSync('which claude 2>/dev/null', { encoding: 'utf-8' });
      info.claudeCode = true;
    } catch (e) {}

    try {
      execSync('which opencode 2>/dev/null', { encoding: 'utf-8' });
      info.openCode = true;
    } catch (e) {}
  }

  return info;
}

// ============================================================================
// Claude Code 설치
// ============================================================================

async function installClaudeCode(): Promise<void> {
  console.log('\n📦 Claude Code에 Memory Factory 설치 중...\n');

  // 1. 디렉터리 생성
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    console.log(`  ✓ 디렉터리 생성: ${claudeDir}`);
  }

  // 2. 기존 설정 읽기
  let settings: any = {};
  if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
      console.log('  ✓ 기존 설정 로드');
    } catch (e) {
      console.log('  ⚠ 기존 설정 파싱 실패, 새로 생성');
    }
  }

  // 3. Hooks 설정 추가
  const binaryPath = 'npx memory-factory';  // 또는 글로벌 설치 경로
  
  settings.hooks = {
    ...settings.hooks,
    SessionStart: [
      {
        hooks: [{ type: 'command', command: `${binaryPath} hook session-start` }]
      }
    ],
    UserPromptSubmit: [
      {
        hooks: [{ type: 'command', command: `${binaryPath} hook capture-input` }]
      }
    ],
    PreToolUse: [
      {
        matcher: 'mcp__memory__.*',
        hooks: []  // 우리 도구는 스킵
      },
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: `${binaryPath} hook capture-tool-call` }]
      }
    ],
    PostToolUse: [
      {
        matcher: 'mcp__memory__.*',
        hooks: []
      },
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: `${binaryPath} hook capture-tool-result` }]
      }
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: `${binaryPath} hook capture-output` }]
      }
    ],
    SubagentStop: [
      {
        hooks: [{ type: 'command', command: `${binaryPath} hook capture-subagent-output` }]
      }
    ],
    PreCompact: [
      {
        hooks: [{ type: 'command', command: `${binaryPath} hook provide-context` }]
      }
    ],
    SessionEnd: [
      {
        hooks: [{ type: 'command', command: `${binaryPath} hook session-end` }]
      }
    ]
  };

  // 4. 설정 저장
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log(`  ✓ Hooks 설정 저장: ${CLAUDE_SETTINGS_PATH}`);

  // 4.5. 보안 래퍼 스크립트 생성 (The "Crush" Build)
  const wrapperPath = path.join(__dirname, 'claude-code', 'wrapper.sh');
  const wrapperContent = `#!/bin/bash
# Claude Code의 민감한 환경 변수 제거 (Security Wrapper)
unset ANTHROPIC_API_KEY
unset CLAUDE_API_KEY
unset OPENAI_API_KEY

# 실제 핸들러 실행
# 개발 환경(ts-node)과 배포 환경(node) 자동 감지
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
JS_HANDLER="$DIR/hook-handlers.js"
TS_HANDLER="$DIR/hook-handlers.ts"

if [ -f "$JS_HANDLER" ]; then
  exec node "$JS_HANDLER" "$@"
elif [ -f "$TS_HANDLER" ]; then
  # --yes: 패키지 설치 확인 질문 자동 수락 (비대화형 환경 필수)
  exec npx --yes ts-node "$TS_HANDLER" "$@"
else
  echo "Error: Hook handler not found"
  exit 1
fi
`;
  fs.writeFileSync(wrapperPath, wrapperContent);
  fs.chmodSync(wrapperPath, '755');
  console.log(`  ✓ 보안 래퍼 스크립트 생성: ${wrapperPath}`);

  // 5. 데이터 디렉터리 생성
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`  ✓ 데이터 디렉터리 생성: ${DATA_DIR}`);
  }

  // 6. 데몬 시작
  console.log('\n🚀 백그라운드 데몬 시작 중...');
  
  let isRunning = false;
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim());
      process.kill(pid, 0);
      console.log(`  ✓ 데몬이 이미 실행 중입니다 (PID: ${pid})`);
      isRunning = true;
    } catch (e) {
      // Stale PID file
    }
  }

  if (!isRunning) {
    try {
      // JS 파일(배포 환경) 우선 확인, 없으면 TS 파일(개발 환경) 확인
      let daemonPath = path.join(__dirname, 'claude-code', 'daemon.js');
      let command = 'node';
      let args = [daemonPath];

      if (!fs.existsSync(daemonPath)) {
        const tsDaemonPath = path.join(__dirname, 'claude-code', 'daemon.ts');
        if (fs.existsSync(tsDaemonPath)) {
          // 개발 환경: ts-node로 실행
          daemonPath = tsDaemonPath;
          command = 'npx';
          args = ['ts-node', daemonPath];
        } else {
          throw new Error('데몬 파일을 찾을 수 없습니다.');
        }
      }

      const daemon = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
      });
      daemon.unref();
      console.log(`  ✓ 데몬 시작 (PID: ${daemon.pid})`);
    } catch (e) {
      console.log('  ⚠ 데몬 시작 실패 (수동으로 시작 필요)');
    }
  }

  console.log('\n✅ Claude Code 설치 완료!\n');
  console.log('이제 Claude Code를 사용하면 모든 대화가 자동으로 캡처됩니다.');
}

// ============================================================================
// OpenCode 설치
// ============================================================================

async function installOpenCode(): Promise<void> {
  console.log('\n📦 OpenCode에 Memory Factory 설치 중...\n');

  // 1. 플러그인 디렉터리 생성
  if (!fs.existsSync(OPENCODE_PLUGIN_DIR)) {
    fs.mkdirSync(OPENCODE_PLUGIN_DIR, { recursive: true });
    console.log(`  ✓ 플러그인 디렉터리 생성: ${OPENCODE_PLUGIN_DIR}`);
  }

  // 2. 플러그인 파일 복사
  const pluginSource = path.join(__dirname, 'opencode', 'memory-factory-plugin.ts');
  
  // 플러그인 내용 (인라인으로 포함)
  const pluginContent = `/**
 * OpenCode Memory Factory Plugin
 * 자동 생성됨 - 수정하지 마세요
 */

import type { Plugin } from "@opencode-ai/plugin"
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const DATA_DIR = path.join(os.homedir(), '.memory-factory')
const CHUNK_SIZE = 500
const OVERLAP_RATIO = 0.1
const SIMILARITY_THRESHOLD = 0.7

// 경량 압축기
class EmbeddedCompressor {
  private chunkSize = CHUNK_SIZE
  private overlapRatio = OVERLAP_RATIO
  private similarityThreshold = SIMILARITY_THRESHOLD

  private hash(str: string): number {
    let hash = 2166136261
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = (hash * 16777619) >>> 0
    }
    return hash
  }

  compress(text: string): string {
    if (text.length < this.chunkSize) return text

    const step = Math.floor(this.chunkSize * (1 - this.overlapRatio))
    const chunks: Array<{ text: string; hash: number; tokens: Set<string> }> = []
    
    for (let i = 0; i < text.length; i += step) {
      const chunkText = text.slice(i, i + this.chunkSize)
      if (chunkText.trim().length === 0) continue
      
      const tokens = new Set(chunkText.toLowerCase().split(/\\s+/).filter(t => t.length > 2))
      chunks.push({ text: chunkText, hash: this.hash(chunkText), tokens })
    }

    const uniqueChunks: typeof chunks = []
    const seenHashes = new Set<number>()

    for (const chunk of chunks) {
      if (seenHashes.has(chunk.hash)) continue

      let isDuplicate = false
      for (const existing of uniqueChunks) {
        let intersection = 0
        for (const token of chunk.tokens) {
          if (existing.tokens.has(token)) intersection++
        }
        const union = chunk.tokens.size + existing.tokens.size - intersection
        if (union > 0 && intersection / union >= this.similarityThreshold) {
          isDuplicate = true
          break
        }
      }

      if (!isDuplicate) {
        uniqueChunks.push(chunk)
        seenHashes.add(chunk.hash)
      }
    }

    return uniqueChunks.map(c => c.text).join('\\n\\n---\\n\\n')
  }
}

// 백그라운드 워커
class BackgroundWorker {
  private sessions = new Map<string, { messages: Array<{ role: string; content: string; timestamp: number }>; compressedContext: string | null; keyPoints: string[] }>()
  private compressor = new EmbeddedCompressor()
  private queue: Array<{ sessionId: string; message: any }> = []
  private isProcessing = false

  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    setInterval(() => this.processQueue(), 500)
  }

  initSession(sessionId: string) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { messages: [], compressedContext: null, keyPoints: [] })
    }
  }

  enqueue(sessionId: string, message: any) {
    this.initSession(sessionId)
    this.queue.push({ sessionId, message })
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return
    this.isProcessing = true
    try {
      while (this.queue.length > 0) {
        const { sessionId, message } = this.queue.shift()!
        const session = this.sessions.get(sessionId)
        if (session) {
          session.messages.push(message)
          if (message.role === 'assistant') {
            const text = session.messages.map(m => \`[\${m.role}] \${m.content}\`).join('\\n\\n')
            session.compressedContext = this.compressor.compress(text)
            session.keyPoints = session.messages
              .filter(m => m.role === 'user' && m.content.length > 10)
              .map(m => m.content.split(/[.!?]/)[0])
              .filter(s => s && s.length < 200)
              .slice(0, 5)
          }
        }
      }
    } finally {
      this.isProcessing = false
    }
  }

  async getCompressedContext(sessionId: string): Promise<string> {
    while (this.queue.some(item => item.sessionId === sessionId)) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const session = this.sessions.get(sessionId)
    if (!session?.compressedContext) return ''
    return \`## 압축된 대화 기록\\n\\n\${session.compressedContext}\\n\\n### 핵심 요청\\n\${session.keyPoints.map(p => \`- \${p}\`).join('\\n')}\`
  }

  async endSession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session) {
      fs.writeFileSync(path.join(DATA_DIR, \`session_\${sessionId}.json\`), JSON.stringify(session, null, 2))
      this.sessions.delete(sessionId)
    }
  }
}

let worker: BackgroundWorker

export const MemoryFactoryPlugin: Plugin = async (ctx) => {
  worker = new BackgroundWorker()
  let currentSessionId: string | null = null

  return {
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        currentSessionId = (event as any).sessionId || \`session_\${Date.now()}\`
        worker.initSession(currentSessionId)
      } else if (event.type === 'session.deleted' && currentSessionId) {
        await worker.endSession(currentSessionId)
        currentSessionId = null
      } else if (event.type === 'message.updated' && currentSessionId && (event as any).message) {
        const msg = (event as any).message
        worker.enqueue(currentSessionId, { role: msg.role || 'user', content: msg.content || '', timestamp: Date.now() })
      }
    },

    "tool.execute.before": async (input, output) => {
      if (!currentSessionId || input.tool?.startsWith('mcp__memory__')) return
      worker.enqueue(currentSessionId, { role: 'tool', content: \`[Tool: \${input.tool}] \${JSON.stringify(input.args || {})}\`, timestamp: Date.now() })
    },

    "tool.execute.after": async (input, output) => {
      if (!currentSessionId || input.tool?.startsWith('mcp__memory__')) return
      worker.enqueue(currentSessionId, { role: 'tool', content: \`[Result: \${input.tool}] \${JSON.stringify(output.result || '').slice(0, 500)}\`, timestamp: Date.now() })
    },

    "experimental.session.compacting": async (input, output) => {
      if (!currentSessionId) return
      const context = await worker.getCompressedContext(currentSessionId)
      if (context) output.context.push(context)
    }
  }
}

export default MemoryFactoryPlugin
`;

  fs.writeFileSync(OPENCODE_PLUGIN_FILE, pluginContent);
  console.log(`  ✓ 플러그인 파일 생성: ${OPENCODE_PLUGIN_FILE}`);

  // 3. 데이터 디렉터리 생성
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`  ✓ 데이터 디렉터리 생성: ${DATA_DIR}`);
  }

  console.log('\n✅ OpenCode 설치 완료!\n');
  console.log('OpenCode를 재시작하면 플러그인이 자동으로 로드됩니다.');
}

// ============================================================================
// 제거
// ============================================================================

async function uninstall(): Promise<void> {
  console.log('\n🗑️  Memory Factory 제거 중...\n');

  // Claude Code 제거
  if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
      
      // hooks에서 memory-factory 관련 항목 제거
      if (settings.hooks) {
        for (const event of Object.keys(settings.hooks)) {
          settings.hooks[event] = settings.hooks[event].filter(
            (matcher: any) => !matcher.hooks?.some((h: any) => h.command?.includes('memory-factory'))
          );
          if (settings.hooks[event].length === 0) {
            delete settings.hooks[event];
          }
        }
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }
      
      fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
      console.log('  ✓ Claude Code hooks 제거');
    } catch (e) {
      console.log('  ⚠ Claude Code 설정 처리 실패');
    }
  }

  // OpenCode 플러그인 제거
  if (fs.existsSync(OPENCODE_PLUGIN_FILE)) {
    fs.unlinkSync(OPENCODE_PLUGIN_FILE);
    console.log('  ✓ OpenCode 플러그인 제거');
  }

  // 데몬 종료
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim());
      process.kill(pid, 'SIGTERM');
      console.log('  ✓ 데몬 종료');
    } catch (e) {
      // 무시
    }
    fs.unlinkSync(DAEMON_PID_FILE);
  }

  console.log('\n✅ 제거 완료!\n');
  console.log('데이터 디렉터리는 유지됩니다: ' + DATA_DIR);
}

// ============================================================================
// 상태 확인
// ============================================================================

async function status(): Promise<void> {
  // The "Oh My" Dashboard
  console.log('\n' + '─'.repeat(50));
  console.log(' 🏭 \x1b[1mFACTORY DRUID\x1b[0m \x1b[36mv2.0.0\x1b[0m');
  console.log('─'.repeat(50));

  const platforms = detectPlatforms();
  
  // 1. Platform Status
  console.log('\n\x1b[1m[Platform Status]\x1b[0m');
  
  // Claude Code
  const claudeStatus = platforms.claudeCode ? '\x1b[32mActive\x1b[0m' : '\x1b[90mInactive\x1b[0m';
  console.log(` • Claude Code  : ${claudeStatus} ${platforms.claudeVersion ? `(${platforms.claudeVersion})` : ''}`);
  
  if (platforms.claudeCode) {
    let hookStatus = '\x1b[31mNot Installed\x1b[0m';
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      try {
        const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
        const hasHooks = settings.hooks && 
          Object.values(settings.hooks).some((matchers: any) =>
            matchers.some((m: any) => m.hooks?.some((h: any) => h.command?.includes('memory-factory')))
          );
        if (hasHooks) hookStatus = '\x1b[32mInstalled\x1b[0m';
      } catch {}
    }
    console.log(`   └─ Hooks     : ${hookStatus}`);

    let daemonStatus = '\x1b[31mStopped\x1b[0m';
    if (fs.existsSync(DAEMON_PID_FILE)) {
      try {
        const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim());
        process.kill(pid, 0);
        daemonStatus = `\x1b[32mRunning\x1b[0m (PID: ${pid})`;
      } catch {}
    }
    console.log(`   └─ Daemon    : ${daemonStatus}`);
  }

  // OpenCode
  const openCodeStatus = platforms.openCode ? '\x1b[32mActive\x1b[0m' : '\x1b[90mInactive\x1b[0m';
  console.log(` • OpenCode     : ${openCodeStatus} ${platforms.openCodeVersion ? `(${platforms.openCodeVersion})` : ''}`);
  
  if (platforms.openCode) {
    const pluginExists = fs.existsSync(OPENCODE_PLUGIN_FILE);
    const pluginStatus = pluginExists ? '\x1b[32mInstalled\x1b[0m' : '\x1b[31mNot Installed\x1b[0m';
    console.log(`   └─ Plugin    : ${pluginStatus}`);
  }

  // 2. Memory Stats (DB Check)
  console.log('\n\x1b[1m[Memory Stats]\x1b[0m');
  const dbPath = path.join(DATA_DIR, 'conversations.db');
  if (fs.existsSync(dbPath)) {
    try {
      // DB 사이즈 확인
      const stats = fs.statSync(dbPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(` • Storage      : ${sizeMB} MB (SQLite WAL)`);
      console.log(` • Location     : ${dbPath}`);
    } catch {
      console.log(' • Storage      : Error reading DB');
    }
  } else {
    console.log(' • Storage      : Empty (No memories yet)');
  }
  
  console.log('\n' + '─'.repeat(50));
  console.log(`  ${fs.existsSync(OPENCODE_PLUGIN_FILE) ? '✓' : '✗'} 플러그인 ${fs.existsSync(OPENCODE_PLUGIN_FILE) ? '설치됨' : '미설치'}`);

  // 데이터 디렉터리
  console.log('\n데이터:');
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR);
    const sessionFiles = files.filter(f => f.startsWith('session_'));
    console.log(`  ✓ 데이터 디렉터리: ${DATA_DIR}`);
    console.log(`  ✓ 저장된 세션: ${sessionFiles.length}개`);
  } else {
    console.log('  ✗ 데이터 디렉터리 없음');
  }

  console.log('');
}

// ============================================================================
// 메인
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'install':
      const platforms = detectPlatforms();
      
      if (args.includes('--claude')) {
        await installClaudeCode();
      } else if (args.includes('--opencode')) {
        await installOpenCode();
      } else {
        // 자동 감지
        console.log('\n🔍 플랫폼 감지 중...');
        
        if (platforms.claudeCode && platforms.openCode) {
          console.log('  Claude Code와 OpenCode 모두 감지됨');
          console.log('  두 플랫폼 모두에 설치합니다.\n');
          await installClaudeCode();
          await installOpenCode();
        } else if (platforms.claudeCode) {
          console.log('  Claude Code 감지됨');
          await installClaudeCode();
        } else if (platforms.openCode) {
          console.log('  OpenCode 감지됨');
          await installOpenCode();
        } else {
          console.log('\n⚠️  Claude Code 또는 OpenCode를 찾을 수 없습니다.');
          console.log('  --claude 또는 --opencode 옵션을 사용하여 수동으로 설치하세요.\n');
          process.exit(1);
        }
      }
      break;

    case 'uninstall':
      await uninstall();
      break;

    case 'status':
      await status();
      break;

    case 'hook':
      // Hook 핸들러 호출 (Claude Code용)
      const hookCommand = args[1];
      const hookHandlers = await import('./claude-code/hook-handlers');
      // hook-handlers.ts에서 처리
      break;

    default:
      console.log(`
Memory Factory - 팩토리 드루이드 패턴

사용법:
  npx memory-factory install          # 자동 감지 후 설치
  npx memory-factory install --claude # Claude Code에 설치
  npx memory-factory install --opencode # OpenCode에 설치
  npx memory-factory uninstall        # 제거
  npx memory-factory status           # 상태 확인
`);
  }
}

main().catch(console.error);
