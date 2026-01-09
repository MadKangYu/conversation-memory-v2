# Product Requirements Document (PRD): The Forge V3.0

## 1. Introduction
The Forge V3.0 aims to solidify the "Conversation Memory" concept into a production-ready CLI tool. This release focuses on the "Hextech" visual overhaul, the implementation of a robust RAG-based memory system, and a seamless onboarding experience via the web dashboard.

## 2. Functional Requirements

### 2.1. CLI Interface (The Terminal)
*   **FR-CLI-01**: The CLI MUST display a Hextech-styled header with ASCII art upon startup.
*   **FR-CLI-02**: The CLI MUST support an interactive REPL mode and a one-shot command mode.
*   **FR-CLI-03**: The `@help` command MUST display categorized commands and detailed usage examples.
*   **FR-CLI-04**: The CLI MUST visually distinguish between "Thinking" (System) and "Speaking" (Output) states using colors (e.g., Dim Gray vs. Neon Green).

### 2.2. Memory System (The Garden)
*   **FR-MEM-01**: The system MUST store all user and agent interactions in a local SQLite database.
*   **FR-MEM-02**: The `MemoryManager` MUST support keyword-based retrieval (RAG) to fetch relevant past context.
*   **FR-MEM-03**: The system MUST automatically compress old logs into summaries to save tokens.
*   **FR-MEM-04**: Memory retrieval MUST be scoped to the current project path and Git branch.

### 2.3. Agent Capabilities (The Core)
*   **FR-AGT-01**: The agent MUST follow a ReAct loop: Thought -> Action -> Observation -> Final Response.
*   **FR-AGT-02**: The agent MUST be able to execute shell commands, read/write files, and search the web (if enabled).
*   **FR-AGT-03**: The agent MUST handle errors gracefully and retry actions up to 3 times before failing.

### 2.4. Web Dashboard (The Portal)
*   **FR-WEB-01**: The landing page MUST feature a "Hextech" aesthetic with neon greens and dark backgrounds.
*   **FR-WEB-02**: The "How It Works" section MUST provide an interactive CLI tutorial simulation.
*   **FR-WEB-03**: The "Agent Process" section MUST visualize the Thinking -> Acting -> Remembering loop.

## 3. Non-Functional Requirements
*   **NFR-01 (Performance)**: CLI startup time MUST be under 1 second.
*   **NFR-02 (Privacy)**: No code or memory data shall leave the local machine unless explicitly configured (e.g., for LLM inference).
*   **NFR-03 (Usability)**: All error messages MUST be human-readable and suggest potential fixes.

## 4. Technical Stack
*   **Runtime**: Node.js (v18+)
*   **Language**: TypeScript
*   **Database**: SQLite (via `better-sqlite3` or similar)
*   **Frontend**: React 19, Tailwind CSS v4
*   **LLM Provider**: OpenRouter (Gemini 2.0 Flash recommended)

## 5. Future Roadmap
*   **v3.1**: Vector Database integration for semantic search.
*   **v3.2**: Voice Interface (STT/TTS) for hands-free operation.
*   **v3.3**: IDE Extensions (VS Code, JetBrains).
