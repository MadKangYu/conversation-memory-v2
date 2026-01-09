# Claude Code Hooks 분석

## 핵심 발견: 팩토리 패턴 구현 가능!

### 사용 가능한 Hook Events

| Hook Event | 트리거 시점 | 팩토리 활용 |
|------------|------------|------------|
| **UserPromptSubmit** | 사용자 프롬프트 제출 시 | ✅ 모든 입력 캡처 가능 |
| **PreToolUse** | 도구 사용 전 | ✅ MCP 도구 호출 인터셉트 |
| **PostToolUse** | 도구 사용 후 | ✅ 결과 캡처 가능 |
| **Stop** | 작업 종료 시 | ✅ 응답 완료 캡처 |
| **SubagentStop** | 서브에이전트 종료 시 | ✅ 서브에이전트 응답 캡처 |
| **SessionStart** | 세션 시작 시 | ✅ 팩토리 초기화 |
| **SessionEnd** | 세션 종료 시 | ✅ 정리 작업 |
| **PreCompact** | 압축 전 | ✅ 우리 압축으로 대체 가능! |
| **Notification** | 알림 발생 시 | ⚠️ 제한적 |

### 팩토리 패턴 구현 방법

```json
// .claude/settings.json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-factory init"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-factory capture-input"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-factory capture-output"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-factory provide-context"
          }
        ]
      }
    ]
  }
}
```

### 핵심 발견: PreCompact Hook!

**PreCompact**는 Claude Code가 자체 압축을 실행하기 전에 호출됨.
→ 우리 압축 컨텍스트를 주입할 수 있음!

### Hook Input/Output

- Hook은 stdin으로 JSON 입력을 받음
- stdout으로 JSON 출력 가능
- Exit code로 동작 제어:
  - 0: 계속 진행
  - 1: 에러 (중단)
  - 2: 블로킹 (사용자 확인 필요)

### 결론

**팩토리 패턴 100% 구현 가능!**

1. SessionStart → 팩토리 초기화
2. UserPromptSubmit → 모든 사용자 입력 캡처
3. Stop → 모든 Claude 응답 캡처
4. PreCompact → 우리 압축 컨텍스트 주입

오케스트라 협력 없이 자동 동작 가능!
