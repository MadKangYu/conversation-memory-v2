import { z } from 'zod';

/**
 * 도구 실행 결과
 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  data?: any;
}

/**
 * 도구 정의 인터페이스
 */
export interface Tool<T = any> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  execute(args: T): Promise<ToolResult>;
}

/**
 * 도구 레지스트리
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, args: any): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool not found: ${name}`
      };
    }

    try {
      // 스키마 검증
      const validatedArgs = tool.schema.parse(args);
      return await tool.execute(validatedArgs);
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `Invalid arguments or execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
