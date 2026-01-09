import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool, ToolResult } from './base.js';

const execAsync = promisify(exec);

export const ExecuteShellTool: Tool = {
  name: 'execute_shell',
  description: '쉘 명령어를 실행합니다. (주의: 보안에 유의)',
  schema: z.object({
    command: z.string().describe('실행할 쉘 명령어')
  }),
  async execute({ command }) {
    try {
      const { stdout, stderr } = await execAsync(command);
      const output = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '');
      return { success: true, output: output.trim() };
    } catch (error: any) {
      return { 
        success: false, 
        output: error.stdout || '', 
        error: `Command failed: ${error.message}\n${error.stderr || ''}` 
      };
    }
  }
};
