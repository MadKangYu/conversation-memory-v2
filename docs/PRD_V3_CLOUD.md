# Conversation Memory V3: Cloud Edition - 제품 요구사항 정의서 (PRD)

---

**문서 버전**: 3.0
**작성일**: 2026년 1월 9일
**작성자**: Manus AI

---

## 1. 개요 (Introduction)

**Conversation Memory V3: Cloud Edition**은 로컬 중심의 V2 시스템을 클라우드 기반의 하이브리드 아키텍처로 확장한 버전입니다. Supabase와의 통합을 통해 기기 간 실시간 동기화, 벡터 기반의 시맨틱 검색(Semantic Search), 그리고 웹 대시보드를 통한 시각적 관리 기능을 제공합니다.

이는 단순한 "저장소 확장"이 아니라, 사용자의 모든 AI 상호작용 데이터를 중앙화하여 **"언제 어디서나 이어지는(Ubiquitous) AI 경험"**을 제공하는 것을 목표로 합니다.

## 2. 문제 정의 (Problem Statement)

V2 시스템은 로컬 환경에서의 자동화된 메모리 관리를 성공적으로 구현했으나, 다음과 같은 한계가 존재합니다.

- **기기 간 단절 (Device Silos)**: 회사 컴퓨터의 기억이 집 컴퓨터와 공유되지 않아, 장소를 옮길 때마다 맥락이 끊깁니다.
- **검색의 한계 (Search Limitations)**: 단순 키워드 매칭이나 최근 대화 요약만으로는 "작년 5월에 짰던 결제 로직"과 같은 구체적이고 오래된 기억을 찾아내기 어렵습니다.
- **가시성 부족 (Lack of Visibility)**: CLI 대시보드는 개발자 친화적이지만, 일반 사용자가 자신의 기억 상태를 직관적으로 파악하고 관리하기에는 부족합니다.

## 3. 비전 및 목표 (Vision & Goals)

### 3.1. 비전

> "내 모든 AI 대화와 지식이 클라우드에서 하나로 연결되어, 언제 어디서나 나보다 나를 더 잘 기억하는 AI 파트너를 만난다."

### 3.2. 목표

- **Seamless Sync**: 기기 간 대화 및 기억 상태를 1초 이내에 동기화합니다.
- **Infinite Recall**: `pgvector`를 활용한 임베딩 검색으로 수년 전의 대화 내용도 정확하게 찾아냅니다.
- **Visual Management**: 웹 대시보드를 통해 기억을 검색, 수정, 삭제하고 인사이트를 얻을 수 있는 UI를 제공합니다.
- **Offline-First**: 인터넷 연결이 끊겨도 로컬에서 완벽하게 동작하며, 연결 시 자동으로 동기화됩니다.

## 4. 핵심 기능 (Core Features)

### 4.1. 클라우드 동기화 (Cloud Sync)

- **기능**: 로컬 SQLite의 변경 사항을 Supabase PostgreSQL과 양방향 동기화합니다.
- **기술**:
  - **Supabase Realtime**: 변경 사항을 실시간으로 구독하여 즉시 반영합니다.
  - **Conflict Resolution**: 'Last Write Wins' 정책을 기본으로 하되, 병합 가능한 텍스트는 자동 병합합니다.
  - **Auth**: Supabase Auth를 사용하여 기기 간 안전한 사용자 인증을 제공합니다.

### 4.2. 벡터 메모리 (Vector Memory)

- **기능**: 대화 내용을 임베딩(Embedding)하여 의미 기반 검색을 지원합니다.
- **기술**:
  - **OpenAI Embeddings API**: 텍스트를 고차원 벡터로 변환합니다.
  - **pgvector**: Supabase 내에서 벡터 유사도 검색을 수행합니다.
  - **Hybrid Search**: 키워드 검색(Full-text Search)과 벡터 검색(Semantic Search)을 결합하여 정확도를 높입니다.

### 4.3. 웹 대시보드 (Web Dashboard)

- **기능**: 사용자가 자신의 기억을 관리할 수 있는 웹 인터페이스를 제공합니다.
- **구성**:
  - **Timeline View**: 시간순으로 정리된 대화 히스토리.
  - **Memory Graph**: 프로젝트 및 주제별 연관 관계를 시각화한 지식 그래프.
  - **Search Bar**: 자연어로 과거 기억을 검색하는 기능.
  - **Settings**: 동기화 주기, 프라이버시 설정 등 관리.

### 4.4. 오프라인 퍼스트 (Offline-First)

- **기능**: 네트워크 상태와 무관하게 항상 사용 가능한 경험을 제공합니다.
- **기술**:
  - 모든 읽기/쓰기는 로컬 SQLite에서 먼저 수행됩니다.
  - 백그라운드 동기화 큐(Sync Queue)가 네트워크 연결 시 변경 사항을 일괄 업로드합니다.

## 5. 기술 아키텍처 (Technical Architecture)

### 5.1. 데이터베이스 구조

| 계층 | 기술 | 역할 |
| :--- | :--- | :--- |
| **Local** | SQLite (WAL Mode) | 빠른 읽기/쓰기, 오프라인 지원, 캐싱 |
| **Cloud** | Supabase (PostgreSQL) | 중앙 저장소, 벡터 검색, 멀티 디바이스 동기화 |

### 5.2. 스키마 설계 (Supabase)

```sql
-- 사용자 테이블 (Supabase Auth 연동)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  username TEXT,
  avatar_url TEXT
);

-- 프로젝트 테이블
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  path TEXT NOT NULL,
  name TEXT,
  last_synced_at TIMESTAMPTZ
);

-- 대화 로그 테이블 (벡터 포함)
CREATE TABLE conversation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),  -- OpenAI Embedding Dimension
  timestamp TIMESTAMPTZ DEFAULT now(),
  git_branch TEXT
);

-- 메모리 상태 테이블
CREATE TABLE memory_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id),
  git_branch TEXT,
  summary TEXT,
  key_facts JSONB
);
```

## 6. 로드맵 (Roadmap)

1.  **Phase 1: Foundation** (현재)
    - Supabase 프로젝트 설정 및 스키마 배포
    - `StorageProvider` 인터페이스 구현 (SQLite/Supabase 추상화)

2.  **Phase 2: Sync Engine**
    - 로컬 -> 클라우드 단방향 동기화 구현
    - 클라우드 -> 로컬 양방향 동기화 및 충돌 처리

3.  **Phase 3: Vector Intelligence**
    - 임베딩 생성 파이프라인 구축
    - 시맨틱 검색 API 구현 및 Hook 연동

4.  **Phase 4: Web Experience**
    - React 기반 웹 대시보드 개발
    - 실시간 데이터 연동 및 시각화

## 7. 성공 지표 (Success Metrics)

- **동기화 지연 시간**: < 2초 (네트워크 양호 시)
- **검색 정확도 (Recall@5)**: > 85% (사용자 평가 기준)
- **오프라인 동작 성공률**: 100% (데이터 유실 없음)
