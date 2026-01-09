# Product Requirements Document (PRD): The Forge

## 1. Introduction
The Forge는 Gemini 2.0 Flash를 기반으로 하는 로컬 자율 코딩 에이전트입니다. 사용자의 자연어 명령을 받아 프로젝트 구조를 분석하고, 계획을 수립하며, 코드를 작성하고 수정합니다.

## 2. Core Features

### 2.1 Agent Core
*   **Model**: Gemini 2.0 Flash (Default), Grok 2 (Optional via Web Auto).
*   **Architecture**: ReAct (Reasoning + Acting) Loop.
*   **Context Management**: 1M Token Context Window 활용.

### 2.2 Memory System (The Garden)
*   **Short-term**: 현재 세션의 대화 및 작업 내역.
*   **Long-term**: `.forge/memory.db` (SQLite)에 저장된 사용자 선호도, 프로젝트 히스토리.
*   **Knowledge Graph**: 코드 간의 의존성 및 관계를 그래프 형태로 저장 (Future Plan).

### 2.3 Tool Use
*   **File Operations**: Read, Write, Edit, List.
*   **Shell Execution**: Command execution, Package installation.
*   **Web Automation**: Puppeteer를 이용한 웹 브라우징 및 Grok 제어.

### 2.4 CLI Interface (The Forge REPL)
*   **Interactive Mode**: 사용자와 실시간 대화.
*   **Slash Commands**:
    *   `/plan`: 작업 계획 수립.
    *   `/clear`: 컨텍스트 초기화.
    *   `/model`: 모델 변경.
    *   `/wiki`: 문서 자동 생성.

## 3. User Flow
1.  **Install**: `npm install -g memory-factory`
2.  **Init**: 프로젝트 폴더에서 `memory-factory forge` 실행.
3.  **Command**: "이 프로젝트의 구조를 분석해줘" 또는 "로그인 페이지를 만들어줘".
4.  **Execution**: 에이전트가 계획을 수립하고 도구를 사용하여 작업 수행.
5.  **Review**: 사용자가 결과물을 확인하고 피드백 제공.

## 4. Technical Stack
*   **Language**: TypeScript (Node.js).
*   **Database**: SQLite (via Better-SQLite3).
*   **LLM Provider**: Google Generative AI SDK, Puppeteer (for Grok).
*   **UI**: Ink (React for CLI).

## 5. Non-Functional Requirements
*   **Performance**: 모든 응답은 3초 이내에 시작되어야 함 (Streaming).
*   **Security**: `.env` 파일 등 민감 정보는 절대 외부로 전송하지 않음.
*   **Reliability**: 네트워크 오류 시 자동 재시도 (Exponential Backoff).
