/**
 * OpenCode Factory Druid Plugin
 * 
 * OpenCode의 플러그인 시스템을 활용한 완전 자동화 메모리 관리 플러그인입니다.
 * 한 번 설치하면 모든 대화가 자동으로 캡처되고 압축됩니다.
 * 
 * 설치 위치: ~/.config/opencode/plugin/memory-factory.ts
 */

import type { Plugin } from "@opencode-ai/plugin"
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { MemoryManager } from '../../core/memory-manager.js'

// ============================================================================
// 설정
// ============================================================================

const DATA_DIR = path.join(os.homedir(), '.memory-factory')
const DB_PATH = path.join(DATA_DIR, 'conversations.db')

// ============================================================================
// 백그라운드 워커
// ============================================================================

class BackgroundWorker {
  private memoryManager: MemoryManager
  private processingQueue: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = []
  private isProcessing = false

  constructor() {
    this.memoryManager = new MemoryManager(DB_PATH)
    this.ensureDataDir()
    
    // 백그라운드 처리 루프 시작
    this.startProcessingLoop()
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
  }

  /**
   * 메시지 큐에 추가 (fire-and-forget)
   */
  enqueue(role: 'user' | 'assistant' | 'system', content: string): void {
    this.processingQueue.push({ role, content })
  }

  /**
   * 백그라운드 처리 루프
   */
  private startProcessingLoop(): void {
    setInterval(async () => {
      if (this.isProcessing || this.processingQueue.length === 0) {
        return
      }

      this.isProcessing = true

      try {
        while (this.processingQueue.length > 0) {
          const item = this.processingQueue.shift()!
          this.memoryManager.addItem(item.role, item.content)
        }
      } catch (e) {
        console.error('[MemoryFactory] 처리 오류:', e)
      } finally {
        this.isProcessing = false
      }
    }, 500) // 500ms 간격
  }

  /**
   * 압축된 컨텍스트 반환 (동기)
   */
  async getCompressedContext(): Promise<string> {
    // 큐 처리 완료 대기
    while (this.processingQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    const context = this.memoryManager.getContext()

    if (!context.summary && context.key_facts.length === 0) {
      return ''
    }

    const formattedContext = `## 압축된 대화 기록 (Memory Factory)

${context.summary}

### 핵심 정보
${context.key_facts.map(p => `- ${p}`).join('\n')}`

    return formattedContext
  }
}

// ============================================================================
// OpenCode 플러그인 정의
// ============================================================================

// 글로벌 워커 인스턴스
let worker: BackgroundWorker

export const MemoryFactoryPlugin: Plugin = async (ctx: any) => {
  // 플러그인 초기화
  worker = new BackgroundWorker()
  console.log('[MemoryFactory] 플러그인 초기화 완료')

  return {
    // ========================================================================
    // 이벤트 핸들러
    // ========================================================================
    event: async ({ event }: { event: any }) => {
      switch (event.type) {
        case 'message.updated':
          if ((event as any).message) {
            const msg = (event as any).message
            worker.enqueue(
              msg.role || 'user',
              msg.content || ''
            )
          }
          break
      }
    },

    // ========================================================================
    // 도구 실행 전 캡처
    // ========================================================================
    "tool.execute.before": async (input: any, output: any) => {
      // 우리 메모리 도구는 스킵
      if (input.tool?.startsWith('mcp__memory__')) {
        return
      }

      worker.enqueue(
        'system',
        `[Tool: ${input.tool}] Args: ${JSON.stringify(input.args || {})}`
      )
    },

    // ========================================================================
    // 도구 실행 후 캡처
    // ========================================================================
    "tool.execute.after": async (input: any, output: any) => {
      if (input.tool?.startsWith('mcp__memory__')) {
        return
      }

      worker.enqueue(
        'system',
        `[Tool Result: ${input.tool}] ${JSON.stringify(output.result || '').slice(0, 500)}`
      )
    },

    // ========================================================================
    // ⭐ 핵심: 압축 전 컨텍스트 주입
    // ========================================================================
    "experimental.session.compacting": async (input: any, output: any) => {
      console.log('[MemoryFactory] 압축 이벤트 감지 - 컨텍스트 주입')

      // 압축된 컨텍스트 가져오기 (동기 대기)
      const context = await worker.getCompressedContext()

      if (context) {
        // OpenCode의 압축 프롬프트에 우리 컨텍스트 추가
        output.context.push(context)
        console.log(`[MemoryFactory] 컨텍스트 주입 완료 (${context.length} chars)`)
      }
    }
  }
}

// 기본 내보내기
export default MemoryFactoryPlugin
