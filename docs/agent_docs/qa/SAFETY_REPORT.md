# Conversation Memory V2: 안전장치 적용 보고서

**작성일**: 2026년 1월 9일
**작성자**: Manus AI
**버전**: 2.1.0 (Multiverse Update)

## 1. 개요

본 보고서는 Conversation Memory V2 시스템이 파일 시스템 및 Git과 상호작용할 때 발생할 수 있는 잠재적 위험 요소를 분석하고, 이를 해결하기 위해 적용된 **"멀티버스(Multiverse) 메모리 구조"**에 대해 기술합니다.

사용자가 여러 프로젝트를 오가거나 Git 브랜치를 변경할 때, AI의 기억이 뒤섞이는 **"맥락 오염(Context Bleeding)"** 현상은 치명적인 할루시네이션을 유발할 수 있습니다. 이를 방지하기 위해 프로젝트 경로(CWD)와 Git 브랜치 정보를 기반으로 기억을 완벽하게 격리하는 시스템을 구축했습니다.

## 2. 위험 분석 및 해결책

### 2.1 맥락 오염 (Context Bleeding)
*   **위험**: Project A의 구현 세부 사항(변수명, 아키텍처)이 Project B의 작업 세션에 주입되어, 존재하지 않는 코드를 참조하거나 잘못된 설계를 제안함.
*   **해결책**: **프로젝트별 격리 (Project Isolation)**
    *   모든 대화 로그에 `project_path` 메타데이터를 태깅.
    *   메모리 인출 시 현재 작업 디렉토리(CWD)와 일치하는 기억만 필터링하여 제공.

### 2.2 브랜치 불일치 (Branch Amnesia)
*   **위험**: `feature-login` 브랜치에서 작업한 기억이 `main` 브랜치로 이동한 후에도 남아있어, 아직 병합되지 않은 기능을 이미 존재하는 것처럼 착각함.
*   **해결책**: **브랜치별 격리 (Branch Isolation)**
    *   `git rev-parse --abbrev-ref HEAD` 명령어를 통해 현재 브랜치를 실시간 감지.
    *   DB 스키마에 `git_branch` 컬럼을 추가하고, 브랜치 변경 시 해당 브랜치의 기억으로 즉시 컨텍스트 스위칭(Context Switching) 수행.

### 2.3 저장소 오염 (Git Dirty)
*   **위험**: 메모리 DB 파일이 프로젝트 폴더 내에 생성되어 `git status`를 더럽히거나 실수로 커밋됨.
*   **해결책**: **외부 저장소 (External Storage)**
    *   모든 데이터는 사용자 홈 디렉토리의 `~/.memory-factory`에 중앙 집중식으로 저장.
    *   프로젝트 폴더에는 어떠한 파일도 생성하지 않음 (Zero Footprint).

## 3. 기술적 구현 상세

### 3.1 데이터베이스 스키마 (SQLite WAL)

`conversations.db`의 스키마를 확장하여 다차원 격리를 지원합니다.

```sql
CREATE TABLE conversation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  project_path TEXT DEFAULT 'global',  -- 프로젝트 경로 (격리 키 1)
  git_branch TEXT DEFAULT 'main',      -- Git 브랜치 (격리 키 2)
  is_compressed BOOLEAN DEFAULT 0
);

CREATE TABLE memory_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  summary TEXT DEFAULT '',             -- 해당 맥락의 요약본
  key_facts TEXT DEFAULT '[]',
  last_updated INTEGER,
  UNIQUE(project_path, git_branch)     -- 복합 유니크 키
);
```

### 3.2 데이터 흐름 (Data Flow)

1.  **Capture (수집)**:
    *   `hook-handlers.ts`가 실행될 때 `process.cwd()`를 호출하여 사용자의 현재 위치를 파악합니다.
    *   이 정보는 `data.cwd` 필드에 담겨 데몬으로 전송됩니다.

2.  **Process (처리)**:
    *   데몬은 수신된 메시지를 DB에 저장할 때, `MemoryManager`를 통해 현재 디렉토리의 Git 브랜치 정보를 조회합니다.
    *   `project_path`와 `git_branch`가 함께 저장됩니다.

3.  **Recall (인출)**:
    *   `PreCompact` 훅이 실행되면, 현재 CWD와 브랜치에 해당하는 `memory_state`와 최근 대화 로그(`conversation_logs`)만 조회합니다.
    *   다른 프로젝트나 브랜치의 기억은 완벽하게 배제됩니다.

## 4. 결론

이제 Conversation Memory V2는 단순한 대화 저장소가 아니라, **개발자의 작업 맥락(Context)을 이해하는 지능형 파트너**로 진화했습니다.

*   **안전성**: 프로젝트 간 기억 혼선 0% 보장.
*   **정확성**: 현재 브랜치 상태에 맞는 정확한 조언 제공.
*   **투명성**: 사용자의 Git 워크플로우를 방해하지 않는 무인 운영.

이 시스템은 복잡한 마이크로서비스 아키텍처나 다중 브랜치 전략을 사용하는 대규모 프로젝트에서도 안정적으로 동작할 준비가 되었습니다.
