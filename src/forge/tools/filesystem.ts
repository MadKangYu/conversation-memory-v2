import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { Tool, ToolResult } from './base.js';

export const ReadFileTool: Tool = {
  name: 'read_file',
  description: '파일의 내용을 읽습니다.',
  schema: z.object({
    path: z.string().describe('읽을 파일의 경로 (상대 경로 또는 절대 경로)')
  }),
  async execute({ path: filePath }) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, output: content };
    } catch (error) {
      return { success: false, output: '', error: `Failed to read file: ${error}` };
    }
  }
};

export const WriteFileTool: Tool = {
  name: 'write_file',
  description: '파일에 내용을 씁니다. (덮어쓰기)',
  schema: z.object({
    path: z.string().describe('쓸 파일의 경로'),
    content: z.string().describe('파일 내용')
  }),
  async execute({ path: filePath, content }) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true, output: `File written to ${filePath}` };
    } catch (error) {
      return { success: false, output: '', error: `Failed to write file: ${error}` };
    }
  }
};

export const ListFilesTool: Tool = {
  name: 'list_files',
  description: '디렉토리 내의 파일 목록을 조회합니다.',
  schema: z.object({
    path: z.string().describe('조회할 디렉토리 경로'),
    recursive: z.boolean().optional().describe('하위 디렉토리 포함 여부')
  }),
  async execute({ path: dirPath, recursive }) {
    try {
      // 간단한 구현: 재귀적 조회는 추후 고도화
      const files = await fs.readdir(dirPath);
      return { success: true, output: files.join('\n') };
    } catch (error) {
      return { success: false, output: '', error: `Failed to list files: ${error}` };
    }
  }
};
