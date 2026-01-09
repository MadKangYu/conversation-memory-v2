# Conversation Memory V2 & Claude Code: 완벽 연동 가이드

**작성자**: Manus AI
**날짜**: 2026년 1월 9일

## 1. 개요

이 문서는 **Conversation Memory V2**를 **Claude Code**에 연동하여, 장기 프로젝트의 컨텍스트 한계를 극복하는 전체 과정을 단계별로 안내합니다.

| 목표 | 설명 |
|---|---|
| **컨텍스트 보존** | Claude Code의 200K 토큰 컨텍스트 윈도우 한계를 넘어, 수백만 토큰의 대화 기록을 영구적으로 관리합니다. |
| **자동화** | 설치부터 컨텍스트 압축까지, 모든 과정을 자동화하여 사용자는 본연의 개발 작업에만 집중할 수 있도록 합니다. |
| **비용 최적화** | OpenRouter를 통해 Gemini, Grok 등 저비용/무료 모델을 활용하여 요약 비용을 최소화합니다. |

## 2. 사전 준비

| 항목 | 설치 명령어 | 버전 |
|---|---|---|
| **Node.js** | `nvm install 20 && nvm use 20` | v18+ (v20 권장) |
| **pnpm** | `npm install -g pnpm` | 최신 버전 |
| **Git** | `brew install git` / `sudo apt install git` | 최신 버전 |
| **Claude Code** | [공식 사이트](https://claude.ai/code)에서 다운로드 | 최신 버전 |
| **(선택) API 키** | [OpenRouter](https://openrouter.ai/keys)에서 발급 | - |

## 3. Step 1: 원클릭 자동 설치

터미널을 열고, 사용 중인 운영체제에 맞는 명령어를 복사하여 붙여넣으세요.

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.sh | bash
```

### Windows (관리자 권한 PowerShell)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.ps1'))
```

#### 자동 설치 스크립트가 수행하는 작업:

1.  **저장소 클론**: `~/Projects/conversation-memory-v2` 위치에 프로젝트를 다운로드합니다.
2.  **의존성 설치**: `pnpm install`을 실행하여 필요한 모든 패키지를 설치합니다. (`better-sqlite3` 네이티브 빌드 포함)
3.  **프로젝트 빌드**: `pnpm build`를 실행하여 TypeScript 코드를 JavaScript로 컴파일합니다.
4.  **MCP 설정**: `~/.claude/mcp.json` 파일을 찾아, Conversation Memory V2를 MCP 서버로 자동 등록합니다. (기존 파일이 있으면 백업)

## 4. Step 2: API 키 설정 (요약 기능 활성화)

이 단계는 선택 사항이지만, **대화 요약 기능**을 사용하려면 필수입니다.

1.  [OpenRouter](https://openrouter.ai/keys)에서 API 키를 발급받습니다.
2.  터미널에서 아래 명령어를 실행하여 환경 변수를 설정합니다.

### macOS / Linux (`~/.zshrc` 또는 `~/.bashrc`)

```bash
# OpenRouter API 키 설정
echo 'export OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx"' >> ~/.zshrc

# 터미널 재시작 또는 아래 명령어 실행
source ~/.zshrc
```

### Windows (PowerShell)

```powershell
# 영구 환경 변수 설정
[System.Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', 'sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx', 'User')

# 터미널 재시작
```

**확인**: `echo $OPENROUTER_API_KEY` (macOS/Linux) 또는 `echo $env:OPENROUTER_API_KEY` (Windows)를 실행하여 키가 올바르게 출력되는지 확인합니다.

## 5. Step 3: 연동 확인

1.  **Claude Code를 완전히 종료했다가 다시 시작합니다.**
2.  Claude Code가 시작되면, Conversation Memory V2 MCP 서버가 백그라운드에서 자동으로 실행됩니다.
3.  Claude Code의 채팅창에서 다음 질문을 하여 연동을 테스트합니다.

> `memory_get_stats` 도구를 호출해서 현재 메모리 상태를 알려줘.

**예상 응답:**

```json
{
  "totalConversations": 0,
  "totalMessages": 0,
  "totalTokens": 0,
  "compressedTokens": 0,
  "compressionRatio": 0
}
```

위와 같이 통계 정보가 반환되면 연동에 성공한 것입니다.

## 6. Step 4: 실전 워크플로우

### 6.1. 프로젝트 시작: `CLAUDE.md` 파일 생성

가장 중요한 단계입니다. Claude Code가 Conversation Memory V2를 자동으로 사용하도록 **규칙**을 알려줘야 합니다.

1.  작업하려는 프로젝트의 **루트 디렉토리**에 `CLAUDE.md` 파일을 생성합니다.
2.  아래 내용을 복사하여 붙여넣습니다.

```markdown
# Memory Management Rules for Conversation Memory V2

This project uses Conversation Memory V2 for long-term context management.

## Required Actions

1.  **Before each response**: Call the `memory_should_compress` tool to check if the conversation history needs to be compressed.
2.  **If `shouldCompress` is true**: Call `memory_get_context` and **replace** the entire conversation history in your context with the compressed summary provided.
3.  **After each response**: Call the `memory_add_message` tool to save your response to the long-term memory.

## Search Past Conversations

When you need information from previous sessions (e.g., "what was the database schema we decided on last week?"), use the `memory_search` tool with relevant keywords.
```

이제 Claude Code는 이 프로젝트에서 작업할 때마다 `CLAUDE.md`의 규칙을 자동으로 따릅니다.

### 6.2. 대화 진행

이제 평소처럼 Claude Code와 대화하며 개발을 진행하면 됩니다. 백그라운드에서는 다음과 같은 일들이 자동으로 일어납니다:

-   **모든 대화 저장**: 매 턴마다 `memory_add_message`가 호출되어 대화가 영구적으로 저장됩니다.
-   **자동 압축**: 대화가 50K 토큰에 도달하면 `memory_should_compress`가 `true`를 반환하고, Claude Code는 `memory_get_context`를 호출하여 컨텍스트를 압축된 버전으로 교체합니다.

### 6.3. 과거 내용 검색

> 지난주에 논의했던 데이터베이스 스키마에 대해 다시 알려줘.

위와 같이 질문하면, Claude Code는 `memory_search("데이터베이스 스키마")`를 호출하여 과거 대화 기록을 검색하고 정확한 정보를 찾아줍니다.

## 7. 문제 해결 (Troubleshooting)

| 문제 상황 | 해결 방법 |
|---|---|
| **`better-sqlite3` 빌드 오류** | 1. **macOS**: `xcode-select --install` 실행<br>2. **Windows**: Visual Studio Build Tools 설치<br>3. **Ubuntu/Debian**: `sudo apt install build-essential python3`<br>4. `rm -rf node_modules` 후 `pnpm install` 재시도 |
| **MCP 서버 미작동** | 1. `~/.claude/mcp.json` 파일의 경로가 정확한지 확인<br>2. `node --version`으로 Node.js 버전이 18 이상인지 확인<br>3. Claude Code 로그 파일 확인 (`~/Library/Logs/Claude/mcp.log`) |
| **API 키 오류** | 1. `echo $OPENROUTER_API_KEY`로 환경 변수가 올바르게 설정되었는지 확인<br>2. 키 값에 오타가 없는지 확인 |

## 8. 부록: CLI 명령어

MCP 연동 없이도 터미널에서 직접 메모리를 관리할 수 있습니다.

| 명령어 | 설명 |
|---|---|
| `conv-memory serve` | MCP 서버를 수동으로 시작합니다. |
| `conv-memory start -t "프로젝트명"` | 새 대화를 시작합니다. |
| `conv-memory add user "메시지"` | 사용자 메시지를 추가합니다. |
| `conv-memory context` | 현재 대화의 압축된 컨텍스트를 조회합니다. |
| `conv-memory search "키워드"` | 대화 기록을 검색합니다. |
| `conv-memory stats` | 시스템 전체 통계를 확인합니다. |

--- 

이제 여러분은 컨텍스트 윈도우의 한계에서 벗어나, 진정한 의미의 장기 프로젝트를 Claude Code와 함께 수행할 수 있습니다.
