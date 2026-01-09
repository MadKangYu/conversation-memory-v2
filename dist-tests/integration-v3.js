/**
 * Integration Test Suite for V3 Cloud Edition
 *
 * "Code is truth." - Andrej Karpathy
 *
 * We verify:
 * 1. ConfigManager encryption/decryption
 * 2. SQLiteProvider local persistence
 * 3. SupabaseProvider sync logic (with Mock)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../src/core/config-manager';
import { SQLiteProvider } from '../src/core/storage/sqlite-provider';
import { SupabaseProvider } from '../src/core/storage/supabase-provider';
// --- Mock Setup ---
const TEST_DIR = path.join(os.tmpdir(), 'memory-v3-test-' + Date.now());
const DB_PATH = path.join(TEST_DIR, 'test.db');
const CONFIG_DIR = path.join(os.homedir(), '.memory-factory'); // Use real config dir for ConfigManager test (careful!)
// Actually, let's mock ConfigManager's path internally or just test the logic.
// Since ConfigManager uses hardcoded paths, we will test encryption logic by instantiating it 
// and checking the file it writes (if we can). 
// For safety, let's focus on the logic we can control.
// Mock Supabase Client
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockSelect = jest.fn().mockResolvedValue({ data: { id: 'mock-project-id' }, error: null });
// We need to hijack the createClient in SupabaseProvider.
// Since we can't easily mock imports in this simple script without Jest runner,
// we will use a "TestableSupabaseProvider" subclass that injects our mock.
class TestableSupabaseProvider extends SupabaseProvider {
    constructor(local, url, key) {
        super(local, url, key);
        // Inject Mock
        this.supabase = {
            from: (table) => ({
                select: () => ({
                    eq: () => ({
                        single: mockSelect
                    })
                }),
                insert: mockInsert,
                upsert: () => ({ error: null })
            })
        };
    }
}
// --- Test Runner ---
async function runTests() {
    console.log('🚀 Starting V3 Integration Tests...\n');
    if (!fs.existsSync(TEST_DIR))
        fs.mkdirSync(TEST_DIR, { recursive: true });
    try {
        await testSecurity();
        await testLocalPersistence();
        await testCloudSync();
        console.log('\n✨ All Tests Passed! The system is ready.');
    }
    catch (e) {
        console.error('\n❌ Test Failed:', e);
        process.exit(1);
    }
    finally {
        // Cleanup
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
}
// --- Test Cases ---
async function testSecurity() {
    console.log('[Test 1] Security & Encryption');
    const manager = new ConfigManager();
    const secretKey = 'sk-test-12345-very-secret';
    // 1. Save Config
    await manager.setConfig('supabaseKey', secretKey);
    // 2. Check File on Disk (Should be encrypted)
    const configPath = path.join(os.homedir(), '.memory-factory', 'config.json');
    const rawContent = fs.readFileSync(configPath, 'utf-8');
    const json = JSON.parse(rawContent);
    if (json.supabaseKey === secretKey) {
        throw new Error('Security Breach: API Key saved in plain text!');
    }
    console.log('  ✅ API Key is encrypted on disk.');
    // 3. Load Config (Should be decrypted)
    const loaded = new ConfigManager().getConfig();
    if (loaded.supabaseKey !== secretKey) {
        throw new Error('Decryption Failed: Key mismatch.');
    }
    console.log('  ✅ API Key decrypted correctly in memory.');
}
async function testLocalPersistence() {
    console.log('\n[Test 2] Local Persistence (SQLite)');
    const sqlite = new SQLiteProvider(DB_PATH);
    await sqlite.init();
    const log = {
        role: 'user',
        content: 'Hello, local world!',
        timestamp: Date.now(),
        project_path: '/test/project',
        git_branch: 'main'
    };
    await sqlite.addLog(log);
    const recent = await sqlite.getRecentLogs('/test/project', 'main', 10);
    if (recent.length !== 1 || recent[0].content !== log.content) {
        throw new Error('SQLite persistence failed.');
    }
    console.log('  ✅ Data saved and retrieved from SQLite.');
}
async function testCloudSync() {
    console.log('\n[Test 3] Cloud Sync (Hybrid)');
    const sqlite = new SQLiteProvider(DB_PATH); // Re-use DB
    await sqlite.init();
    const provider = new TestableSupabaseProvider(sqlite, 'https://mock.supabase.co', 'mock-key');
    await provider.init();
    const log = {
        role: 'assistant',
        content: 'Syncing to the cloud...',
        timestamp: Date.now(),
        project_path: '/test/project',
        git_branch: 'main'
    };
    // Add Log -> Should trigger sync
    await provider.addLog(log);
    // Wait a bit for async queue
    await new Promise(r => setTimeout(r, 500));
    // Check Mock Calls
    if (mockInsert.mock.calls.length === 0) {
        throw new Error('Sync failed: Supabase insert not called.');
    }
    const insertedData = mockInsert.mock.calls[0][0]; // First arg of first call
    if (insertedData[0].content !== log.content) {
        throw new Error('Sync mismatch: Content differs.');
    }
    console.log('  ✅ Data pushed to Supabase sync queue.');
    console.log('  ✅ Mock insert called with correct data.');
}
// --- Mock Jest ---
const jest = {
    fn: () => {
        const mock = (...args) => {
            mock.mock.calls.push(args);
            return mock.mock.returnValue;
        };
        mock.mock = { calls: [], returnValue: undefined };
        mock.mockResolvedValue = (val) => {
            mock.mock.returnValue = Promise.resolve(val);
            return mock;
        };
        return mock;
    }
};
// Run
runTests();
