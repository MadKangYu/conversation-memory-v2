# Product Overview Document (POD): The Forge

## 1. Vision & Mission
**"Your AI's Second Brain"**
The Forge는 개발자의 인지 부하를 제거하고 생산성을 극대화하는 **자율 코딩 에이전트(Autonomous Coding Agent)**입니다. 우리는 API 비용의 장벽을 허물고, 로컬 환경에서 안전하게 동작하며, 프로젝트의 모든 맥락을 기억하는 "두 번째 뇌"를 제공합니다.

## 2. Problem Statement
기존 AI 코딩 도구(Claude Code, Cursor 등)는 강력하지만 다음과 같은 한계가 있습니다:
1.  **높은 비용**: 토큰당 과금되는 API 비용이 부담스럽습니다.
2.  **기억 상실 (Amnesia)**: 세션이 끝나면 문맥이 사라져 매번 다시 설명해야 합니다.
3.  **제한된 컨텍스트**: 프로젝트 전체를 이해하지 못하고 파일 단위로만 작업합니다.
4.  **데이터 프라이버시**: 클라우드로 전송되는 코드에 대한 보안 우려가 있습니다.

## 3. Solution: The Forge
The Forge는 이러한 문제를 해결하기 위해 설계되었습니다:
*   **Free & Powerful**: Gemini 2.0 Flash (1M Context)를 사용하여 무료로 강력한 성능을 제공합니다.
*   **Infinite Memory**: `.forge` 시스템을 통해 대화, 결정, 코드 변경 사항을 영구적으로 기억합니다.
*   **Local First**: 모든 데이터는 로컬에 저장되며, 사용자의 허락 없이는 외부로 전송되지 않습니다.
*   **Autonomous**: 단순한 자동 완성이 아니라, 계획을 수립하고 도구를 사용하여 스스로 작업을 완수합니다.

## 4. Target Audience
*   **Indie Hackers**: 비용 효율적으로 빠르게 MVP를 개발해야 하는 1인 개발자.
*   **Open Source Maintainers**: 방대한 코드베이스를 관리하고 이슈를 처리해야 하는 메인테이너.
*   **Students & Learners**: AI와 함께 코딩을 배우고 싶은 학생.

## 5. Key Value Propositions
| Feature | Benefit |
| :--- | :--- |
| **1M Context Window** | RAG 없이도 프로젝트 전체를 이해하고 수정할 수 있습니다. |
| **Grok Web Automation** | API 키 없이도 Grok의 추론 능력을 활용할 수 있습니다. |
| **The Garden (Memory)** | 사용자의 코딩 스타일과 선호도를 학습하여 맞춤형 지원을 제공합니다. |
| **Hidden System (.forge)** | 프로젝트 디렉토리를 오염시키지 않고 깔끔하게 관리됩니다. |

## 6. Success Metrics
*   **Active Users**: 주간 활성 사용자(WAU) 수.
*   **Task Completion Rate**: 에이전트가 도움 없이 작업을 완수한 비율.
*   **Retention**: 첫 사용 후 30일 이내 재사용 비율.
