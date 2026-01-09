#!/usr/bin/env node
/**
 * Conversation Memory V2 CLI
 * OpenCode/ClaudeCode 호환 CLI 에이전트
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ConversationMemory } from '../memory.js';
import { runMCPServer } from '../mcp/server.js';
import { ConvMemoryConfig, DEFAULT_CONFIG } from '../types.js';
import { formatNumber, formatPercent, relativeTime } from '../utils/helpers.js';
import { formatTokens } from '../utils/tokenizer.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const program = new Command();

// 설정 로드
function loadConfig(configPath?: string): Partial<ConvMemoryConfig> {
  const paths = [
    configPath,
    join(process.cwd(), '.conv-memory.json'),
    join(process.cwd(), 'conv-memory.config.json'),
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        return JSON.parse(content);
      } catch (e) {
        console.warn(chalk.yellow(`설정 파일 로드 실패: ${p}`));
      }
    }
  }

  return {};
}

// 메모리 인스턴스 생성
function createMemory(options: { config?: string }): ConversationMemory {
  const config = loadConfig(options.config);
  return new ConversationMemory(config);
}

program
  .name('conv-memory')
  .description('Conversation Memory V2 - 대화 컨텍스트 압축 및 관리')
  .version('1.0.0');

// ============================================================================
// MCP 서버 명령
// ============================================================================

program
  .command('serve')
  .description('MCP 서버 시작 (OpenCode/ClaudeCode 연동)')
  .option('-c, --config <path>', '설정 파일 경로')
  .action(async (options) => {
    const config = loadConfig(options.config);
    console.error(chalk.blue('🚀 MCP 서버 시작 중...'));
    await runMCPServer(config);
  });

// ============================================================================
// 대화 관리 명령
// ============================================================================

program
  .command('start')
  .description('새 대화 시작')
  .argument('[project-path]', '프로젝트 경로', process.cwd())
  .option('-t, --title <title>', '대화 제목')
  .option('-c, --config <path>', '설정 파일 경로')
  .action((projectPath, options) => {
    const memory = createMemory(options);
    const conversation = memory.startConversation(resolve(projectPath), options.title);
    
    console.log(chalk.green('✓ 대화 시작됨'));
    console.log(chalk.gray(`  ID: ${conversation.id}`));
    console.log(chalk.gray(`  경로: ${conversation.projectPath}`));
    
    memory.close();
  });

program
  .command('list')
  .description('대화 목록 조회')
  .option('-l, --limit <number>', '최대 결과 수', '20')
  .option('-c, --config <path>', '설정 파일 경로')
  .action((options) => {
    const memory = createMemory(options);
    const conversations = memory.listConversations(parseInt(options.limit));

    if (conversations.length === 0) {
      console.log(chalk.yellow('저장된 대화가 없습니다.'));
    } else {
      console.log(chalk.blue(`\n📝 대화 목록 (${conversations.length}개)\n`));
      
      for (const conv of conversations) {
        const title = conv.title || '(제목 없음)';
        const time = relativeTime(conv.updatedAt);
        const tokens = formatTokens(conv.tokenCount);
        
        console.log(chalk.white(`  ${conv.id}`));
        console.log(chalk.gray(`    ${title} | ${conv.messageCount}개 메시지 | ${tokens} 토큰 | ${time}`));
        console.log();
      }
    }

    memory.close();
  });

// ============================================================================
// 메시지 명령
// ============================================================================

program
  .command('add')
  .description('메시지 추가')
  .argument('<role>', '역할 (user/assistant/system)')
  .argument('<content>', '메시지 내용')
  .option('-i, --conversation-id <id>', '대화 ID')
  .option('-c, --config <path>', '설정 파일 경로')
  .action(async (role, content, options) => {
    if (!['user', 'assistant', 'system'].includes(role)) {
      console.error(chalk.red('오류: role은 user, assistant, system 중 하나여야 합니다.'));
      process.exit(1);
    }

    const memory = createMemory(options);
    
    // 대화 ID가 없으면 현재 디렉토리로 시작
    if (!options.conversationId) {
      memory.startConversation(process.cwd());
    } else {
      memory.setCurrentConversation(options.conversationId);
    }

    const spinner = ora('메시지 추가 중...').start();
    
    try {
      const message = await memory.addMessage(role, content);
      spinner.succeed('메시지 추가됨');
      
      const bufferStatus = memory.getBufferStatus();
      console.log(chalk.gray(`  버퍼: ${bufferStatus.fillPercent.toFixed(1)}% (${bufferStatus.tokenCount} 토큰)`));
      
      if (bufferStatus.fillPercent >= 70) {
        console.log(chalk.yellow('  ⚠ 청크 생성 예정'));
      }
    } catch (error) {
      spinner.fail('메시지 추가 실패');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }

    await memory.close();
  });

program
  .command('recent')
  .description('최근 메시지 조회')
  .option('-n, --count <number>', '메시지 수', '10')
  .option('-i, --conversation-id <id>', '대화 ID')
  .option('-c, --config <path>', '설정 파일 경로')
  .action((options) => {
    const memory = createMemory(options);

    if (!options.conversationId) {
      memory.startConversation(process.cwd());
    } else {
      memory.setCurrentConversation(options.conversationId);
    }

    const messages = memory.getRecentMessages(undefined, parseInt(options.count));

    if (messages.length === 0) {
      console.log(chalk.yellow('메시지가 없습니다.'));
    } else {
      console.log(chalk.blue(`\n💬 최근 메시지 (${messages.length}개)\n`));
      
      for (const msg of messages) {
        const roleColor = msg.role === 'user' ? chalk.cyan :
                         msg.role === 'assistant' ? chalk.green : chalk.yellow;
        const time = relativeTime(msg.timestamp);
        
        console.log(roleColor(`[${msg.role.toUpperCase()}]`) + chalk.gray(` ${time}`));
        console.log(chalk.white(`  ${msg.content.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}`));
        console.log();
      }
    }

    memory.close();
  });

// ============================================================================
// 컨텍스트 명령
// ============================================================================

program
  .command('context')
  .description('압축된 컨텍스트 조회')
  .option('-i, --conversation-id <id>', '대화 ID')
  .option('-c, --config <path>', '설정 파일 경로')
  .action(async (options) => {
    const memory = createMemory(options);

    if (!options.conversationId) {
      memory.startConversation(process.cwd());
    } else {
      memory.setCurrentConversation(options.conversationId);
    }

    const context = await memory.getContext();

    if (!context) {
      console.log(chalk.yellow('컨텍스트가 없습니다. 더 많은 메시지가 필요합니다.'));
    } else {
      console.log(chalk.blue('\n📋 압축된 컨텍스트\n'));
      console.log(context);
    }

    await memory.close();
  });

program
  .command('compress')
  .description('강제 압축 실행')
  .option('-i, --conversation-id <id>', '대화 ID')
  .option('-c, --config <path>', '설정 파일 경로')
  .action(async (options) => {
    const memory = createMemory(options);

    if (!options.conversationId) {
      memory.startConversation(process.cwd());
    } else {
      memory.setCurrentConversation(options.conversationId);
    }

    const spinner = ora('압축 중...').start();
    
    try {
      await memory.forceCompress();
      spinner.succeed('압축 완료');
    } catch (error) {
      spinner.fail('압축 실패');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }

    await memory.close();
  });

// ============================================================================
// 검색 명령
// ============================================================================

program
  .command('search')
  .description('대화 기록 검색')
  .argument('<query>', '검색 쿼리')
  .option('-l, --limit <number>', '최대 결과 수', '10')
  .option('-i, --conversation-id <id>', '대화 ID')
  .option('-c, --config <path>', '설정 파일 경로')
  .action((query, options) => {
    const memory = createMemory(options);
    const results = memory.search(query, options.conversationId, parseInt(options.limit));

    if (results.length === 0) {
      console.log(chalk.yellow('검색 결과가 없습니다.'));
    } else {
      console.log(chalk.blue(`\n🔍 검색 결과 (${results.length}개)\n`));
      
      for (const result of results) {
        const typeIcon = result.type === 'message' ? '💬' :
                        result.type === 'chunk' ? '📦' : '📋';
        
        console.log(`${typeIcon} ${chalk.white(result.id)}`);
        if (result.highlights.length > 0) {
          console.log(chalk.gray(`  ${result.highlights[0]}`));
        }
        console.log();
      }
    }

    memory.close();
  });

// ============================================================================
// 통계 명령
// ============================================================================

program
  .command('stats')
  .description('메모리 시스템 통계')
  .option('-c, --config <path>', '설정 파일 경로')
  .action((options) => {
    const memory = createMemory(options);
    const stats = memory.getStats();
    const workerStatus = memory.getWorkerStatus();

    console.log(chalk.blue('\n📊 메모리 시스템 통계\n'));
    
    console.log(chalk.white('  저장소'));
    console.log(chalk.gray(`    대화: ${formatNumber(stats.conversations)}개`));
    console.log(chalk.gray(`    메시지: ${formatNumber(stats.messages)}개`));
    console.log(chalk.gray(`    청크: ${formatNumber(stats.chunks)}개`));
    console.log(chalk.gray(`    병합 컨텍스트: ${formatNumber(stats.mergedContexts)}개`));
    console.log();
    
    console.log(chalk.white('  토큰'));
    console.log(chalk.gray(`    현재 사용: ${formatTokens(stats.totalTokens)}`));
    console.log(chalk.gray(`    절약된 토큰: ${formatTokens(stats.savedTokens)}`));
    console.log(chalk.gray(`    압축률: ${formatPercent(stats.compressionRatio)}`));
    console.log();
    
    console.log(chalk.white('  워커'));
    console.log(chalk.gray(`    상태: ${workerStatus.isRunning ? '실행 중' : '중지됨'}`));
    console.log(chalk.gray(`    대기 청크: ${workerStatus.pendingChunks}개`));
    console.log(chalk.gray(`    대기 작업: ${workerStatus.pendingTasks}개`));

    memory.close();
  });

// ============================================================================
// 설정 명령
// ============================================================================

program
  .command('init')
  .description('설정 파일 초기화')
  .option('-f, --force', '기존 파일 덮어쓰기')
  .action((options) => {
    const configPath = join(process.cwd(), '.conv-memory.json');
    
    if (existsSync(configPath) && !options.force) {
      console.log(chalk.yellow('설정 파일이 이미 존재합니다. -f 옵션으로 덮어쓰기 가능합니다.'));
      return;
    }

    const config = {
      ...DEFAULT_CONFIG,
      dbPath: '.conv-memory/memory.db',
    };

    const { writeFileSync } = require('fs');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    console.log(chalk.green(`✓ 설정 파일 생성됨: ${configPath}`));
  });

// 파싱 및 실행
program.parse();
