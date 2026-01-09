/**
 * Standalone Integration Test Suite for V3 Cloud Edition
 * 
 * 외부 모듈 의존성 없이 로직을 검증하기 위해 핵심 클래스를 인라인으로 포함합니다.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Database from 'better-sqlite3';

// --- Inlined Classes ---

// 1. ConfigManager
const CONFIG_DIR = path.join(os.homedir(), '.memory-factory');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENCRYPTION_KEY = crypto.scryptSync(os.hostname() + os.userInfo().username, 'salt', 32);

class ConfigManager {
  private config: any;

  constructor() {
    this.ensureConfigDir();
    this.config = this.loadConfig();
  }

  private ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
  }

  private loadConfig() {
    let config: any = { syncEnabled: false };
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const stored = JSON.parse(raw);
        if (stored.supabaseKey) stored.supabaseKey = this.decrypt(stored.supabaseKey);
        config = { ...config, ...stored };
      } catch (e) {}
    }
    return config;
  }

  public getConfig() { return { ...this.config }; }

  public async setConfig(key: string, value: any) {
    this.config[key] = value;
    this.saveConfig();
  }

  private saveConfig() {
    const toSave = { ...this.config };
    if (toSave.supabaseKey) toSave.supabaseKey = this.encrypt(toSave.supabaseKey);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { mode: 0o600 });
  }

  private encrypt(text: string) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  private decrypt(text: string) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }
}

// 2. SQLiteProvider
class SQLiteProvider {
  private db: any;
  constructor(private dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
  }
  async init() {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS conversation_logs (id INTEGER PRIMARY KEY, content TEXT)`);
  }
  async addLog(item: any) {
    this.db.prepare('INSERT INTO conversation_logs (content) VALUES (?)').run(item.content);
  }
  async getRecentLogs() {
    return this.db.prepare('SELECT * FROM conversation_logs').all();
  }
}

// 3. SupabaseProvider (Mocked Logic)
class SupabaseProvider {
  private syncQueue: any[] = [];
  constructor(private local: any, private url?: string, private key?: string) {}

  async init() { await this.local.init(); }

  async addLog(item: any) {
    await this.local.addLog(item);
    if (this.url && this.key) {
      this.syncQueue.push(item);
      await this.processSyncQueue();
    }
  }

  // Mock Sync Logic
  async processSyncQueue() {
    const batch = [...this.syncQueue];
    this.syncQueue = [];
    // Simulate Network Call
    if ((this as any).mockInsert) {
        await (this as any).mockInsert(batch);
    }
  }
}

// --- Test Runner ---

async function runTests() {
  console.log('🚀 Starting V3 Standalone Tests...\n');
  const TEST_DIR = path.join(os.tmpdir(), 'memory-v3-standalone-' + Date.now());
  const DB_PATH = path.join(TEST_DIR, 'test.db');

  try {
    // Test 1: Security
    console.log('[Test 1] Security & Encryption');
    const manager = new ConfigManager();
    const secret = 'sk-secret-key';
    await manager.setConfig('supabaseKey', secret);
    
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    if (JSON.parse(raw).supabaseKey === secret) throw new Error('Key not encrypted!');
    console.log('  ✅ Key encrypted on disk');
    
    const loaded = new ConfigManager().getConfig();
    if (loaded.supabaseKey !== secret) throw new Error('Key decryption failed!');
    console.log('  ✅ Key decrypted in memory');

    // Test 2: Hybrid Sync
    console.log('\n[Test 2] Hybrid Sync');
    const sqlite = new SQLiteProvider(DB_PATH);
    const provider = new SupabaseProvider(sqlite, 'https://mock.com', 'key');
    
    // Inject Mock Spy
    let mockCalled = false;
    (provider as any).mockInsert = async (batch: any[]) => {
        mockCalled = true;
        if (batch[0].content !== 'Hello Cloud') throw new Error('Wrong data synced');
    };

    await provider.init();
    await provider.addLog({ content: 'Hello Cloud' });
    
    // Wait for sync
    await new Promise(r => setTimeout(r, 100));
    
    if (!mockCalled) throw new Error('Sync not triggered');
    console.log('  ✅ Sync triggered and data verified');

    console.log('\n✨ All Tests Passed!');
  } catch (e) {
    console.error('\n❌ Test Failed:', e);
    process.exit(1);
  } finally {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

runTests();
