#!/bin/bash

# ==============================================================================
# Claude Code Hook Wrapper
# 
# Claude Code로부터 상속받은 민감한 API 키 환경 변수를 제거하여
# "Credential unauthorized" 오류를 방지하고 보안을 강화합니다.
# ==============================================================================

# 민감한 환경 변수 제거 (Unset)
unset ANTHROPIC_API_KEY
unset CLAUDE_API_KEY
unset OPENAI_API_KEY
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset GOOGLE_API_KEY

# 스크립트 디렉터리 찾기
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDLER_SCRIPT="$SCRIPT_DIR/hook-handlers.ts"

# ts-node가 없으면 node로 실행 (컴파일된 js가 있다고 가정)
if command -v ts-node >/dev/null 2>&1; then
    exec ts-node "$HANDLER_SCRIPT" "$@"
else
    # 컴파일된 JS 파일 경로 (dist 폴더 가정)
    JS_HANDLER="$SCRIPT_DIR/../../../dist/factory/claude-code/hook-handlers.js"
    if [ -f "$JS_HANDLER" ]; then
        exec node "$JS_HANDLER" "$@"
    else
        # 개발 환경 (ts-node 없이 ts 실행 불가하므로 에러)
        echo "Error: ts-node not found and compiled js not found." >&2
        exit 1
    fi
fi
