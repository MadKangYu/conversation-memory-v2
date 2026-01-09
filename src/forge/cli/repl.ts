import readline from 'readline';
import { randomUUID } from 'crypto';
import { ForgeAgent } from '../agent/core.js';
import { ToolRegistry } from '../tools/base.js';
import { ReadFileTool, WriteFileTool, ListFilesTool } from '../tools/filesystem.js';
import { ExecuteShellTool } from '../tools/shell.js';
import { McpBridge } from '../tools/mcp-bridge.js';
import { createDefaultProvider } from '../../providers/llm-provider.js';
import { MemoryManager } from '../../core/memory-manager.js';
import { KnowledgeManager } from '../../core/knowledge-manager.js';

// 공통 초기화 로직 분리
async function createAgent() {
  const registry = new ToolRegistry();
  registry.register(ReadFileTool);
  registry.register(WriteFileTool);
  registry.register(ListFilesTool);
  registry.register(ExecuteShellTool);

  // MCP Bridge 초기화 (로컬 MCP 서버 연동)
  const mcpBridge = new McpBridge(registry);
  await mcpBridge.loadMcpConfig();

  const llm = createDefaultProvider();
  
  // MemoryManager 초기화 (RAG용)
  const memory = new MemoryManager();

  // KnowledgeManager 초기화
  const knowledgeManager = new KnowledgeManager(process.cwd(), llm, memory);

  const agent = new ForgeAgent({
    llm,
    tools: registry,
    memory, // Dynamic RAG 활성화
    maxSteps: 20
  });

  return { agent, registry, knowledgeManager };
}

export async function runOneShot(prompt: string) {
  const { agent } = await createAgent();
  const sessionId = randomUUID().slice(0, 8);

  console.log(`🔥 The Forge (One-Shot): ${prompt} (Session: ${sessionId})`);
  
  try {
    const response = await agent.run(prompt);
    console.log(`\n🤖 Agent: ${response}`);
  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export async function startRepl() {
  const sessionId = randomUUID().slice(0, 8);
  const { agent, registry, knowledgeManager } = await createAgent();

  // 4. REPL 인터페이스 설정
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nForge> '
  });

  console.log(`🔥 The Forge: Autonomous Coding Agent (Session: ${sessionId})`);
  console.log('Type "exit" to quit, "@help" for commands.\n');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (input === 'exit') {
      rl.close();
      return;
    }

    if (!input) {
      rl.prompt();
      return;
    }

    // @ 명령어 처리
    if (input.startsWith('@')) {
      const [cmd, ...args] = input.slice(1).split(' ');
      const argStr = args.join(' ');

      try {
        switch (cmd) {
          case 'sh':
            console.log(`\n[Direct Exec] Shell: ${argStr}`);
            const shResult = await registry.execute('execute_shell', { command: argStr });
            console.log(shResult.output || shResult.error);
            break;
          
          case 'read':
            console.log(`\n[Direct Exec] Read: ${argStr}`);
            const readResult = await registry.execute('read_file', { path: argStr });
            console.log(readResult.output || readResult.error);
            break;

          case 'list':
            const targetPath = argStr || '.';
            console.log(`\n[Direct Exec] List: ${targetPath}`);
            const listResult = await registry.execute('list_files', { path: targetPath });
            console.log(listResult.output || listResult.error);
            break;

          case 'wiki':
            console.log('\n🌳 Cultivating The Garden... (Analyzing conversation)');
            try {
              const result = await knowledgeManager.digestConversation(process.cwd());
              console.log(result);
            } catch (e) {
              console.error(`Failed to update wiki: ${String(e)}`);
            }
            break;

          case 'help':
            console.log('\nAvailable @ Commands:');
            console.log('  @sh <cmd>    - Execute shell command');
            console.log('  @read <path> - Read file content');
            console.log('  @list [path] - List files in directory');
            console.log('  @wiki        - Generate/Update documentation from conversation');
            console.log('  @help        - Show this help message');
            break;

          default:
            console.log(`\nUnknown command: @${cmd}`);
            console.log('Type "@help" for available commands.');
        }
      } catch (error) {
        console.error(`\n❌ Command Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      rl.prompt();
      return;
    }

    try {
      // 사용자 질문 아카이빙
      await knowledgeManager.archiveQuery(input);

      // 에이전트 실행
      const response = await agent.run(input);
      console.log(`\n🤖 Agent: ${response}`);
    } catch (error) {
      console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    rl.prompt();
  }).on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });
}
