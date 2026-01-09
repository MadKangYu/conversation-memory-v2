import { createClient } from '@supabase/supabase-js';
/**
 * Supabase Provider (Hybrid)
 *
 * 기본적으로 SQLiteProvider를 래핑하여 로컬 우선(Local-First)으로 동작합니다.
 * Supabase 설정이 유효한 경우, 백그라운드에서 데이터를 동기화합니다.
 */
export class SupabaseProvider {
    local;
    supabase = null;
    syncQueue = [];
    isSyncing = false;
    projectIdCache = {}; // path -> uuid
    constructor(localProvider, supabaseUrl, supabaseKey) {
        this.local = localProvider;
        if (supabaseUrl && supabaseKey) {
            this.supabase = createClient(supabaseUrl, supabaseKey, {
                auth: {
                    persistSession: false // 데몬 환경이므로 세션 유지 불필요
                }
            });
            console.log('[SupabaseProvider] Cloud Sync Enabled');
        }
    }
    async init() {
        await this.local.init();
        // 초기 동기화 시도 (비동기)
        if (this.supabase) {
            this.syncPendingData().catch(console.error);
        }
    }
    /**
     * 로컬에 먼저 저장하고, 큐에 추가하여 백그라운드 동기화
     */
    async addLog(item) {
        // 1. 로컬 저장 (Fast)
        await this.local.addLog(item);
        // 2. 클라우드 동기화 큐 추가 (Non-blocking)
        if (this.supabase) {
            this.syncQueue.push(item);
            this.processSyncQueue().catch(console.error);
        }
    }
    async getRecentLogs(projectPath, gitBranch, limit) {
        // 읽기는 항상 로컬에서 (Offline support & Speed)
        return this.local.getRecentLogs(projectPath, gitBranch, limit);
    }
    async getUncompressedLogs(projectPath, gitBranch) {
        return this.local.getUncompressedLogs(projectPath, gitBranch);
    }
    async markLogsAsCompressed(ids) {
        await this.local.markLogsAsCompressed(ids);
        // 압축 상태 동기화는 복잡하므로 일단 로컬만 처리 (추후 구현)
    }
    async getMemoryState(projectPath, gitBranch) {
        // 로컬 상태 반환
        const localState = await this.local.getMemoryState(projectPath, gitBranch);
        // 클라우드에 더 최신 상태가 있는지 확인 (선택적)
        // 성능을 위해 일단 로컬만 반환하고, 백그라운드에서 fetch하여 로컬 업데이트하는 전략 추천
        return localState;
    }
    async updateMemoryState(projectPath, gitBranch, state) {
        await this.local.updateMemoryState(projectPath, gitBranch, state);
        if (this.supabase) {
            this.syncMemoryState(projectPath, gitBranch, state).catch(console.error);
        }
    }
    async getUncompressedCount(projectPath, gitBranch) {
        return this.local.getUncompressedCount(projectPath, gitBranch);
    }
    // ==========================================================================
    // Private Sync Logic
    // ==========================================================================
    async processSyncQueue() {
        if (this.isSyncing || this.syncQueue.length === 0 || !this.supabase)
            return;
        this.isSyncing = true;
        try {
            const batch = [...this.syncQueue];
            this.syncQueue = []; // 큐 비우기
            // 프로젝트 ID 조회 또는 생성
            // 최적화를 위해 배치 내의 유니크한 프로젝트 경로만 처리
            const paths = [...new Set(batch.map(item => item.project_path))];
            for (const path of paths) {
                await this.ensureProjectExists(path);
            }
            // 로그 업로드
            const logsToInsert = batch.map(item => ({
                project_id: this.projectIdCache[item.project_path],
                role: item.role,
                content: item.content,
                timestamp: item.timestamp,
                git_branch: item.git_branch
                // embedding: 추후 벡터 생성 로직 추가
            }));
            const { error } = await this.supabase
                .from('conversation_logs')
                .insert(logsToInsert);
            if (error) {
                console.error('[SupabaseProvider] Sync failed:', error);
                // 실패 시 다시 큐에 넣기 (Retry)
                this.syncQueue.unshift(...batch);
            }
            else {
                console.log(`[SupabaseProvider] Synced ${batch.length} logs`);
            }
        }
        catch (e) {
            console.error('[SupabaseProvider] Sync error:', e);
        }
        finally {
            this.isSyncing = false;
            // 남은 아이템이 있으면 계속 처리
            if (this.syncQueue.length > 0) {
                this.processSyncQueue();
            }
        }
    }
    async syncMemoryState(projectPath, gitBranch, state) {
        if (!this.supabase)
            return;
        try {
            const projectId = await this.ensureProjectExists(projectPath);
            const { error } = await this.supabase
                .from('memory_state')
                .upsert({
                project_id: projectId,
                git_branch: gitBranch,
                summary: state.summary,
                key_facts: state.key_facts,
                last_updated: state.last_updated
            }, { onConflict: 'project_id, git_branch' });
            if (error) {
                console.error('[SupabaseProvider] State sync failed:', error);
            }
        }
        catch (e) {
            console.error('[SupabaseProvider] State sync error:', e);
        }
    }
    async ensureProjectExists(path) {
        if (this.projectIdCache[path])
            return this.projectIdCache[path];
        if (!this.supabase)
            throw new Error('Supabase client not initialized');
        // 1. 조회
        const { data } = await this.supabase
            .from('projects')
            .select('id')
            .eq('path', path)
            .single();
        if (data) {
            this.projectIdCache[path] = data.id;
            return data.id;
        }
        // 2. 없으면 생성
        // 주의: 실제로는 user_id가 필요하므로 Auth가 되어 있어야 함.
        // 데몬 환경에서는 Service Role Key를 쓰거나, 사용자가 로그인한 토큰을 저장해서 써야 함.
        // 여기서는 일단 익명/공용 프로젝트로 가정하거나, 추후 Auth 로직 보강 필요.
        // 임시로 user_id 없이 insert 시도 (RLS 정책에 따라 실패할 수 있음)
        // TODO: 사용자 인증 토큰 관리 로직 추가 필요
        // 현재는 스키마만 존재하고 실제 Auth 토큰이 없으므로 이 부분은 Mocking 또는 추후 구현
        return '00000000-0000-0000-0000-000000000000'; // Placeholder
    }
    async syncPendingData() {
        // 앱 시작 시 미전송 데이터 확인 로직 (SQLite에 'synced' 플래그 추가 필요)
        // 현재는 메모리 큐만 사용하므로 재시작 시 큐가 날아감.
        // V3 정식 버전에서는 SQLite에 sync_status 컬럼을 추가해야 함.
    }
}
