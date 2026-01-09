# The Forge (Conversation Memory V2)

## 📋 개요
**The Forge**는 Gemini 2.0 Flash를 기반으로 하는 자율 코딩 에이전트입니다. Claude Code의 기능을 흡수하여 무료로 제공하며, 로컬 환경에서 안전하게 동작합니다.

## 🛠 기술 스택
- **Runtime**: Node.js (TypeScript)
- **Package Manager**: pnpm
- **Database**: SQLite (`better-sqlite3`) with WAL mode
- **LLM**: Gemini 2.0 Flash (via OpenRouter/Direct), Puppeteer (Grok Web)
- **Architecture**: ReAct Pattern, Strategy Pattern

## 📂 프로젝트 구조
- `src/forge/`: 에이전트 코어 (ReAct 루프, 도구)
- `src/providers/`: LLM 전략 (Google, OpenAI, Grok Web 등)
- `src/core/`: 공통 모듈 (Memory, Knowledge, Config)
- `.forge/`: [Hidden] 시스템 데이터 (DB, Logs, Config) - **건드리지 말 것**
- `docs/`: 자동 생성된 위키 및 아키텍처 문서

## 🚀 명령어
- `pnpm run build`: 프로젝트 빌드 (TypeScript 컴파일)
- `pnpm run dev`: 개발 모드 실행
- `memory-factory forge`: 에이전트 실행 (REPL)
- `memory-factory model list`: 사용 가능한 모델 목록 확인

## 📖 추가 문서 (필요 시 참조)
작업 전에 관련 문서를 확인하세요:
- `docs/agent_docs/status/PROJECT_STATUS.md`: 현재 프로젝트 상태 및 구현된 기능 목록
- `docs/agent_docs/architecture/`: 시스템 아키텍처 상세
- `docs/agent_docs/guides/`: 튜토리얼 및 가이드
- `docs/agent_docs/technical/`: 기술 심층 분석 문서
- `docs/history/queries.md`: 사용자 질문 히스토리

## ⚠️ 주의사항
1. **시스템 격리**: 모든 설정과 데이터는 `.forge/` 폴더에 저장해야 합니다. 사용자 디렉토리를 오염시키지 마세요.
2. **에러 처리**: LLM 호출 실패 시 재시도 로직이 내장되어 있습니다.
3. **스타일**: 코드는 Prettier/ESLint 규칙을 따릅니다. (자동 적용됨)
