# Conversation Memory V2 - 완벽 튜토리얼

> **OpenCode / Claude Code / Cline 연동 가이드**  
> 다중 LLM 지원 + 이미지 분석 + 자동 컨텍스트 압축

---

## 목차

1. [소개](#소개)
2. [원클릭 설치](#원클릭-설치)
3. [수동 설치](#수동-설치)
4. [Claude Code 연동](#claude-code-연동)
5. [OpenCode 연동](#opencode-연동)
6. [Cline (VS Code) 연동](#cline-vs-code-연동)
7. [CLI 사용법](#cli-사용법)
8. [MCP 도구 목록](#mcp-도구-목록)
9. [이미지 분석 기능](#이미지-분석-기능)
10. [LLM 모델 설정](#llm-모델-설정)
11. [문제 해결](#문제-해결)
12. [FAQ](#faq)

---

## 소개

**Conversation Memory V2**는 AI 코딩 어시스턴트(Claude Code, OpenCode, Cline 등)의 대화 컨텍스트를 자동으로 압축하고 관리하는 MCP 서버입니다.

### 핵심 기능

| 기능 | 설명 |
|------|------|
| **점진적 압축** | 500토큰 단위 청킹 + 10% 오버랩 |
| **다중 LLM** | Gemini, Claude, Grok, GPT 등 지원 (OpenRouter 통합) |
| **이미지 분석** | Vision API로 스크린샷/다이어그램 분석 |
| **기계적 병합** | LLM 없이 Jaccard 유사도 기반 중복 제거 |
| **SQLite + FTS5** | 전문 검색 지원 영구 저장소 |
| **비용 효율** | 무료 모델 기본 설정 (Gemini 2.0 Flash) |

### 작동 원리

```
대화 진행 → 500토큰 청킹 → 백그라운드 요약 → 기계적 병합
                                    ↓
                              태그 인덱싱
                                    ↓
                           SQLite + FTS5 저장
                                    ↓
                           압축된 컨텍스트 제공
```

---

## 원클릭 설치

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.sh | bash
```

### Windows (관리자 PowerShell)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
iwr -useb https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.ps1 | iex
```

**설치 완료 후:**
1. Claude Code 재시작
2. "MCP 도구 목록을 보여줘" 입력하여 확인

---

## 수동 설치

### 1. 필수 요구사항

| 도구 | 최소 버전 | 확인 명령어 |
|------|----------|------------|
| Node.js | 18.0.0 | `node --version` |
| pnpm | 8.0.0 | `pnpm --version` |
| Git | 2.0.0 | `git --version` |

### 2. 저장소 클론

```bash
git clone https://github.com/MadKangYu/Manus-Private-Website.git
cd Manus-Private-Website/conversation-memory-v2
```

### 3. 의존성 설치

```bash
pnpm install
```

**better-sqlite3 빌드 오류 시:**

| OS | 해결 명령어 |
|----|------------|
| macOS | `xcode-select --install` |
| Ubuntu/Debian | `sudo apt-get install build-essential python3` |
| Fedora/RHEL | `sudo dnf groupinstall "Development Tools" && sudo dnf install python3` |
| Windows | Visual Studio Build Tools 설치 (C++ 워크로드) |

### 4. 빌드

```bash
pnpm build
```

### 5. 설치 확인

```bash
node dist/cli/index.js --version
# 출력: 1.0.0
```

---

## Claude Code 연동

### 1. MCP 설정 파일 생성

**파일 위치:**
- macOS/Linux: `~/.claude/mcp.json`
- Windows: `%USERPROFILE%\.claude\mcp.json`

```bash
# 디렉토리 생성
mkdir -p ~/.claude
```

### 2. 설정 파일 작성

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["/절대경로/conversation-memory-v2/dist/cli/index.js", "serve"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-your-key-here"
      }
    }
  }
}
```

**경로 예시:**
- macOS: `/Users/username/Projects/Manus-Private-Website/conversation-memory-v2/dist/cli/index.js`
- Linux: `/home/username/Projects/Manus-Private-Website/conversation-memory-v2/dist/cli/index.js`
- Windows: `C:\\Users\\username\\Projects\\Manus-Private-Website\\conversation-memory-v2\\dist\\cli\\index.js`

### 3. Claude Code 재시작

```bash
# 터미널에서 Claude Code 재시작
claude --mcp-debug
```

### 4. 연동 확인

Claude Code에서 다음 입력:
```
MCP 도구 목록을 보여줘
```

**정상 출력 예시:**
```
- memory_add_message: 대화에 새 메시지를 추가합니다
- memory_get_context: 현재 대화의 압축된 컨텍스트를 조회합니다
- memory_search: 대화 기록에서 키워드로 검색합니다
- image_analyze: 이미지를 분석하고 설명을 추출합니다
...
```

---

## OpenCode 연동

### 1. 설정 파일 위치

`~/.opencode/config.json`

### 2. 설정 내용

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["/절대경로/conversation-memory-v2/dist/cli/index.js", "serve"]
    }
  }
}
```

### 3. OpenCode 재시작

```bash
opencode
```

---

## Cline (VS Code) 연동

### 1. VS Code 설정 열기

`Cmd/Ctrl + ,` → "cline mcp" 검색

### 2. settings.json에 추가

```json
{
  "cline.mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["/절대경로/conversation-memory-v2/dist/cli/index.js", "serve"]
    }
  }
}
```

### 3. VS Code 재시작

---

## CLI 사용법

### 기본 명령어

```bash
# 버전 확인
conv-memory --version

# 도움말
conv-memory --help

# 새 대화 시작
conv-memory start -t "프로젝트명" /path/to/project

# 메시지 추가
conv-memory add user "사용자 질문"
conv-memory add assistant "AI 응답"

# 최근 메시지 조회
conv-memory recent -n 10

# 압축된 컨텍스트 조회
conv-memory context

# 대화 기록 검색
conv-memory search "키워드"

# 통계 조회
conv-memory stats

# 강제 압축
conv-memory compress

# 대화 목록
conv-memory list

# MCP 서버 시작 (직접 실행)
conv-memory serve
```

### 실제 워크플로우 예시

```bash
# 1. 프로젝트 시작
conv-memory start -t "E-commerce API" ~/projects/ecommerce

# 2. 개발 중 메시지 저장 (MCP 자동 연동 시 불필요)
conv-memory add user "결제 API 구현해줘"
conv-memory add assistant "Stripe를 사용하여 구현하겠습니다..."

# 3. 다음 날 - 이전 컨텍스트 확인
conv-memory context

# 4. 특정 내용 검색
conv-memory search "결제"
conv-memory search "Stripe"

# 5. 통계 확인
conv-memory stats
```

---

## MCP 도구 목록

### 메모리 관리

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `memory_start_conversation` | 새 대화 시작 | `projectPath` |
| `memory_add_message` | 메시지 추가 | `role`, `content` |
| `memory_get_context` | 압축된 컨텍스트 조회 | - |
| `memory_get_recent_messages` | 최근 메시지 조회 | - |
| `memory_search` | 대화 기록 검색 | `query` |
| `memory_list_conversations` | 대화 목록 조회 | - |
| `memory_get_stats` | 시스템 통계 | - |
| `memory_force_compress` | 강제 압축 | - |

### 이미지 분석

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `image_analyze` | 이미지 분석 (Manus 스타일) | `imagePath` |
| `image_extract_code` | 스크린샷에서 코드 추출 | `imagePath` |
| `image_analyze_diagram` | 다이어그램 분석 | `imagePath` |
| `image_to_memory` | 이미지 분석 후 메모리 저장 | `imagePath` |

### LLM 설정

| 도구 | 설명 | 필수 파라미터 |
|------|------|--------------|
| `llm_list_models` | 사용 가능한 모델 목록 | - |
| `llm_set_model` | 요약 모델 변경 | `model` |

---

## 이미지 분석 기능

### 지원 형식

- **이미지**: PNG, JPG, JPEG, GIF, WebP
- **URL**: HTTP/HTTPS 이미지 URL

### 사용 예시 (Claude Code에서)

```
이 스크린샷을 분석해줘: /path/to/screenshot.png
```

```
이 다이어그램의 구조를 설명해줘: /path/to/diagram.png
```

### 분석 결과 형식

```json
{
  "description": "React 컴포넌트 구조를 보여주는 다이어그램",
  "type": "diagram",
  "elements": ["App", "Header", "Main", "Footer"],
  "extractedText": "...",
  "tags": ["react", "component", "architecture"]
}
```

---

## LLM 모델 설정

### 권장 모델 (요약용)

| 모델 | OpenRouter ID | 비용 | 특징 |
|------|--------------|------|------|
| **Gemini 2.0 Flash** | `google/gemini-2.0-flash-exp:free` | 무료 | 기본값, 빠름 |
| **Gemini Flash 1.5** | `google/gemini-flash-1.5` | 저렴 | 안정적 |
| **Claude Haiku** | `anthropic/claude-3-5-haiku-20241022` | 저렴 | 정확함 |
| **GPT-4o Mini** | `openai/gpt-4o-mini` | 저렴 | 범용 |
| **Grok 4.1 Fast** | `x-ai/grok-4.1-fast` | 중간 | 고성능 |

### 권장 모델 (Vision용)

| 모델 | OpenRouter ID | 비용 | 특징 |
|------|--------------|------|------|
| **Gemini 2.0 Flash** | `google/gemini-2.0-flash-exp:free` | 무료 | 기본값 |
| **GPT-4o** | `openai/gpt-4o` | 중간 | 고정확도 |
| **Claude Sonnet** | `anthropic/claude-3-5-sonnet-20241022` | 중간 | 상세 분석 |

### 모델 변경 방법

**CLI:**
```bash
conv-memory init
# 생성된 .conv-memory.json 편집
```

**MCP 도구:**
```
llm_set_model 도구로 google/gemini-flash-1.5 모델로 변경해줘
```

### 환경 변수 설정

```bash
# OpenRouter (권장)
export OPENROUTER_API_KEY="sk-or-v1-your-key"

# 또는 OpenAI
export OPENAI_API_KEY="sk-your-key"

# 영구 설정 (macOS/Linux)
echo 'export OPENROUTER_API_KEY="sk-or-v1-your-key"' >> ~/.zshrc
source ~/.zshrc
```

---

## 문제 해결

### 1. MCP 서버가 시작되지 않음

**증상:** Claude Code에서 MCP 도구가 보이지 않음

**해결:**
```bash
# 1. 경로 확인
ls -la /path/to/dist/cli/index.js

# 2. 수동 실행 테스트
node /path/to/dist/cli/index.js serve

# 3. mcp.json 문법 확인
cat ~/.claude/mcp.json | python3 -m json.tool

# 4. Claude Code 로그 확인 (macOS)
tail -f ~/Library/Logs/Claude/mcp.log
```

### 2. better-sqlite3 빌드 오류

**증상:** `npm ERR! gyp ERR! build error`

**해결 (OS별):**

| OS | 해결 명령어 |
|----|------------|
| macOS | `xcode-select --install` |
| macOS (Apple Silicon) | `arch -arm64 npm install` |
| Ubuntu/Debian | `sudo apt-get install build-essential python3` |
| Fedora/RHEL | `sudo dnf groupinstall "Development Tools"` |
| Windows | Visual Studio Build Tools 설치 |

**재설치:**
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### 3. API 키 오류

**증상:** `[Worker] API 키 없음, 폴백 요약 사용`

**해결:**
```bash
# 환경 변수 확인
echo $OPENROUTER_API_KEY

# mcp.json에 env 추가
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["..."],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-your-key"
      }
    }
  }
}
```

### 4. 권한 오류

**증상:** `EACCES: permission denied`

**해결:**
```bash
# 소유권 확인
ls -la ~/.conversation-memory-v2

# 권한 수정
chmod -R 755 ~/.conversation-memory-v2
```

### 5. 데이터베이스 손상

**증상:** `SQLITE_CORRUPT` 오류

**해결:**
```bash
# 데이터베이스 백업 및 재생성
mv ~/.conversation-memory-v2/memory.db ~/.conversation-memory-v2/memory.db.backup
conv-memory start -t "새 프로젝트"
```

---

## FAQ

### Q: API 키 없이 사용할 수 있나요?

**A:** 네, 가능합니다. API 키가 없으면 폴백 요약(키워드 기반)이 사용됩니다. 단, LLM 기반 요약보다 품질이 낮습니다.

### Q: 무료로 사용할 수 있나요?

**A:** 네, Gemini 2.0 Flash (무료)가 기본 설정되어 있습니다. OpenRouter 계정만 있으면 무료로 사용 가능합니다.

### Q: 데이터는 어디에 저장되나요?

**A:** `~/.conversation-memory-v2/memory.db` (SQLite 파일)에 저장됩니다.

### Q: 여러 프로젝트를 관리할 수 있나요?

**A:** 네, 각 프로젝트별로 별도의 대화가 생성됩니다. `conv-memory list`로 확인 가능합니다.

### Q: Claude Code 외에 다른 도구에서도 사용 가능한가요?

**A:** 네, MCP 프로토콜을 지원하는 모든 도구에서 사용 가능합니다:
- OpenCode
- Cline (VS Code)
- Cursor
- Zed
- Droid

### Q: 이미지 분석은 어떤 모델을 사용하나요?

**A:** 기본적으로 Gemini 2.0 Flash (Vision)를 사용합니다. GPT-4o나 Claude Sonnet으로 변경 가능합니다.

### Q: 비용은 얼마나 드나요?

**A:** 무료 모델 사용 시 $0입니다. 유료 모델 사용 시:
- 500토큰 청크 1개 요약: 약 $0.0002 (0.3원)
- 하루 100개 청크: 약 $0.02 (30원)

---

## 지원 및 기여

- **GitHub**: https://github.com/MadKangYu/Manus-Private-Website
- **Issues**: 버그 리포트 및 기능 요청
- **Pull Requests**: 기여 환영

---

*Last Updated: 2025-01-09*
