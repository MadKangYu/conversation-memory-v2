# Product Overview Document (POD): The Forge

## 1. Product Vision
**"Your AI's Second Brain: Autonomous, Persistent, and Local."**

The Forge is an autonomous coding agent designed to operate locally, providing developers with a powerful, persistent "second brain" that remembers context across sessions. Unlike cloud-based LLMs that suffer from amnesia, The Forge retains project history, decisions, and user preferences, enabling it to act as a true long-term collaborator.

## 2. Core Value Proposition
*   **Zero Amnesia**: The "Garden" memory system ensures that no context is lost. Every interaction contributes to a growing knowledge base.
*   **Local Execution**: Runs entirely on the user's machine (or private server), ensuring data privacy and zero latency for file operations.
*   **Hextech Identity**: A unique, immersive CLI and web interface inspired by "Hextech" aesthetics, blending magic (AI) with technology (Code).
*   **Autonomous Loop**: A robust ReAct (Reasoning + Acting) loop that allows the agent to think, plan, and execute complex tasks without constant supervision.

## 3. Target Audience
*   **Solo Developers**: Who need an intelligent pair programmer that remembers their coding style and project architecture.
*   **Privacy-Conscious Teams**: Who cannot send sensitive code to public cloud LLM endpoints.
*   **AI Enthusiasts**: Who want to experiment with local agentic workflows and memory systems.

## 4. Key Features
| Feature | Description | Status |
| :--- | :--- | :--- |
| **The Garden** | SQLite-based persistent memory with RAG capabilities. | ✅ Implemented |
| **Hextech CLI** | Immersive terminal interface with ASCII art and neon styling. | ✅ Implemented |
| **Agent Core** | ReAct loop powered by Gemini 2.0 Flash (via OpenRouter). | ✅ Implemented |
| **Web Dashboard** | Landing page with interactive tutorials and documentation. | ✅ Implemented |
| **Knowledge Graph** | (Future) Visual representation of project relationships. | 🚧 Planned |

## 5. Design Philosophy
*   **"Crafted, Not Built"**: Every interaction should feel polished and intentional.
*   **Transparency**: The agent's thought process (Thinking -> Acting) must always be visible to the user.
*   **Efficiency**: Memory retrieval and tool execution must be optimized for speed.

## 6. Success Metrics
*   **Retention**: Users returning to the same session after 24+ hours.
*   **Task Completion Rate**: Percentage of complex multi-step tasks successfully resolved without user intervention.
*   **Memory Accuracy**: Relevance of retrieved context in RAG responses.
