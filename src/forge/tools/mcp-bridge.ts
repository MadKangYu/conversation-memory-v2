import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { ToolRegistry, Tool } from './base.js';

interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

export class McpBridge {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * 로컬 MCP 설정 파일을 찾아 로드합니다.
   */
  async loadMcpConfig(): Promise<void> {
    const configPaths = [
      path.join(os.homedir(), '.claude', 'mcp.json'),
      path.join(os.homedir(), '.cursor', 'mcp.json'),
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        console.log(`[MCP Bridge] Found config at ${configPath}`);
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as McpConfig;
          await this.connectServers(config);
          return;
        } catch (e) {
          console.error(`[MCP Bridge] Failed to load config: ${e}`);
        }
      }
    }
    console.log('[MCP Bridge] No MCP config found.');
  }

  /**
   * MCP 서버들을 실행하고 도구를 등록합니다.
   * (실제 구현에서는 JSON-RPC 통신이 필요하지만, 여기서는 시뮬레이션으로 처리)
   */
  private async connectServers(config: McpConfig): Promise<void> {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      console.log(`[MCP Bridge] Connecting to server: ${name}`);
      
      // 실제로는 여기서 서버 프로세스를 spawn하고 stdio로 JSON-RPC 통신을 해야 함.
      // 현재 단계에서는 "MCP 서버가 연결되었다"는 가정 하에, 
      // 해당 서버가 제공할 것으로 예상되는 도구들을 가상으로 등록합니다.
      
      // 예: 브라우저 도구 (Playwright 등)
      if (name.includes('browser') || name.includes('playwright')) {
        this.registerBrowserTools(name);
      }
      
      // 예: Git 도구
      if (name.includes('git')) {
        this.registerGitTools(name);
      }
    }
  }

  private registerBrowserTools(serverName: string) {
    const tool: Tool = {
      name: 'browser_navigate',
      description: `Navigate to a URL using ${serverName}`,
      schema: z.object({
        url: z.string()
      }),
      execute: async (args: { url: string }) => {
        return { 
          success: true,
          output: `[MCP:${serverName}] Navigated to ${args.url} (Simulated)` 
        };
      }
    };
    this.registry.register(tool);
    console.log(`[MCP Bridge] Registered browser tools from ${serverName}`);
  }

  private registerGitTools(serverName: string) {
    const tool: Tool = {
      name: 'git_commit',
      description: `Commit changes using ${serverName}`,
      schema: z.object({
        message: z.string()
      }),
      execute: async (args: { message: string }) => {
        return { 
          success: true,
          output: `[MCP:${serverName}] Committed with message: ${args.message} (Simulated)` 
        };
      }
    };
    this.registry.register(tool);
    console.log(`[MCP Bridge] Registered git tools from ${serverName}`);
  }
}
