# Conversation Memory V2

> **AI 코딩 어시스턴트를 위한 대화 컨텍스트 압축 및 관리 시스템**  
> Claude Code / OpenCode / Cline 호환 MCP 서버 | 다중 LLM 지원 | 이미지 분석

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

---

## 🚀 원클릭 설치

### macOS / Linux
```bash
curl -fsSL https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.sh | bash
```

### Windows (관리자 PowerShell)
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
iwr -useb https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.ps1 | iex
```

**설치 완료 후:** Claude Code 재시작 → "MCP 도구 목록을 보여줘" 입력

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| **점진적 압축** | 500토큰 단위 청킹 + 10% 오버랩 |
| **다중 LLM** | Gemini, Claude, Grok, GPT 등 지원 (OpenRouter 통합) |
| **이미지 분석** | Vision API로 스크린샷/다이어그램 분석 (Manus 스타일) |
| **기계적 병합** | LLM 없이 Jaccard 유사도 기반 중복 제거 |
| **SQLite + FTS5** | 전문 검색 지원 영구 저장소 |
| **비용 효율** | 무료 모델 기본 설정 (Gemini 2.0 Flash) |

---

## 📋 지원 도구

| 도구 | 상태 | 설정 파일 |
|------|------|----------|
| Claude Code | ✅ | `~/.claude/mcp.json` |
| OpenCode | ✅ | `~/.opencode/config.json` |
| Cline (VS Code) | ✅ | VS Code 설정 |
| Cursor | ✅ | MCP 설정 |
| Zed | ✅ | MCP 설정 |
| Droid | ✅ | MCP 설정 |

---

## 🔧 빠른 시작

### 1. 수동 설치 (원클릭 설치 대신)

```bash
git clone https://github.com/MadKangYu/Manus-Private-Website.git
cd Manus-Private-Website/conversation-memory-v2
pnpm install
pnpm build
```

### 2. Claude Code 연동

```json
// ~/.claude/mcp.json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["/절대경로/conversation-memory-v2/dist/cli/index.js", "serve"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-your-key"
      }
    }
  }
}
```

### 3. Claude Code 재시작 후 사용

```
"MCP 도구 목록을 보여줘"
"새 대화를 시작해줘"
"이 이미지를 분석해줘: /path/to/image.png"
```

---

## 🛠 CLI 사용법

```bash
# 새 대화 시작
conv-memory start -t "프로젝트명"

# 메시지 추가
conv-memory add user "질문"
conv-memory add assistant "응답"

# 컨텍스트 조회
conv-memory context

# 검색
conv-memory search "키워드"

# 통계
conv-memory stats

# MCP 서버 시작
conv-memory serve
```

---

## 🔌 MCP 도구

### 메모리 관리
| 도구 | 설명 |
|------|------|
| `memory_start_conversation` | 새 대화 시작 |
| `memory_add_message` | 메시지 추가 |
| `memory_get_context` | 압축된 컨텍스트 조회 |
| `memory_search` | 대화 기록 검색 |
| `memory_get_stats` | 시스템 통계 |
| `memory_force_compress` | 강제 압축 |

### 이미지 분석 (v2.0 신규)
| 도구 | 설명 |
|------|------|
| `image_analyze` | 이미지 분석 (Manus 스타일) |
| `image_extract_code` | 스크린샷에서 코드 추출 |
| `image_analyze_diagram` | 다이어그램 분석 |
| `image_to_memory` | 이미지 분석 후 메모리 저장 |

### LLM 설정 (v2.0 신규)
| 도구 | 설명 |
|------|------|
| `llm_list_models` | 사용 가능한 모델 목록 |
| `llm_set_model` | 요약 모델 변경 |

---

## 🤖 지원 모델

### 요약용 (기본: Gemini 2.0 Flash 무료)
| 모델 | OpenRouter ID | 비용 |
|------|--------------|------|
| Gemini 2.0 Flash | `google/gemini-2.0-flash-exp:free` | 무료 |
| Gemini Flash 1.5 | `google/gemini-flash-1.5` | 저렴 |
| Claude Haiku | `anthropic/claude-3-5-haiku-20241022` | 저렴 |
| GPT-4o Mini | `openai/gpt-4o-mini` | 저렴 |
| Grok 4.1 Fast | `x-ai/grok-4.1-fast` | 중간 |

### Vision용
| 모델 | OpenRouter ID | 비용 |
|------|--------------|------|
| Gemini 2.0 Flash | `google/gemini-2.0-flash-exp:free` | 무료 |
| GPT-4o | `openai/gpt-4o` | 중간 |
| Claude Sonnet | `anthropic/claude-3-5-sonnet-20241022` | 중간 |

---

## 💰 비용

| 사용량 | 무료 모델 | 유료 모델 (Haiku) |
|--------|----------|------------------|
| 청크 1개 요약 | $0 | ~$0.0002 |
| 하루 100개 청크 | $0 | ~$0.02 |
| 월간 (3000개) | $0 | ~$0.60 |

---

## 🏗 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                 Conversation Memory V2.0                     │
├─────────────────────────────────────────────────────────────┤
│  CLI Interface          │  MCP Server                       │
│  (conv-memory)          │  (Claude Code/OpenCode/Cline)     │
├─────────────────────────┴───────────────────────────────────┤
│                    ConversationMemory                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │ Chunker │  │ Indexer │  │ Merger  │  │ BackgroundWorker│ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘ │
├───────┴────────────┴────────────┴─────────────────┴──────────┤
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ LLMProvider     │  │ ImageProcessor│  │ SQLiteStorage  │ │
│  │ (다중 LLM)      │  │ (Vision API) │  │ (FTS5)         │ │
│  └─────────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 데이터 흐름

```
메시지/이미지 → Chunker → 청크 생성 → 백그라운드 요약 → Merger → 병합 컨텍스트
                                          ↓
                                    Indexer (태그 추출)
                                          ↓
                                    SQLite + FTS5 저장
                                          ↓
                                    CacheManager (캐싱)
```

---

## 📚 문서

- **[완벽 튜토리얼](./docs/TUTORIAL.md)** - 상세 설치 및 사용 가이드
- **[문제 해결](./docs/TUTORIAL.md#문제-해결)** - 일반적인 오류 해결

---

## 🔧 문제 해결

### better-sqlite3 빌드 오류

| OS | 해결 명령어 |
|----|------------|
| macOS | `xcode-select --install` |
| Ubuntu/Debian | `sudo apt-get install build-essential python3` |
| Fedora/RHEL | `sudo dnf groupinstall "Development Tools"` |
| Windows | Visual Studio Build Tools 설치 |

### MCP 서버 연결 안됨

```bash
# 1. 경로 확인
ls -la /path/to/dist/cli/index.js

# 2. 수동 테스트
node /path/to/dist/cli/index.js serve

# 3. JSON 문법 확인
cat ~/.claude/mcp.json | python3 -m json.tool
```

---

## 📄 라이선스

MIT License - 자유롭게 사용, 수정, 배포 가능

---

## 🙏 기여

Issues와 Pull Requests 환영합니다!

---

*Built with ❤️ for AI-assisted development*
