/**
 * Memory Factory - 팩토리 드루이드 패턴
 * 
 * 한 번의 설치로 Claude Code와 OpenCode에서 자동 메모리 관리를 제공합니다.
 */

// Claude Code 모듈
export { ClaudeCodeHooksGenerator } from './claude-code/hooks-config';
export * as ClaudeCodeHandlers from './claude-code/hook-handlers';

// OpenCode 모듈
export { MemoryFactoryPlugin } from './opencode/memory-factory-plugin';

// 설치 스크립트
export * from './install';
