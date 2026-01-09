# Claude Code vs OpenCode: 백그라운드 처리 방식 비교 분석

## 1. 개요

이 문서는 Claude Code와 OpenCode의 Hook 시스템 및 백그라운드 처리 방식을 비교 분석하여, 
**팩토리 드루이드 패턴**의 구현 가능성을 검증합니다.

---

## 2. Hook 시스템 비교

### 2.1 Claude Code Hooks

| 항목 | 내용 |
|------|------|
| **구현 방식** | JSON 설정 파일 기반 (`~/.claude/settings.json`) |
| **Hook 타입** | `command` (Bash 명령어) 또는 `prompt` (LLM 평가) |
| **실행 방식** | **동기적** - Hook 완료까지 대기 |
| **입력 방식** | stdin으로 JSON 전달 |
| **출력 방식** | stdout JSON 또는 exit code |

#### 사용 가능한 Hook Events

| Event | 트리거 시점 | 메모리 팩토리 활용 |
|-------|------------|-------------------|
| **SessionStart** | 세션 시작 | ✅ 팩토리 초기화 |
| **UserPromptSubmit** | 사용자 입력 제출 | ✅ 입력 캡처 |
| **PreToolUse** | 도구 사용 전 | ✅ MCP 호출 인터셉트 |
| **PostToolUse** | 도구 사용 후 | ✅ 결과 캡처 |
| **Stop** | 작업 종료 | ✅ 응답 캡처 |
| **SubagentStop** | 서브에이전트 종료 | ✅ 서브에이전트 응답 캡처 |
| **PreCompact** | 압축 전 | ⭐ **핵심!** 우리 압축 주입 |
| **SessionEnd** | 세션 종료 | ✅ 정리 작업 |

#### 예시 설정

```json
{
  "hooks": {
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

---

### 2.2 OpenCode Plugins

| 항목 | 내용 |
|------|------|
| **구현 방식** | TypeScript/JavaScript 플러그인 파일 |
| **위치** | `.opencode/plugin/` 또는 `~/.config/opencode/plugin/` |
| **실행 방식** | **이벤트 기반** - 비동기 지원 |
| **입력 방식** | 함수 파라미터로 전달 |
| **출력 방식** | 함수 반환값 또는 output 객체 수정 |

#### 사용 가능한 Events

| Event | 트리거 시점 | 메모리 팩토리 활용 |
|-------|------------|-------------------|
| **session.created** | 세션 생성 | ✅ 팩토리 초기화 |
| **message.updated** | 메시지 업데이트 | ✅ 메시지 캡처 |
| **tool.execute.before** | 도구 실행 전 | ✅ MCP 호출 인터셉트 |
| **tool.execute.after** | 도구 실행 후 | ✅ 결과 캡처 |
| **session.idle** | 세션 유휴 상태 | ✅ 응답 완료 감지 |
| **session.compacted** | 압축 완료 | ⚠️ 압축 후 알림만 |
| **experimental.session.compacting** | 압축 전 | ⭐ **핵심!** 컨텍스트 주입 |
| **session.deleted** | 세션 삭제 | ✅ 정리 작업 |

#### 예시 플러그인

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const MemoryFactoryPlugin: Plugin = async (ctx) => {
  return {
    // 세션 시작 시 초기화
    event: async ({ event }) => {
      if (event.type === "session.created") {
        await initializeFactory(event.sessionId)
      }
    },
    
    // 도구 실행 전 캡처
    "tool.execute.before": async (input, output) => {
      await captureToolCall(input)
    },
    
    // 압축 전 컨텍스트 주입
    "experimental.session.compacting": async (input, output) => {
      const compressedContext = await getCompressedContext()
      output.context.push(compressedContext)
    }
  }
}
```

---

## 3. 백그라운드 처리 방식 비교

### 3.1 Claude Code

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code                                                │
│       │                                                     │
│       ↓ (Hook 트리거)                                       │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Hook Command (동기 실행)                               ││
│  │  - stdin으로 JSON 입력 받음                             ││
│  │  - 처리 완료까지 Claude Code 대기                       ││
│  │  - stdout으로 결과 반환                                 ││
│  └─────────────────────────────────────────────────────────┘│
│       │                                                     │
│       ↓ (Hook 완료 후 계속)                                 │
└─────────────────────────────────────────────────────────────┘
```

**백그라운드 처리 전략:**

```bash
#!/bin/bash
# memory-factory capture-input

# 1. 입력을 파일에 저장 (빠르게)
cat > /tmp/memory-queue/$(date +%s%N).json

# 2. 백그라운드 데몬에 신호 전송
kill -USR1 $(cat /tmp/memory-daemon.pid) 2>/dev/null || true

# 3. 즉시 반환
exit 0
```

**장점:**
- Hook 자체는 빠르게 반환
- 별도 데몬이 백그라운드에서 처리
- PreCompact에서 동기적으로 압축 결과 제공 가능

---

### 3.2 OpenCode

```
┌─────────────────────────────────────────────────────────────┐
│  OpenCode                                                   │
│       │                                                     │
│       ↓ (Event 발생)                                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Plugin Handler (비동기 지원)                           ││
│  │  - async/await 사용 가능                                ││
│  │  - Promise 반환 가능                                    ││
│  │  - 이벤트 루프에서 실행                                 ││
│  └─────────────────────────────────────────────────────────┘│
│       │                                                     │
│       ↓ (await 완료 또는 fire-and-forget)                   │
└─────────────────────────────────────────────────────────────┘
```

**백그라운드 처리 전략:**

```typescript
export const MemoryFactoryPlugin: Plugin = async (ctx) => {
  // 백그라운드 워커 시작 (fire-and-forget)
  const worker = startBackgroundWorker()
  
  return {
    "tool.execute.after": async (input, output) => {
      // 큐에 추가하고 즉시 반환 (await 없이)
      worker.enqueue({ type: 'tool_result', data: output })
    },
    
    "experimental.session.compacting": async (input, output) => {
      // 압축 시에는 동기적으로 대기
      const context = await worker.getCompressedContext()
      output.context.push(context)
    }
  }
}
```

**장점:**
- 네이티브 async/await 지원
- 별도 데몬 불필요 (플러그인 내 워커)
- 더 깔끔한 통합

---

## 4. 핵심 차이점 요약

| 항목 | Claude Code | OpenCode |
|------|-------------|----------|
| **Hook 언어** | Bash/Shell | TypeScript/JavaScript |
| **실행 모델** | 동기 (프로세스) | 비동기 (이벤트 루프) |
| **백그라운드 처리** | 별도 데몬 필요 | 플러그인 내 워커 가능 |
| **MCP Hook 지원** | ✅ PreToolUse/PostToolUse | ✅ tool.execute.before/after (수정됨) |
| **압축 Hook** | ✅ PreCompact | ✅ experimental.session.compacting |
| **컨텍스트 주입** | ✅ stdout JSON | ✅ output.context.push() |
| **프롬프트 대체** | ⚠️ 제한적 | ✅ output.prompt 설정 가능 |

---

## 5. 팩토리 패턴 구현 가능성

### 5.1 Claude Code

**가능!** ✅

```
memory_factory_install 호출
       │
       ↓
~/.claude/settings.json에 hooks 설정 추가
       │
       ↓
memory-daemon 백그라운드 시작
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│  자동 동작                                               │
│  - UserPromptSubmit → 입력 캡처 → 큐 전송                │
│  - Stop → 응답 캡처 → 큐 전송                            │
│  - 데몬이 백그라운드에서 압축                            │
│  - PreCompact → 압축된 컨텍스트 주입                     │
└──────────────────────────────────────────────────────────┘
```

### 5.2 OpenCode

**가능!** ✅ (더 깔끔함)

```
memory_factory_install 호출
       │
       ↓
~/.config/opencode/plugin/memory-factory.ts 생성
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│  자동 동작 (플러그인 내장)                               │
│  - session.created → 팩토리 초기화                       │
│  - tool.execute.after → 결과 캡처                        │
│  - message.updated → 메시지 캡처                         │
│  - 플러그인 내 워커가 백그라운드 압축                    │
│  - experimental.session.compacting → 컨텍스트 주입       │
└──────────────────────────────────────────────────────────┘
```

---

## 6. 결론

### 6.1 기술적 검증 결과

| 검증 항목 | Claude Code | OpenCode |
|----------|-------------|----------|
| 메시지 자동 캡처 | ✅ 가능 | ✅ 가능 |
| 백그라운드 처리 | ✅ 데몬 분리 | ✅ 플러그인 내장 |
| 컨텍스트 자동 주입 | ✅ PreCompact | ✅ session.compacting |
| MCP 도구 인터셉트 | ✅ 가능 | ✅ 가능 (수정됨) |
| 오케스트라 협력 불필요 | ✅ | ✅ |

### 6.2 권장 구현 전략

**통합 팩토리 패턴:**

1. **단일 설치 명령어**: `memory_factory_install`
2. **플랫폼 감지**: Claude Code vs OpenCode 자동 감지
3. **플랫폼별 설정**:
   - Claude Code: `~/.claude/settings.json` + 데몬
   - OpenCode: `~/.config/opencode/plugin/memory-factory.ts`
4. **공통 백엔드**: SQLite + InstantCompressor V3

### 6.3 다음 단계

1. **Claude Code 팩토리 구현**
   - Hook 설정 생성기
   - 백그라운드 데몬
   - PreCompact 컨텍스트 제공자

2. **OpenCode 팩토리 구현**
   - TypeScript 플러그인
   - 내장 워커
   - session.compacting 핸들러

3. **통합 설치 스크립트**
   - 플랫폼 감지
   - 자동 설정
   - 상태 확인
