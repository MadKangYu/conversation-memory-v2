-- Conversation Memory V3 Supabase Schema
-- 이 스크립트를 Supabase SQL Editor에서 실행하여 테이블을 생성하세요.

-- 1. pgvector 확장 활성화 (벡터 검색용)
create extension if not exists vector;

-- 2. 프로젝트 테이블 (기기 간 공유되는 작업 공간)
create table if not exists public.projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  path text not null, -- 로컬 경로 식별자 (예: /Users/me/projects/my-app)
  name text,          -- 프로젝트 이름 (선택)
  created_at timestamptz default now(),
  last_synced_at timestamptz default now(),
  
  -- 한 사용자가 같은 경로를 중복해서 가질 수 없음
  unique(user_id, path)
);

-- 3. 대화 로그 테이블 (벡터 임베딩 포함)
create table if not exists public.conversation_logs (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  timestamp bigint not null, -- 로컬 타임스탬프 (밀리초)
  git_branch text default 'main',
  
  -- OpenAI text-embedding-3-small (1536차원) 기준
  embedding vector(1536),
  
  created_at timestamptz default now()
);

-- 4. 메모리 상태 테이블 (요약 정보)
create table if not exists public.memory_state (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  git_branch text not null,
  summary text default '',
  key_facts jsonb default '[]'::jsonb,
  last_updated bigint, -- 로컬 타임스탬프
  
  created_at timestamptz default now(),
  
  -- 프로젝트+브랜치 조합은 유니크해야 함
  unique(project_id, git_branch)
);

-- 5. RLS (Row Level Security) 정책 설정
-- 사용자는 자신의 데이터만 볼 수 있어야 함

alter table public.projects enable row level security;
alter table public.conversation_logs enable row level security;
alter table public.memory_state enable row level security;

-- Projects 정책
create policy "Users can view their own projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Users can insert their own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own projects"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "Users can delete their own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- Conversation Logs 정책 (프로젝트 소유권 기반)
create policy "Users can view logs of their projects"
  on public.conversation_logs for select
  using (exists (
    select 1 from public.projects
    where projects.id = conversation_logs.project_id
    and projects.user_id = auth.uid()
  ));

create policy "Users can insert logs to their projects"
  on public.conversation_logs for insert
  with check (exists (
    select 1 from public.projects
    where projects.id = conversation_logs.project_id
    and projects.user_id = auth.uid()
  ));

-- Memory State 정책 (프로젝트 소유권 기반)
create policy "Users can view state of their projects"
  on public.memory_state for select
  using (exists (
    select 1 from public.projects
    where projects.id = memory_state.project_id
    and projects.user_id = auth.uid()
  ));

create policy "Users can insert state to their projects"
  on public.memory_state for insert
  with check (exists (
    select 1 from public.projects
    where projects.id = memory_state.project_id
    and projects.user_id = auth.uid()
  ));

create policy "Users can update state of their projects"
  on public.memory_state for update
  using (exists (
    select 1 from public.projects
    where projects.id = memory_state.project_id
    and projects.user_id = auth.uid()
  ));

-- 6. 벡터 검색 함수 (RPC)
-- 클라이언트에서 supabase.rpc('match_documents', { ... }) 로 호출
create or replace function match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
returns table (
  id uuid,
  content text,
  similarity float,
  project_path text,
  git_branch text
)
language plpgsql
as $$
begin
  return query
  select
    cl.id,
    cl.content,
    1 - (cl.embedding <=> query_embedding) as similarity,
    p.path as project_path,
    cl.git_branch
  from public.conversation_logs cl
  join public.projects p on cl.project_id = p.id
  where 1 - (cl.embedding <=> query_embedding) > match_threshold
  and p.user_id = p_user_id
  order by cl.embedding <=> query_embedding
  limit match_count;
end;
$$;
