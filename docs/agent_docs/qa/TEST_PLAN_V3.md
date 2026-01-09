# Conversation Memory V3: Cloud Edition - 통합 테스트 계획서

---

**문서 버전**: 1.0
**작성일**: 2026년 1월 9일
**작성자**: Manus AI

---

## 1. 개요 (Overview)

본 문서는 **Conversation Memory V3**의 핵심 기능인 **하이브리드 스토리지(Hybrid Storage)**, **클라우드 동기화(Cloud Sync)**, 그리고 **보안 설정(Secure Config)**이 의도한 대로 동작하는지 검증하기 위한 테스트 계획입니다.

테스트는 **단위 테스트(Unit Test)**와 **통합 테스트(Integration Test)**의 범위를 포괄하며, 특히 외부 의존성(Supabase)이 없는 환경에서도 로직을 검증할 수 있도록 **Mocking 전략**을 적극 활용합니다.

## 2. 테스트 범위 (Scope)

### 2.1. 대상 모듈
- **ConfigManager**: 암호화/복호화, 파일 권한, 환경 변수 우선순위.
- **SQLiteProvider**: 로컬 DB CRUD, WAL 모드 동작.
- **SupabaseProvider**: 동기화 큐(Queue), 백그라운드 전송, 에러 핸들링.
- **MemoryManager**: Provider 스위칭 및 상위 로직.

### 2.2. 제외 대상
- 실제 Supabase 서버와의 통신 (Mock으로 대체).
- LLM 압축 알고리즘의 품질 (기능 동작 여부만 확인).

## 3. 테스트 시나리오 (Test Scenarios)

### 시나리오 A: 보안 설정 관리 (Security)
1.  **암호화 저장**: `ConfigManager`를 통해 API Key를 저장하면, 디스크의 `config.json` 파일에는 암호화된 문자열이 저장되어야 한다.
2.  **복호화 로드**: 저장된 설정을 다시 불러오면, 원본 API Key가 정상적으로 복호화되어야 한다.
3.  **권한 확인**: 생성된 `config.json` 파일의 권한이 `600` (rw-------)인지 확인한다.

### 시나리오 B: 로컬 우선 저장 (Local-First)
1.  **오프라인 저장**: Supabase 설정이 없는 상태에서 `MemoryManager.addItem()`을 호출하면, SQLite에만 데이터가 저장되어야 한다.
2.  **데이터 무결성**: 저장된 데이터를 `getRecentLogs()`로 조회했을 때, 입력한 내용과 일치해야 한다.

### 시나리오 C: 클라우드 동기화 (Cloud Sync)
1.  **동기화 트리거**: Supabase 설정이 활성화된 상태에서 로그를 추가하면, `SupabaseProvider` 내부의 `syncQueue`에 아이템이 추가되어야 한다.
2.  **Mock 전송**: `processSyncQueue()`가 실행될 때, Mock Supabase 클라이언트의 `insert` 메서드가 호출되어야 한다.
3.  **에러 재시도**: 전송 실패 시(Mock Error), 아이템이 큐에서 사라지지 않고 유지되어야 한다.

## 4. 테스트 환경 (Environment)

- **OS**: Ubuntu 22.04 (Sandbox)
- **Node.js**: v18+
- **Dependencies**: `better-sqlite3`, `jest` (또는 자체 테스트 스크립트)

## 5. 실행 계획 (Execution Plan)

1.  **테스트 스크립트 작성**: `tests/integration-v3.ts` 작성.
2.  **Mock 구현**: `SupabaseClient`를 흉내 내는 Mock Class 구현.
3.  **실행 및 리포트**: 스크립트 실행 후 콘솔 출력 및 로그 분석.

## 6. 성공 기준 (Pass Criteria)

- 모든 시나리오(A, B, C)에서 예외(Exception)가 발생하지 않아야 한다.
- 암호화된 키와 원본 키가 달라야 한다.
- Mock Supabase에 전송된 데이터 건수가 로컬에 저장된 건수와 일치해야 한다.
