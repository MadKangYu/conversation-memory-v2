#!/bin/bash

#######################################
# Conversation Memory V2 - 자동 설치 스크립트
# Claude Code / OpenCode / Cline 연동
# 
# 사용법: curl -fsSL https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.sh | bash
#######################################

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 로고 출력
echo -e "${BLUE}"
cat << "EOF"
   ____                                      _   _             
  / ___|___  _ ____   _____ _ __ ___  __ _| |_(_) ___  _ __  
 | |   / _ \| '_ \ \ / / _ \ '__/ __|/ _` | __| |/ _ \| '_ \ 
 | |__| (_) | | | \ V /  __/ |  \__ \ (_| | |_| | (_) | | | |
  \____\___/|_| |_|\_/ \___|_|  |___/\__,_|\__|_|\___/|_| |_|
                                                              
  __  __                                  __     ______  
 |  \/  | ___ _ __ ___   ___  _ __ _   _  \ \   / /___ \ 
 | |\/| |/ _ \ '_ ` _ \ / _ \| '__| | | |  \ \ / /  __) |
 | |  | |  __/ | | | | | (_) | |  | |_| |   \ V /  / __/ 
 |_|  |_|\___|_| |_| |_|\___/|_|   \__, |    \_/  |_____|
                                   |___/                 
EOF
echo -e "${NC}"

echo -e "${GREEN}🚀 Conversation Memory V2 설치를 시작합니다...${NC}\n"

# 운영체제 감지
OS="$(uname -s)"
ARCH="$(uname -m)"

echo -e "${BLUE}📋 시스템 정보:${NC}"
echo "  OS: $OS"
echo "  Architecture: $ARCH"
echo ""

#######################################
# 1. 필수 도구 확인 및 설치
#######################################
echo -e "${YELLOW}[1/6] 필수 도구 확인 중...${NC}"

# Node.js 확인
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js가 설치되어 있지 않습니다.${NC}"
    echo ""
    echo "Node.js 설치 방법:"
    echo ""
    if [[ "$OS" == "Darwin" ]]; then
        echo "  brew install node"
        echo "  또는"
        echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
        echo "  nvm install 20"
    else
        echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        echo "  sudo apt-get install -y nodejs"
    fi
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 18 이상이 필요합니다. 현재 버전: $(node -v)${NC}"
    exit 1
fi
echo -e "  ✅ Node.js $(node -v)"

# pnpm 확인
if ! command -v pnpm &> /dev/null; then
    echo -e "  📦 pnpm 설치 중..."
    npm install -g pnpm
fi
echo -e "  ✅ pnpm $(pnpm -v)"

# Git 확인
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git이 설치되어 있지 않습니다.${NC}"
    exit 1
fi
echo -e "  ✅ Git $(git --version | cut -d' ' -f3)"

#######################################
# 2. 빌드 도구 확인 (better-sqlite3용)
#######################################
echo -e "\n${YELLOW}[2/6] 빌드 도구 확인 중...${NC}"

if [[ "$OS" == "Darwin" ]]; then
    # macOS
    if ! xcode-select -p &> /dev/null; then
        echo -e "  📦 Xcode Command Line Tools 설치 중..."
        xcode-select --install 2>/dev/null || true
        echo -e "${YELLOW}  ⚠️  Xcode CLT 설치 팝업이 나타나면 '설치'를 클릭하세요.${NC}"
        echo -e "  설치 완료 후 이 스크립트를 다시 실행하세요."
        exit 0
    fi
    echo -e "  ✅ Xcode Command Line Tools"
    
    # Python 확인
    if command -v python3 &> /dev/null; then
        echo -e "  ✅ Python3 $(python3 --version | cut -d' ' -f2)"
    fi
else
    # Linux
    if ! command -v gcc &> /dev/null; then
        echo -e "  📦 빌드 도구 설치 중..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y build-essential python3
        elif command -v dnf &> /dev/null; then
            sudo dnf groupinstall -y "Development Tools"
            sudo dnf install -y python3
        elif command -v yum &> /dev/null; then
            sudo yum groupinstall -y "Development Tools"
            sudo yum install -y python3
        fi
    fi
    echo -e "  ✅ GCC $(gcc --version | head -1 | cut -d' ' -f3)"
fi

#######################################
# 3. 프로젝트 클론 및 설치
#######################################
echo -e "\n${YELLOW}[3/6] 프로젝트 설치 중...${NC}"

INSTALL_DIR="$HOME/.conversation-memory-v2"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "  기존 설치 발견, 업데이트 중..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || true
else
    echo -e "  저장소 클론 중..."
    git clone https://github.com/MadKangYu/Manus-Private-Website.git "$INSTALL_DIR-temp"
    mv "$INSTALL_DIR-temp/conversation-memory-v2" "$INSTALL_DIR"
    rm -rf "$INSTALL_DIR-temp"
fi

cd "$INSTALL_DIR"

echo -e "  의존성 설치 중... (1-2분 소요)"
pnpm install --reporter=silent 2>&1 | grep -v "^$" || true

#######################################
# 4. 빌드
#######################################
echo -e "\n${YELLOW}[4/6] 프로젝트 빌드 중...${NC}"

pnpm build 2>&1 | grep -E "(error|Error|ERROR)" && {
    echo -e "${RED}❌ 빌드 실패${NC}"
    echo ""
    echo "better-sqlite3 빌드 오류인 경우:"
    if [[ "$OS" == "Darwin" ]]; then
        echo "  xcode-select --install"
    else
        echo "  sudo apt-get install build-essential python3"
    fi
    exit 1
} || true

# 빌드 확인
if [ ! -f "$INSTALL_DIR/dist/cli/index.js" ]; then
    echo -e "${RED}❌ 빌드 결과물을 찾을 수 없습니다.${NC}"
    exit 1
fi

echo -e "  ✅ 빌드 완료"

#######################################
# 5. Claude Code MCP 설정
#######################################
echo -e "\n${YELLOW}[5/6] Claude Code MCP 설정 중...${NC}"

CLAUDE_CONFIG_DIR="$HOME/.claude"
CLAUDE_MCP_FILE="$CLAUDE_CONFIG_DIR/mcp.json"

mkdir -p "$CLAUDE_CONFIG_DIR"

# 기존 설정 백업
if [ -f "$CLAUDE_MCP_FILE" ]; then
    cp "$CLAUDE_MCP_FILE" "$CLAUDE_MCP_FILE.backup.$(date +%Y%m%d%H%M%S)"
    echo -e "  📋 기존 설정 백업됨"
fi

# MCP 설정 생성/업데이트
if [ -f "$CLAUDE_MCP_FILE" ]; then
    # 기존 설정에 추가
    if command -v jq &> /dev/null; then
        # jq가 있으면 JSON 병합
        jq --arg path "$INSTALL_DIR/dist/cli/index.js" \
           '.mcpServers["conversation-memory"] = {
              "command": "node",
              "args": [$path, "serve"]
            }' "$CLAUDE_MCP_FILE" > "$CLAUDE_MCP_FILE.tmp"
        mv "$CLAUDE_MCP_FILE.tmp" "$CLAUDE_MCP_FILE"
    else
        # jq가 없으면 새로 생성
        cat > "$CLAUDE_MCP_FILE" << EOF
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["$INSTALL_DIR/dist/cli/index.js", "serve"]
    }
  }
}
EOF
    fi
else
    # 새 설정 파일 생성
    cat > "$CLAUDE_MCP_FILE" << EOF
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["$INSTALL_DIR/dist/cli/index.js", "serve"]
    }
  }
}
EOF
fi

echo -e "  ✅ Claude Code MCP 설정 완료: $CLAUDE_MCP_FILE"

#######################################
# 6. OpenCode 설정 (있는 경우)
#######################################
OPENCODE_CONFIG_DIR="$HOME/.opencode"
OPENCODE_CONFIG_FILE="$OPENCODE_CONFIG_DIR/config.json"

if [ -d "$OPENCODE_CONFIG_DIR" ] || command -v opencode &> /dev/null; then
    mkdir -p "$OPENCODE_CONFIG_DIR"
    
    if [ -f "$OPENCODE_CONFIG_FILE" ]; then
        cp "$OPENCODE_CONFIG_FILE" "$OPENCODE_CONFIG_FILE.backup.$(date +%Y%m%d%H%M%S)"
    fi
    
    cat > "$OPENCODE_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["$INSTALL_DIR/dist/cli/index.js", "serve"]
    }
  }
}
EOF
    echo -e "  ✅ OpenCode 설정 완료: $OPENCODE_CONFIG_FILE"
fi

#######################################
# 7. CLI 심볼릭 링크 생성
#######################################
echo -e "\n${YELLOW}[6/6] CLI 설정 중...${NC}"

# 전역 bin 디렉토리
if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
    ln -sf "$INSTALL_DIR/dist/cli/index.js" /usr/local/bin/conv-memory 2>/dev/null || true
    chmod +x /usr/local/bin/conv-memory 2>/dev/null || true
    echo -e "  ✅ CLI 명령어 등록: conv-memory"
else
    # 홈 디렉토리 bin
    mkdir -p "$HOME/.local/bin"
    ln -sf "$INSTALL_DIR/dist/cli/index.js" "$HOME/.local/bin/conv-memory"
    chmod +x "$HOME/.local/bin/conv-memory"
    
    # PATH에 추가
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc" 2>/dev/null || true
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc" 2>/dev/null || true
        echo -e "  ⚠️  PATH에 ~/.local/bin 추가됨. 터미널 재시작 필요"
    fi
    echo -e "  ✅ CLI 명령어 등록: conv-memory (in ~/.local/bin)"
fi

#######################################
# 완료
#######################################
echo ""
echo -e "${GREEN}✅ 설치가 완료되었습니다!${NC}"
echo ""
echo -e "${BLUE}📋 다음 단계:${NC}"
echo ""
echo "1. Claude Code 재시작"
echo ""
echo "2. (선택) API 키 설정 (요약 기능 활성화):"
echo "   export OPENROUTER_API_KEY=\"sk-or-v1-your-key\""
echo "   # ~/.zshrc 또는 ~/.bashrc에 추가하여 영구 설정"
echo ""
echo "3. Claude Code에서 테스트:"
echo "   \"MCP 도구 목록을 보여줘\""
echo ""
echo "4. CLI 사용:"
echo "   conv-memory --help"
echo "   conv-memory start -t \"프로젝트명\""
echo "   conv-memory stats"
echo ""
echo -e "${BLUE}📚 문서:${NC}"
echo "   https://github.com/MadKangYu/Manus-Private-Website/tree/main/conversation-memory-v2"
echo ""
echo -e "${YELLOW}💡 팁: 무료 모델(Gemini 2.0 Flash)이 기본 설정되어 있어 API 키 없이도 기본 기능 사용 가능${NC}"
