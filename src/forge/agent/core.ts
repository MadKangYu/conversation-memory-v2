import { LLMProvider, LLMMessage } from '../../providers/llm-provider.js';
import { ToolRegistry, ToolResult } from '../tools/base.js';
import { generateSystemPrompt } from './prompts.js';
import { MemoryManager } from '../../core/memory-manager.js';

interface AgentConfig {
  llm: LLMProvider;
  tools: ToolRegistry;
  memory?: MemoryManager; // 선택적 주입 (RAG용)
  maxSteps?: number;
}

interface AgentStep {
  thought: string;
  action?: {
    name: string;
    args: any;
  };
  final_response?: string;
}

export class ForgeAgent {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private maxSteps: number;
  private history: LLMMessage[] = [];

  private memory?: MemoryManager;

  constructor(config: AgentConfig) {
    this.llm = config.llm;
    this.tools = config.tools;
    this.memory = config.memory;
    this.maxSteps = config.maxSteps || 10;
  }

  /**
   * 에이전트 실행 루프
   */
  async run(userMessage: string): Promise<string> {
    // 1. Dynamic RAG: 관련 기억 검색
    let context = '';
    if (this.memory) {
      try {
        const memories = await this.memory.search(userMessage, { limit: 5 });
        if (memories.length > 0) {
          context = `\n\n## Relevant Past Memories (Context)\n${memories.map(m => `- ${m.content}`).join('\n')}\n\nUse this context to better understand the user's request.`;
          console.log(`[Agent] Retrieved ${memories.length} relevant memories.`);
        }
      } catch (e) {
        // 메모리 검색 실패는 치명적이지 않음
      }
    }

    // 시스템 프롬프트 초기화 (컨텍스트 주입)
    const systemPrompt = generateSystemPrompt(this.tools.list()) + context;
    
    this.history = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    let stepCount = 0;

    while (stepCount < this.maxSteps) {
      stepCount++;
      console.log(`[Agent] Step ${stepCount} thinking...`);

      // 1. LLM에게 생각 및 행동 요청
      const response = await this.llm.complete(this.history);
      const content = response.content;

      // JSON 파싱 시도
      let step: AgentStep;
      try {
        // 마크다운 코드 블록 제거 (혹시 모를 경우 대비)
        const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
        step = JSON.parse(cleanContent);
      } catch (e) {
        console.error('[Agent] Failed to parse JSON:', content);
        // 파싱 실패 시 에이전트에게 피드백
        this.history.push({ 
          role: 'assistant', 
          content 
        });
        this.history.push({
          role: 'user',
          content: 'Error: 응답이 유효한 JSON 형식이 아닙니다. 지정된 JSON 형식으로 다시 응답해주세요.'
        });
        continue;
      }

      console.log(`[Agent] Thought: ${step.thought}`);

      // 2. 최종 응답인 경우 종료
      if (step.final_response) {
        return step.final_response;
      }

      // 3. 도구 실행
      if (step.action) {
        console.log(`[Agent] Executing tool: ${step.action.name}`);
        const toolResult = await this.tools.execute(step.action.name, step.action.args);
        
        // 4. 결과 관찰 및 히스토리 업데이트
        this.history.push({
          role: 'assistant',
          content: JSON.stringify(step)
        });

        this.history.push({
          role: 'user',
          content: `Tool Output (${step.action.name}):\n${JSON.stringify(toolResult)}`
        });
      } else {
        // 행동이 없는 경우 (이상 상황)
        this.history.push({
          role: 'user',
          content: 'Error: action 또는 final_response 중 하나는 반드시 포함되어야 합니다.'
        });
      }
    }

    return '최대 실행 단계(Max Steps)를 초과하여 작업을 중단했습니다.';
  }
}
