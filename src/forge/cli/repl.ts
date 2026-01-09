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
import { UI } from './ui.js';

// 공통 초기화 로직 분리
async function createAgent() {
  const spinner = UI.spinner('Initializing Hextech Core...').start();
  
  try {
    const registry = new ToolRegistry();
    registry.register(ReadFileTool);
    registry.register(WriteFileTool);
    registry.register(ListFilesTool);
    registry.register(ExecuteShellTool);

    // MCP Bridge 초기화 (로컬 MCP 서버 연동)
    spinner.text = 'Bridging MCP Protocols...';
    const mcpBridge = new McpBridge(registry);
    await mcpBridge.loadMcpConfig();

    spinner.text = 'Connecting to Neural Network (Gemini 2.0)...';
    const llm = createDefaultProvider();
    
    // MemoryManager 초기화 (RAG용)
    spinner.text = 'Loading Memory Crystals...';
    const memory = new MemoryManager();

    // KnowledgeManager 초기화
    const knowledgeManager = new KnowledgeManager(process.cwd(), llm, memory);

    const agent = new ForgeAgent({
      llm,
      tools: registry,
      memory, // Dynamic RAG 활성화
      maxSteps: 20
    });

    spinner.succeed('System Online.');
    return { agent, registry, knowledgeManager };
  } catch (error) {
    spinner.fail('Initialization Failed.');
    throw error;
  }
}

export async function runOneShot(prompt: string) {
  UI.printHeader();
  const { agent } = await createAgent();
  const sessionId = randomUUID().slice(0, 8);

  UI.box(`One-Shot Mode Initiated\nSession: ${sessionId}`, 'SYSTEM', 'info');
  UI.log.system(`Input: ${prompt}`);
  
  try {
    const spinner = UI.spinner('Processing...').start();
    const response = await agent.run(prompt);
    spinner.stop();
    UI.log.agent(response);
  } catch (error) {
    UI.log.error(`${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export async function startRepl() {
  UI.printHeader();
  const sessionId = randomUUID().slice(0, 8);
  const { agent, registry, knowledgeManager } = await createAgent();

  // 4. REPL 인터페이스 설정
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: UI.prompt()
  });

  UI.box(
    `Session ID: ${sessionId}\nType "exit" to quit, "@help" for commands.`,
    'SYSTEM READY',
    'success'
  );

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
            UI.log.system(`Shell Exec: ${argStr}`);
            const shResult = await registry.execute('execute_shell', { command: argStr });
            console.log(shResult.output || shResult.error);
            break;
          
          case 'read':
            UI.log.system(`Reading: ${argStr}`);
            const readResult = await registry.execute('read_file', { path: argStr });
            console.log(readResult.output || readResult.error);
            break;

          case 'list':
            const targetPath = argStr || '.';
            UI.log.system(`Listing: ${targetPath}`);
            const listResult = await registry.execute('list_files', { path: targetPath });
            console.log(listResult.output || listResult.error);
            break;

          case 'wiki':
            const wikiSpinner = UI.spinner('Cultivating The Garden...').start();
            try {
              const result = await knowledgeManager.digestConversation(process.cwd());
              wikiSpinner.succeed('Knowledge Updated');
              console.log(result);
            } catch (e) {
              wikiSpinner.fail(`Failed: ${String(e)}`);
            }
            break;

          case 'help':
            UI.box(
              '@sh <cmd>    - Execute shell command\n' +
              '@read <path> - Read file content\n' +
              '@list [path] - List files in directory\n' +
              '@wiki        - Generate/Update documentation\n' +
              '@help        - Show this help message',
              'COMMANDS'
            );
            break;

          default:
            UI.log.warn(`Unknown command: @${cmd}`);
        }
      } catch (error) {
        UI.log.error(`${error instanceof Error ? error.message : String(error)}`);
      }
      
      rl.prompt();
      return;
    }

    try {
      // 사용자 질문 아카이빙
      await knowledgeManager.archiveQuery(input);

      // 에이전트 실행
      const spinner = UI.spinner('Thinking...').start();
      const response = await agent.run(input);
      spinner.stop();
      UI.log.agent(response);
    } catch (error) {
      UI.log.error(`${error instanceof Error ? error.message : String(error)}`);
    }

    rl.prompt();
  }).on('close', () => {
    console.log('\n');
    UI.log.system('System Shutdown.');
    process.exit(0);
  });
}
