/**
 * MCP Server - Model Context Protocol 서버
 * OpenCode/ClaudeCode 호환 MCP 도구 제공
 * 다중 LLM 지원 + 이미지 처리 기능
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ConversationMemory } from '../memory.js';
import { ConvMemoryConfig, DEFAULT_CONFIG } from '../types.js';
import { ImageProcessor } from '../providers/image-processor.js';
import { LLMProvider, RECOMMENDED_MODELS } from '../providers/llm-provider.js';
import { OrchestratorTools, createOrchestratorToolDefinitions } from './orchestrator-tools.js';

export class MCPServer {
  private server: Server;
  private memory: ConversationMemory;
  private imageProcessor: ImageProcessor;
  private llmProvider: LLMProvider;
  private orchestratorTools: OrchestratorTools;

  constructor(config: Partial<ConvMemoryConfig> = {}) {
    this.memory = new ConversationMemory(config);
    this.llmProvider = new LLMProvider({
      provider: 'openrouter',
      model: config.compressionModel || 'google/gemini-2.0-flash-exp:free',
    });
    this.imageProcessor = new ImageProcessor(this.llmProvider);
    this.orchestratorTools = new OrchestratorTools(this.memory);

    this.server = new Server(
      {
        name: 'conversation-memory-v2',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * 핸들러 설정
   */
  private setupHandlers(): void {
    // 도구 목록
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // 오케스트라 협력 도구 (우선순위 높음)
        ...createOrchestratorToolDefinitions(),
        // 기존 메모리 도구들
        {
          name: 'memory_add_message',
          description: '대화에 새 메시지를 추가합니다. 자동으로 청킹 및 압축이 트리거됩니다.',
          inputSchema: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                enum: ['user', 'assistant', 'system'],
                description: '메시지 역할',
              },
              content: {
                type: 'string',
                description: '메시지 내용',
              },
              conversationId: {
                type: 'string',
                description: '대화 ID (선택, 없으면 현재 대화 사용)',
              },
            },
            required: ['role', 'content'],
          },
        },
        {
          name: 'memory_get_context',
          description: '현재 대화의 압축된 컨텍스트를 조회합니다. 시스템 프롬프트로 사용 가능합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              conversationId: {
                type: 'string',
                description: '대화 ID (선택)',
              },
            },
          },
        },
        {
          name: 'memory_search',
          description: '대화 기록에서 키워드로 검색합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '검색 쿼리',
              },
              conversationId: {
                type: 'string',
                description: '특정 대화에서만 검색 (선택)',
              },
              limit: {
                type: 'number',
                description: '최대 결과 수 (기본: 10)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'memory_list_conversations',
          description: '저장된 대화 목록을 조회합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: '최대 결과 수 (기본: 20)',
              },
            },
          },
        },
        {
          name: 'memory_get_stats',
          description: '메모리 시스템 통계를 조회합니다.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'memory_start_conversation',
          description: '새 대화를 시작합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: '프로젝트 경로',
              },
              title: {
                type: 'string',
                description: '대화 제목 (선택)',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'memory_get_recent_messages',
          description: '최근 메시지를 조회합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              conversationId: {
                type: 'string',
                description: '대화 ID (선택)',
              },
              count: {
                type: 'number',
                description: '메시지 수 (기본: 10)',
              },
            },
          },
        },
        {
          name: 'memory_force_compress',
          description: '현재 버퍼를 강제로 압축합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              conversationId: {
                type: 'string',
                description: '대화 ID (선택)',
              },
            },
          },
        },
        // 이미지 처리 도구들
        {
          name: 'image_analyze',
          description: '이미지를 분석하고 설명, 타입, 주요 요소, 텍스트를 추출합니다. (Manus 스타일)',
          inputSchema: {
            type: 'object',
            properties: {
              imagePath: {
                type: 'string',
                description: '이미지 파일 경로 또는 URL',
              },
              customPrompt: {
                type: 'string',
                description: '커스텀 분석 프롬프트 (선택)',
              },
            },
            required: ['imagePath'],
          },
        },
        {
          name: 'image_extract_code',
          description: '스크린샷에서 코드를 추출합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              imagePath: {
                type: 'string',
                description: '스크린샷 파일 경로',
              },
            },
            required: ['imagePath'],
          },
        },
        {
          name: 'image_analyze_diagram',
          description: '다이어그램/플로우차트를 분석하고 노드와 연결 관계를 추출합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              imagePath: {
                type: 'string',
                description: '다이어그램 이미지 파일 경로',
              },
            },
            required: ['imagePath'],
          },
        },
        {
          name: 'image_to_memory',
          description: '이미지를 분석하여 대화 메모리에 저장합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              imagePath: {
                type: 'string',
                description: '이미지 파일 경로',
              },
              conversationId: {
                type: 'string',
                description: '대화 ID (선택)',
              },
            },
            required: ['imagePath'],
          },
        },
        // LLM 관련 도구
        {
          name: 'llm_list_models',
          description: '사용 가능한 LLM 모델 목록을 조회합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['summarization', 'vision'],
                description: '모델 타입 (요약용 또는 Vision용)',
              },
            },
          },
        },
        {
          name: 'llm_set_model',
          description: '요약에 사용할 LLM 모델을 변경합니다.',
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description: 'OpenRouter 모델 ID (예: google/gemini-2.0-flash-exp:free)',
              },
            },
            required: ['model'],
          },
        },
      ],
    }));

    // 도구 호출
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          // 오케스트라 협력 도구
          case 'memory_should_compress':
            return await this.handleShouldCompress();

          case 'memory_auto_save':
            return await this.handleAutoSave(args as {
              role: 'user' | 'assistant';
              content: string;
            });

          case 'memory_get_snapshot':
            return await this.handleGetSnapshot();

          case 'memory_initialize_session':
            return await this.handleInitializeSession(args as {
              topic?: string;
            });

          case 'memory_set_thresholds':
            return await this.handleSetThresholds(args as {
              compressionThreshold: number;
              warningThreshold: number;
            });

          // 메모리 도구들
          case 'memory_add_message':
            return await this.handleAddMessage(args as {
              role: 'user' | 'assistant' | 'system';
              content: string;
              conversationId?: string;
            });

          case 'memory_get_context':
            return await this.handleGetContext(args as {
              conversationId?: string;
            });

          case 'memory_search':
            return await this.handleSearch(args as {
              query: string;
              conversationId?: string;
              limit?: number;
            });

          case 'memory_list_conversations':
            return await this.handleListConversations(args as {
              limit?: number;
            });

          case 'memory_get_stats':
            return await this.handleGetStats();

          case 'memory_start_conversation':
            return await this.handleStartConversation(args as {
              projectPath: string;
              title?: string;
            });

          case 'memory_get_recent_messages':
            return await this.handleGetRecentMessages(args as {
              conversationId?: string;
              count?: number;
            });

          case 'memory_force_compress':
            return await this.handleForceCompress(args as {
              conversationId?: string;
            });

          // 이미지 도구들
          case 'image_analyze':
            return await this.handleImageAnalyze(args as {
              imagePath: string;
              customPrompt?: string;
            });

          case 'image_extract_code':
            return await this.handleImageExtractCode(args as {
              imagePath: string;
            });

          case 'image_analyze_diagram':
            return await this.handleImageAnalyzeDiagram(args as {
              imagePath: string;
            });

          case 'image_to_memory':
            return await this.handleImageToMemory(args as {
              imagePath: string;
              conversationId?: string;
            });

          // LLM 도구들
          case 'llm_list_models':
            return await this.handleListModels(args as {
              type?: 'summarization' | 'vision';
            });

          case 'llm_set_model':
            return await this.handleSetModel(args as {
              model: string;
            });

          default:
            throw new Error(`알 수 없는 도구: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `오류: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });

    // 리소스 목록
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'memory://context',
          name: '현재 대화 컨텍스트',
          description: '현재 대화의 압축된 컨텍스트',
          mimeType: 'text/plain',
        },
        {
          uri: 'memory://stats',
          name: '메모리 통계',
          description: '메모리 시스템 통계',
          mimeType: 'application/json',
        },
        {
          uri: 'memory://models',
          name: '사용 가능한 모델',
          description: '요약 및 Vision에 사용 가능한 LLM 모델 목록',
          mimeType: 'application/json',
        },
      ],
    }));

    // 리소스 읽기
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'memory://context') {
        const context = await this.memory.getContext();
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: context || '컨텍스트가 없습니다.',
            },
          ],
        };
      }

      if (uri === 'memory://stats') {
        const stats = this.memory.getStats();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      if (uri === 'memory://models') {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(RECOMMENDED_MODELS, null, 2),
            },
          ],
        };
      }

      throw new Error(`알 수 없는 리소스: ${uri}`);
    });
  }

  // ========== 메모리 핸들러 ==========

  private async handleAddMessage(args: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    conversationId?: string;
  }) {
    await this.memory.addMessage(args.role, args.content, args.conversationId);
    
    return {
      content: [
        {
          type: 'text',
          text: '메시지가 추가되었습니다.',
        },
      ],
    };
  }

  private async handleGetContext(args: { conversationId?: string }) {
    const context = await this.memory.getContext(args.conversationId);
    
    return {
      content: [
        {
          type: 'text',
          text: context || '컨텍스트가 없습니다.',
        },
      ],
    };
  }

  private async handleSearch(args: {
    query: string;
    conversationId?: string;
    limit?: number;
  }) {
    const results = this.memory.search(args.query, args.conversationId, args.limit);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  private async handleListConversations(args: { limit?: number }) {
    const conversations = this.memory.listConversations(args.limit);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(conversations, null, 2),
        },
      ],
    };
  }

  private async handleGetStats() {
    const stats = this.memory.getStats();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  private async handleStartConversation(args: {
    projectPath: string;
    title?: string;
  }) {
    const conversation = this.memory.startConversation(args.projectPath, args.title);
    
    return {
      content: [
        {
          type: 'text',
          text: `새 대화가 시작되었습니다: ${conversation.id}`,
        },
      ],
    };
  }

  private async handleGetRecentMessages(args: {
    conversationId?: string;
    count?: number;
  }) {
    const messages = this.memory.getRecentMessages(args.conversationId, args.count);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(messages, null, 2),
        },
      ],
    };
  }

  private async handleForceCompress(args: { conversationId?: string }) {
    await this.memory.forceCompress(args.conversationId);
    
    return {
      content: [
        {
          type: 'text',
          text: '압축이 완료되었습니다.',
        },
      ],
    };
  }

  // ========== 이미지 핸들러 ==========

  private async handleImageAnalyze(args: {
    imagePath: string;
    customPrompt?: string;
  }) {
    const result = await this.imageProcessor.analyzeImage(args.imagePath, args.customPrompt);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleImageExtractCode(args: { imagePath: string }) {
    const result = await this.imageProcessor.extractCodeFromScreenshot(args.imagePath);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleImageAnalyzeDiagram(args: { imagePath: string }) {
    const result = await this.imageProcessor.analyzeDiagram(args.imagePath);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleImageToMemory(args: {
    imagePath: string;
    conversationId?: string;
  }) {
    const processed = await this.imageProcessor.processForMemory(args.imagePath);
    
    // 이미지 분석 결과를 메모리에 저장
    await this.memory.addMessage(
      'user',
      `[이미지 첨부]\n${processed.summary}\n\n추출된 내용:\n${processed.extractedContent}`,
      args.conversationId
    );
    
    return {
      content: [
        {
          type: 'text',
          text: `이미지가 분석되어 메모리에 저장되었습니다.\n태그: ${processed.tags.join(', ')}`,
        },
      ],
    };
  }

  // ========== LLM 핸들러 ==========

  private async handleListModels(args: { type?: 'summarization' | 'vision' }) {
    const type = args.type || 'summarization';
    const models = RECOMMENDED_MODELS[type];
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(models, null, 2),
        },
      ],
    };
  }

  private async handleSetModel(args: { model: string }) {
    this.llmProvider.setModel(args.model);
    
    return {
      content: [
        {
          type: 'text',
          text: `모델이 ${args.model}로 변경되었습니다.`,
        },
      ],
    };
  }

  // ========== 오케스트라 협력 핸들러 ==========

  private async handleShouldCompress() {
    const result = await this.orchestratorTools.shouldCompress();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleAutoSave(args: {
    role: 'user' | 'assistant';
    content: string;
  }) {
    const result = await this.orchestratorTools.autoSaveMessage(args.role, args.content);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleGetSnapshot() {
    const result = await this.orchestratorTools.getSnapshot();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleInitializeSession(args: { topic?: string }) {
    const result = await this.orchestratorTools.initializeSession(args.topic);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleSetThresholds(args: {
    compressionThreshold: number;
    warningThreshold: number;
  }) {
    this.orchestratorTools.setThresholds(args.compressionThreshold, args.warningThreshold);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            ...this.orchestratorTools.getConfig(),
          }, null, 2),
        },
      ],
    };
  }

  // ========== 서버 제어 ==========

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP] Conversation Memory V2.1 서버 시작');
    console.error('[MCP] 지원 기능: 메모리 관리, 이미지 분석, 다중 LLM, 오케스트라 협력');
  }

  async stop(): Promise<void> {
    await this.memory.close();
    await this.server.close();
    console.error('[MCP] 서버 중지');
  }
}

/**
 * MCP 서버 실행
 */
export async function runMCPServer(config: Partial<ConvMemoryConfig> = {}): Promise<void> {
  const server = new MCPServer(config);
  
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}
