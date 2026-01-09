# Claude Automatic Context Compaction 연구 노트

**출처:** https://platform.claude.com/cookbook/tool-use-automatic-context-compaction

## 핵심 개념

### Context Compaction이란?
- 토큰 사용량이 임계값을 초과할 때 자동으로 대화 기록을 압축
- 200k 토큰 컨텍스트 한계를 넘어서 작업 가능

### 작동 방식
1. 대화 턴마다 토큰 사용량 모니터링
2. 임계값 초과 시 요약 프롬프트를 user 턴으로 주입
3. 모델이 `<summary></summary>` 태그로 감싼 요약 생성
4. 대화 기록 클리어 후 요약만으로 재개
5. 압축된 컨텍스트로 작업 계속

### 주요 파라미터
- `compaction_control`: 자동 컨텍스트 관리 파라미터
- Anthropic SDK >= 0.74.1 필요

### 도구 예시 (Customer Service Agent)
```python
from anthropic import beta_tool

@beta_tool
def get_next_ticket() -> dict:
    """Retrieve the next unprocessed support ticket from the queue."""
    ...
```

### 문제점 (Without Compaction)
- 5개 티켓 × 7개 도구 호출 = 35+ 도구 호출
- 모든 분류, 검색, 응답 결과가 대화 기록에 누적
- 티켓 #5 처리 시 이전 4개 티켓의 모든 상세 정보 포함

## 우리 시스템과의 차이점

### Claude 방식 (한번에 압축)
```
[대화 100% 채움] → [Auto Compact] → [전체를 한번에 요약]
                                      ↓
                          세부 결정/맥락 유실
```

### V2 방식 (점진적 압축)
```
[청크 500토큰] → [요약₁] ─┐
[청크 500토큰] → [요약₂] ─┼→ [JSON 스키마] → [코드로 병합]
[청크 500토큰] → [요약₃] ─┘
                              ↓
                    [인덱스/목차/태그 자동 생성]
                              ↓
                    [SQLite + FTS5 저장]
```

## 핵심 차별점

1. **점진적 압축**: 작은 단위로 나눠서 세부사항 보존
2. **구조화된 출력**: JSON 스키마로 일관된 형식
3. **기계적 병합**: LLM 없이 코드로 조합 (비용 절감)
4. **인덱싱**: FTS5 검색으로 필요한 정보 즉시 검색
5. **백그라운드 처리**: 메인 대화 비차단

## 구현 시 참고사항

- OpenCode/ClaudeCode는 터미널 기반 CLI 에이전트
- MCP 프로토콜 지원 필요
- 세션 관리 및 자동 압축 기능 필수
- OpenRouter 모델 지원 (비용 효율적 요약용)


## compaction_control 파라미터 상세

### 기본 사용법
```python
runner = client.beta.messages.tool_runner(
    model=MODEL,
    max_tokens=4096,
    tools=tools,
    messages=messages,
    compaction_control={
        "enabled": True,
        "context_token_threshold": 5000,  # 압축 트리거 토큰 수
    }
)
```

### 파라미터 옵션
- `enabled` (필수): Boolean - 압축 활성화 여부
- `context_token_threshold` (선택): 압축 트리거 토큰 수 (기본값: 100,000)
- `model` (선택): 요약에 사용할 모델 (예: "claude-haiku-4-5")

### 비용 효율적 요약
```python
compaction_control={
    "enabled": True,
    "model": "claude-haiku-4-5",  # Haiku로 비용 절감
}
```

### 요약에 포함되는 정보
- 카테고리 및 우선순위 할당 내역
- 라우팅된 팀
- 진행 상태 (완료된 티켓, 남은 티켓)
- 워크플로우의 다음 단계

### 주의사항
- `compaction_control`은 tool_runner와 함께 사용 (에이전트 워크플로우용)
- 도구 없는 단순 채팅 앱에서는 동일 원칙으로 수동 구현 필요


## Claude Memory Tool (memory_20250818)

### 핵심 기능
- **교차 대화 학습**: 세션 간 학습 패턴 유지
- **파일 기반 시스템**: `/memories` 디렉토리 하위에 저장
- **클라이언트 측 구현**: 완전한 제어권 제공

### 지원 모델
- Claude Opus 4.1 (`claude-opus-4-1`)
- Claude Opus 4 (`claude-opus-4`)
- Claude Sonnet 4.5 (`claude-sonnet-4-5`)
- Claude Sonnet 4 (`claude-sonnet-4`)
- Claude Haiku 4.5 (`claude-haiku-4-5`)

### Context Editing 전략
1. **Tool use clearing** (`clear_tool_uses_20250919`): 컨텍스트 증가 시 오래된 도구 결과 삭제
2. **Thinking management** (`clear_thinking_20251015`): extended thinking 블록 관리

### 워크플로우 예시
- **세션 1**: Claude가 문제 해결 → 패턴 기록
- **세션 2**: 학습된 패턴 즉시 적용 (더 빠름!)
- **긴 세션**: Context editing으로 대화 관리

### 사용 사례
1. **코드 리뷰 어시스턴트**: 디버깅 패턴 학습, 유사 버그 인식
2. **연구 어시스턴트**: 여러 세션에 걸쳐 지식 축적
3. **고객 지원 봇**: 사용자 선호도, 일반적인 이슈/솔루션 기억
4. **데이터 분석 헬퍼**: 데이터셋 패턴, 분석 기법 저장
