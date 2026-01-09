#######################################
# Conversation Memory V2 - Windows 자동 설치 스크립트
# Claude Code / OpenCode / Cline 연동
#
# 사용법 (관리자 권한 PowerShell):
# Set-ExecutionPolicy Bypass -Scope Process -Force
# iwr -useb https://raw.githubusercontent.com/MadKangYu/Manus-Private-Website/main/conversation-memory-v2/scripts/install.ps1 | iex
#######################################

$ErrorActionPreference = "Stop"

# 색상 함수
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

# 로고
Write-Host @"

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

"@ -ForegroundColor Cyan

Write-Host "🚀 Conversation Memory V2 설치를 시작합니다...`n" -ForegroundColor Green

#######################################
# 1. 필수 도구 확인
#######################################
Write-Host "[1/6] 필수 도구 확인 중..." -ForegroundColor Yellow

# Node.js 확인
$nodeVersion = $null
try {
    $nodeVersion = (node -v 2>$null)
} catch {}

if (-not $nodeVersion) {
    Write-Host "❌ Node.js가 설치되어 있지 않습니다." -ForegroundColor Red
    Write-Host ""
    Write-Host "Node.js 설치 방법:"
    Write-Host "  winget install OpenJS.NodeJS.LTS"
    Write-Host "  또는 https://nodejs.org 에서 다운로드"
    exit 1
}

$nodeVersionNum = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($nodeVersionNum -lt 18) {
    Write-Host "❌ Node.js 18 이상이 필요합니다. 현재 버전: $nodeVersion" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ Node.js $nodeVersion" -ForegroundColor Green

# pnpm 확인
$pnpmVersion = $null
try {
    $pnpmVersion = (pnpm -v 2>$null)
} catch {}

if (-not $pnpmVersion) {
    Write-Host "  📦 pnpm 설치 중..."
    npm install -g pnpm
    $pnpmVersion = (pnpm -v)
}
Write-Host "  ✅ pnpm $pnpmVersion" -ForegroundColor Green

# Git 확인
$gitVersion = $null
try {
    $gitVersion = (git --version 2>$null)
} catch {}

if (-not $gitVersion) {
    Write-Host "❌ Git이 설치되어 있지 않습니다." -ForegroundColor Red
    Write-Host "  winget install Git.Git"
    exit 1
}
Write-Host "  ✅ $gitVersion" -ForegroundColor Green

#######################################
# 2. 빌드 도구 확인
#######################################
Write-Host "`n[2/6] 빌드 도구 확인 중..." -ForegroundColor Yellow

# Visual Studio Build Tools 확인
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasBuildTools = $false

if (Test-Path $vsWhere) {
    $vsInstalls = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json
    if ($vsInstalls.Count -gt 0) {
        $hasBuildTools = $true
    }
}

if (-not $hasBuildTools) {
    Write-Host "  ⚠️  Visual Studio Build Tools가 필요할 수 있습니다." -ForegroundColor Yellow
    Write-Host "  better-sqlite3 빌드 오류 발생 시:"
    Write-Host "    1. https://visualstudio.microsoft.com/visual-cpp-build-tools/ 에서 다운로드"
    Write-Host "    2. 'C++ build tools' 워크로드 선택하여 설치"
    Write-Host ""
    $continue = Read-Host "계속 진행하시겠습니까? (Y/n)"
    if ($continue -eq 'n' -or $continue -eq 'N') {
        exit 0
    }
} else {
    Write-Host "  ✅ Visual Studio Build Tools" -ForegroundColor Green
}

# Python 확인
$pythonVersion = $null
try {
    $pythonVersion = (python --version 2>$null)
} catch {}

if ($pythonVersion) {
    Write-Host "  ✅ $pythonVersion" -ForegroundColor Green
}

#######################################
# 3. 프로젝트 클론 및 설치
#######################################
Write-Host "`n[3/6] 프로젝트 설치 중..." -ForegroundColor Yellow

$installDir = "$env:USERPROFILE\.conversation-memory-v2"

if (Test-Path $installDir) {
    Write-Host "  기존 설치 발견, 업데이트 중..."
    Set-Location $installDir
    git pull origin main 2>$null
} else {
    Write-Host "  저장소 클론 중..."
    git clone https://github.com/MadKangYu/Manus-Private-Website.git "$installDir-temp"
    Move-Item "$installDir-temp\conversation-memory-v2" $installDir
    Remove-Item "$installDir-temp" -Recurse -Force
}

Set-Location $installDir

Write-Host "  의존성 설치 중... (1-2분 소요)"
pnpm install 2>&1 | Out-Null

#######################################
# 4. 빌드
#######################################
Write-Host "`n[4/6] 프로젝트 빌드 중..." -ForegroundColor Yellow

$buildOutput = pnpm build 2>&1
if ($buildOutput -match "error|Error|ERROR") {
    Write-Host "❌ 빌드 실패" -ForegroundColor Red
    Write-Host $buildOutput
    Write-Host ""
    Write-Host "better-sqlite3 빌드 오류인 경우:"
    Write-Host "  1. Visual Studio Build Tools 설치"
    Write-Host "  2. 관리자 권한으로 다시 실행"
    exit 1
}

if (-not (Test-Path "$installDir\dist\cli\index.js")) {
    Write-Host "❌ 빌드 결과물을 찾을 수 없습니다." -ForegroundColor Red
    exit 1
}

Write-Host "  ✅ 빌드 완료" -ForegroundColor Green

#######################################
# 5. Claude Code MCP 설정
#######################################
Write-Host "`n[5/6] Claude Code MCP 설정 중..." -ForegroundColor Yellow

$claudeConfigDir = "$env:USERPROFILE\.claude"
$claudeMcpFile = "$claudeConfigDir\mcp.json"

if (-not (Test-Path $claudeConfigDir)) {
    New-Item -ItemType Directory -Path $claudeConfigDir -Force | Out-Null
}

# 기존 설정 백업
if (Test-Path $claudeMcpFile) {
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    Copy-Item $claudeMcpFile "$claudeMcpFile.backup.$timestamp"
    Write-Host "  📋 기존 설정 백업됨"
}

# 경로 이스케이프
$escapedPath = "$installDir\dist\cli\index.js" -replace '\\', '\\\\'

# MCP 설정 생성
$mcpConfig = @"
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": ["$escapedPath", "serve"]
    }
  }
}
"@

$mcpConfig | Out-File -FilePath $claudeMcpFile -Encoding utf8
Write-Host "  ✅ Claude Code MCP 설정 완료: $claudeMcpFile" -ForegroundColor Green

#######################################
# 6. OpenCode 설정 (있는 경우)
#######################################
$opencodeConfigDir = "$env:USERPROFILE\.opencode"
$opencodeConfigFile = "$opencodeConfigDir\config.json"

if (Test-Path $opencodeConfigDir) {
    if (Test-Path $opencodeConfigFile) {
        $timestamp = Get-Date -Format "yyyyMMddHHmmss"
        Copy-Item $opencodeConfigFile "$opencodeConfigFile.backup.$timestamp"
    }
    
    $mcpConfig | Out-File -FilePath $opencodeConfigFile -Encoding utf8
    Write-Host "  ✅ OpenCode 설정 완료: $opencodeConfigFile" -ForegroundColor Green
}

#######################################
# 7. PATH에 추가
#######################################
Write-Host "`n[6/6] CLI 설정 중..." -ForegroundColor Yellow

# 배치 파일 생성
$batchContent = @"
@echo off
node "$installDir\dist\cli\index.js" %*
"@

$batchFile = "$installDir\conv-memory.cmd"
$batchContent | Out-File -FilePath $batchFile -Encoding ascii

# PATH에 추가
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$installDir", "User")
    Write-Host "  ✅ PATH에 추가됨 (터미널 재시작 필요)" -ForegroundColor Green
} else {
    Write-Host "  ✅ PATH 이미 설정됨" -ForegroundColor Green
}

#######################################
# 완료
#######################################
Write-Host ""
Write-Host "✅ 설치가 완료되었습니다!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 다음 단계:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Claude Code 재시작"
Write-Host ""
Write-Host "2. (선택) API 키 설정 (요약 기능 활성화):"
Write-Host '   $env:OPENROUTER_API_KEY = "sk-or-v1-your-key"'
Write-Host "   # 영구 설정: 시스템 환경 변수에 추가"
Write-Host ""
Write-Host "3. Claude Code에서 테스트:"
Write-Host '   "MCP 도구 목록을 보여줘"'
Write-Host ""
Write-Host "4. CLI 사용 (새 터미널에서):"
Write-Host "   conv-memory --help"
Write-Host "   conv-memory start -t `"프로젝트명`""
Write-Host "   conv-memory stats"
Write-Host ""
Write-Host "📚 문서:" -ForegroundColor Cyan
Write-Host "   https://github.com/MadKangYu/Manus-Private-Website/tree/main/conversation-memory-v2"
Write-Host ""
Write-Host "💡 팁: 무료 모델(Gemini 2.0 Flash)이 기본 설정되어 있어 API 키 없이도 기본 기능 사용 가능" -ForegroundColor Yellow
