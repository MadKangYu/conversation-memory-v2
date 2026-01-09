/**
 * Claude Code Factory Druid - Hooks Configuration Generator
 * 
 * Claude Code의 settings.json에 주입할 Hook 설정을 생성합니다.
 * 한 번 설치하면 모든 대화가 자동으로 캡처되고 압축됩니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ClaudeHook {
  type: 'command' | 'prompt';
  command?: string;
  prompt?: string;
}

interface ClaudeHookMatcher {
  matcher?: string;
  hooks: ClaudeHook[];
}

interface ClaudeHooksConfig {
  hooks: {
    SessionStart?: ClaudeHookMatcher[];
    UserPromptSubmit?: ClaudeHookMatcher[];
    PreToolUse?: ClaudeHookMatcher[];
    PostToolUse?: ClaudeHookMatcher[];
    Stop?: ClaudeHookMatcher[];
    SubagentStop?: ClaudeHookMatcher[];
    PreCompact?: ClaudeHookMatcher[];
    SessionEnd?: ClaudeHookMatcher[];
  };
}

export class ClaudeCodeHooksGenerator {
  private binaryPath: string;
  private dataDir: string;

  constructor(options?: { binaryPath?: string; dataDir?: string }) {
    this.binaryPath = options?.binaryPath || this.getDefaultBinaryPath();
    this.dataDir = options?.dataDir || path.join(os.homedir(), '.memory-factory');
  }

  private getDefaultBinaryPath(): string {
    // 래퍼 스크립트의 절대 경로 반환
    return path.join(__dirname, 'wrapper.sh');
  }

  /**
   * Claude Code Hook 설정 생성
   */
  generateHooksConfig(): ClaudeHooksConfig {
    return {
      hooks: {
        // 세션 시작 시 팩토리 초기화
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} session-start`
              }
            ]
          }
        ],

        // 사용자 입력 캡처
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} capture-input`
              }
            ]
          }
        ],

        // MCP 도구 호출 전 캡처
        PreToolUse: [
          {
            matcher: 'mcp__memory__.*',  // 우리 메모리 도구는 제외
            hooks: []  // 빈 배열로 스킵
          },
          {
            matcher: '.*',  // 다른 모든 도구
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} capture-tool-call`
              }
            ]
          }
        ],

        // MCP 도구 호출 결과 캡처
        PostToolUse: [
          {
            matcher: 'mcp__memory__.*',
            hooks: []
          },
          {
            matcher: '.*',
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} capture-tool-result`
              }
            ]
          }
        ],

        // Claude 응답 완료 시 캡처
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} capture-output`
              }
            ]
          }
        ],

        // 서브에이전트 응답 캡처
        SubagentStop: [
          {
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} capture-subagent-output`
              }
            ]
          }
        ],

        // ⭐ 핵심: 압축 전 우리 컨텍스트 주입
        PreCompact: [
          {
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} provide-context`
              }
            ]
          }
        ],

        // 세션 종료 시 정리
        SessionEnd: [
          {
            hooks: [
              {
                type: 'command',
                command: `${this.binaryPath} session-end`
              }
            ]
          }
        ]
      }
    };
  }

  /**
   * Claude Code settings.json 경로 반환
   */
  getSettingsPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.claude', 'settings.json');
  }

  /**
   * 기존 settings.json에 hooks 설정 병합
   */
  async install(): Promise<{ success: boolean; message: string }> {
    const settingsPath = this.getSettingsPath();
    const settingsDir = path.dirname(settingsPath);

    // 디렉터리 생성
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    // 기존 설정 읽기
    let existingSettings: any = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        existingSettings = JSON.parse(content);
      } catch (e) {
        // 파싱 실패 시 빈 객체로 시작
        existingSettings = {};
      }
    }

    // 새 hooks 설정 생성
    const newHooksConfig = this.generateHooksConfig();

    // 기존 hooks와 병합 (우리 설정 우선)
    existingSettings.hooks = {
      ...existingSettings.hooks,
      ...newHooksConfig.hooks
    };

    // 설정 저장
    fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));

    return {
      success: true,
      message: `Claude Code hooks 설정이 ${settingsPath}에 설치되었습니다.`
    };
  }

  /**
   * hooks 설정 제거
   */
  async uninstall(): Promise<{ success: boolean; message: string }> {
    const settingsPath = this.getSettingsPath();

    if (!fs.existsSync(settingsPath)) {
      return { success: true, message: '설정 파일이 없습니다.' };
    }

    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      // hooks 섹션에서 우리 설정만 제거
      if (settings.hooks) {
        const ourHookEvents = [
          'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
          'Stop', 'SubagentStop', 'PreCompact', 'SessionEnd'
        ];

        for (const event of ourHookEvents) {
          if (settings.hooks[event]) {
            // memory-factory 명령어가 포함된 hook만 제거
            settings.hooks[event] = settings.hooks[event].filter(
              (matcher: ClaudeHookMatcher) => 
                !matcher.hooks?.some(h => h.command?.includes('memory-factory'))
            );

            // 빈 배열이면 삭제
            if (settings.hooks[event].length === 0) {
              delete settings.hooks[event];
            }
          }
        }

        // hooks 객체가 비어있으면 삭제
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      return {
        success: true,
        message: 'Claude Code hooks 설정이 제거되었습니다.'
      };
    } catch (e) {
      return {
        success: false,
        message: `설정 제거 실패: ${e}`
      };
    }
  }
}

export default ClaudeCodeHooksGenerator;
