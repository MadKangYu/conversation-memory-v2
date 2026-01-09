# 팩토리 드루이드(Factory Druid) 패턴: 통합 구현 전략

## 1. 목표

**"한 번의 설치로 모든 것을 자동화한다."
**
`memory_factory_install` 단일 명령어를 통해, 사용자의 개입 없이 Claude Code와 OpenCode 환경에서 대화 내용을 자동으로 캡처, 압축, 및 주입하는 **완전 자동화 메모리 시스템**을 구축한다.

---

## 2. 핵심 아키텍처

```
┌──────────────────────────────────────────────────────────┐
│                  Installation Script                     │
│               (memory_factory_install)                   │
│                          │                                 │
│                          ↓                                 │
│      ┌───────────────────────────────────────────┐         │
│      │         Platform Detection Engine         │         │
│      └───────────────────────────────────────────┘         │
│                          │                                 │
│      ┌───────────────────┴───────────────────┐             │
│      ↓                                     ↓             │
│┌────────────────┐                      ┌────────────────┐│
││  Claude Code   │                      │    OpenCode    ││
││  Environment   │                      │  Environment   ││
│└────────────────┘                      └────────────────┘│
│      │                                     │             │
│      ↓                                     ↓             │
│┌────────────────┐                      ┌────────────────┐│
││ Hook Config &  │                      │ Plugin File    ││
││ Daemon         │                      │ Generation     ││
│└────────────────┘                      └────────────────┘│
│      │                                     │             │
│      └───────────────────┬───────────────────┘             │
│                          ↓                                 │
│      ┌───────────────────────────────────────────┐         │
│      │          Common Backend Services          │         │
│      │ (SQLite DB, InstantCompressor V3, etc.) │         │
│      └───────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 플랫폼별 구현 전략

### 3.1 Claude Code: Hook + Daemon 모델

- **설치 (`memory_factory_install`):
**  1. `~/.claude/settings.json` 파일에 `UserPromptSubmit`, `Stop`, `PreCompact` 등의 Hook 설정을 JSON 형태로 주입한다.
  2. 각 Hook은 `/path/to/memory-factory-cli <command>` 형태의 쉘 명령어를 실행하도록 설정한다.
  3. `memory-daemon` 백그라운드 프로세스를 시스템 서비스로 등록하고 실행한다. (e.g., `systemd`, `launchd`)

- **실행 (Runtime):
**  1. **Hook 트리거**: `UserPromptSubmit` 등 이벤트 발생 시, Claude Code는 설정된 쉘 명령어를 **동기적**으로 호출한다.
  2. **빠른 반환**: Hook 스크립트는 입력받은 데이터를 즉시 임시 파일이나 메시지 큐에 저장하고 `exit 0`으로 **즉시 종료**하여 Claude Code의 블로킹을 최소화한다.
  3. **비동기 처리**: `memory-daemon`이 파일 시스템이나 메시지 큐를 감시하다가, 새로운 데이터가 감지되면 백그라운드에서 압축 및 DB 저장을 수행한다.
  4. **컨텍스트 주입**: `PreCompact` Hook이 호출되면, CLI 명령어는 데몬에게 **동기적**으로 압축된 컨텍스트를 요청하고, 이를 stdout으로 출력하여 Claude Code에 전달한다.

### 3.2 OpenCode: 내장 플러그인(Plugin) 모델

- **설치 (`memory_factory_install`):
**  1. `~/.config/opencode/plugin/` 디렉터리에 `memory-factory.ts` 플러그인 파일을 생성한다.
  2. 이 플러그인 파일은 필요한 모든 로직(이벤트 리스너, 백그라운드 워커, 압축 로직)을 포함한다.

- **실행 (Runtime):
**  1. **플러그인 로드**: OpenCode 시작 시, 플러그인을 자동으로 로드하고 초기화 함수를 실행한다.
  2. **이벤트 리스닝**: 플러그인은 `session.created`, `message.updated`, `tool.execute.after`, `experimental.session.compacting` 등 필요한 이벤트를 구독한다.
  3. **비동기 처리**: OpenCode의 이벤트 루프를 활용하여 `async/await`으로 비동기 처리를 수행한다. 별도의 데몬 없이, 플러그인 내에서 `setInterval` 이나 `Promise` 기반의 워커를 구현하여 백그라운드 압축을 처리한다.
  4. **컨텍스트 주입**: `experimental.session.compacting` 이벤트 핸들러가 트리거되면, `await`를 통해 백그라운드 워커로부터 압축된 컨텍스트를 받아 `output.context.push()`를 통해 주입한다.

---

## 4. 공통 백엔드 모듈

- **`InstantCompressorV3`**: 플랫폼에 상관없이 동일한 압축 로직을 사용한다.
- **`SQLiteRepository`**: FTS5를 활용한 SQLite 데이터베이스 접근 로직을 공통으로 사용한다.
- **`QueueManager`**: (Claude Code의 경우) 파일 기반 큐 또는 (OpenCode의 경우) 메모리 내 큐를 관리한다.

---

## 5. 다음 단계: V6 아키텍처 구현

위 전략을 바탕으로 Conversation Memory V2의 V6 아키텍처 구현을 진행한다.

1. **`memory_factory_install` 스크립트 개발**
   - 플랫폼 감지 로직 구현
   - Claude Code용 Hook 설정 생성기 및 데몬 설치 스크립트 작성
   - OpenCode용 플러그인 파일 생성기 작성

2. **Claude Code 연동 모듈 개발**
   - Hook에서 호출될 CLI 명령어 구현 (`capture-input`, `capture-output`, `provide-context`)
   - `memory-daemon` 프로세스 구현

3. **OpenCode 연동 모듈 개발**
   - `memory-factory.ts` 플러그인 템플릿 작성
   - 이벤트 핸들러 및 내장 워커 로직 구현

4. **통합 테스트**
   - 각 플랫폼 환경에서 `memory_factory_install` 실행 후 자동 메모리 관리 기능이 정상 동작하는지 검증
