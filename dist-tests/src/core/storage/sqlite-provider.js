import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
export class SQLiteProvider {
    db;
    dbPath;
    constructor(dbPath) {
        this.dbPath = dbPath;
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(dbPath);
    }
    async init() {
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        project_path TEXT DEFAULT 'global',
        git_branch TEXT DEFAULT 'main',
        is_compressed BOOLEAN DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_project_branch ON conversation_logs(project_path, git_branch);

      CREATE TABLE IF NOT EXISTS memory_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        git_branch TEXT NOT NULL,
        summary TEXT DEFAULT '',
        key_facts TEXT DEFAULT '[]',
        last_updated INTEGER,
        UNIQUE(project_path, git_branch)
      );
    `);
    }
    async addLog(item) {
        const stmt = this.db.prepare('INSERT INTO conversation_logs (role, content, timestamp, project_path, git_branch) VALUES (?, ?, ?, ?, ?)');
        stmt.run(item.role, item.content, item.timestamp, item.project_path, item.git_branch);
    }
    async getRecentLogs(projectPath, gitBranch, limit) {
        const rows = this.db.prepare('SELECT id, role, content, timestamp, project_path, git_branch FROM conversation_logs WHERE project_path = ? AND git_branch = ? ORDER BY id DESC LIMIT ?').all(projectPath, gitBranch, limit);
        return rows.reverse().map(row => ({
            id: row.id,
            role: row.role,
            content: row.content,
            timestamp: row.timestamp,
            project_path: row.project_path,
            git_branch: row.git_branch
        }));
    }
    async getUncompressedLogs(projectPath, gitBranch) {
        const rows = this.db.prepare('SELECT id, role, content, timestamp, project_path, git_branch FROM conversation_logs WHERE is_compressed = 0 AND project_path = ? AND git_branch = ?').all(projectPath, gitBranch);
        return rows.map(row => ({
            id: row.id,
            role: row.role,
            content: row.content,
            timestamp: row.timestamp,
            project_path: row.project_path,
            git_branch: row.git_branch
        }));
    }
    async markLogsAsCompressed(ids) {
        const markCompressed = this.db.prepare('UPDATE conversation_logs SET is_compressed = 1 WHERE id = ?');
        const transaction = this.db.transaction(() => {
            for (const id of ids) {
                markCompressed.run(id);
            }
        });
        transaction();
    }
    async getMemoryState(projectPath, gitBranch) {
        const row = this.db.prepare('SELECT summary, key_facts, last_updated FROM memory_state WHERE project_path = ? AND git_branch = ?').get(projectPath, gitBranch);
        if (!row)
            return null;
        return {
            summary: row.summary,
            key_facts: JSON.parse(row.key_facts),
            last_updated: row.last_updated
        };
    }
    async updateMemoryState(projectPath, gitBranch, state) {
        const stmt = this.db.prepare(`
      INSERT INTO memory_state (project_path, git_branch, summary, key_facts, last_updated)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_path, git_branch) DO UPDATE SET
        summary = excluded.summary,
        key_facts = excluded.key_facts,
        last_updated = excluded.last_updated
    `);
        stmt.run(projectPath, gitBranch, state.summary, JSON.stringify(state.key_facts), state.last_updated);
    }
    async getUncompressedCount(projectPath, gitBranch) {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM conversation_logs WHERE is_compressed = 0 AND project_path = ? AND git_branch = ?').get(projectPath, gitBranch);
        return result.count;
    }
}
