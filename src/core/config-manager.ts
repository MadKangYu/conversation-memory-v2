import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/**
 * Config Manager
 * 
 * 설정을 안전하게 관리하는 클래스입니다.
 * 민감한 정보(API Key 등)는 암호화하여 저장하거나 환경 변수에서 읽어옵니다.
 * 
 * 보안 전략:
 * 1. 환경 변수 우선 (MEMORY_FACTORY_*)
 * 2. 암호화된 로컬 파일 (~/.memory-factory/config.enc)
 * 3. 파일 권한 600 강제
 */

const CONFIG_DIR = path.join(os.homedir(), '.memory-factory');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
// 암호화 키는 기기 고유의 정보를 기반으로 생성하거나, 
// 실제 프로덕션에서는 OS Keychain을 써야 하지만, 
// 여기서는 파일 시스템 기반의 경량 암호화를 적용 (Machine ID 기반)
const ENCRYPTION_KEY = crypto.scryptSync(os.hostname() + os.userInfo().username, 'salt', 32);

export interface AppConfig {
  supabaseUrl?: string;
  supabaseKey?: string; // Encrypted in memory? No, decrypted when loaded.
  syncEnabled: boolean;
}

export class ConfigManager {
  private config: AppConfig;

  constructor() {
    this.ensureConfigDir();
    this.config = this.loadConfig();
  }

  private ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 }); // rwx------
    }
  }

  private loadConfig(): AppConfig {
    // 1. 기본값
    let config: AppConfig = {
      syncEnabled: false
    };

    // 2. 파일 로드
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const stored = JSON.parse(raw);
        
        // 복호화 필요한 필드 처리
        if (stored.supabaseKey) {
          stored.supabaseKey = this.decrypt(stored.supabaseKey);
        }
        
        config = { ...config, ...stored };
      } catch (e) {
        console.error('[ConfigManager] 설정 파일 로드 실패:', e);
      }
    }

    // 3. 환경 변수 오버라이드 (최우선)
    if (process.env.MEMORY_FACTORY_SUPABASE_URL) {
      config.supabaseUrl = process.env.MEMORY_FACTORY_SUPABASE_URL;
    }
    if (process.env.MEMORY_FACTORY_SUPABASE_KEY) {
      config.supabaseKey = process.env.MEMORY_FACTORY_SUPABASE_KEY;
    }
    if (process.env.MEMORY_FACTORY_SYNC_ENABLED) {
      config.syncEnabled = process.env.MEMORY_FACTORY_SYNC_ENABLED === 'true';
    }

    return config;
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public async setConfig(key: keyof AppConfig, value: any): Promise<void> {
    (this.config as any)[key] = value;
    this.saveConfig();
  }

  private saveConfig() {
    const toSave = { ...this.config };
    
    // 암호화 필요한 필드 처리
    if (toSave.supabaseKey) {
      toSave.supabaseKey = this.encrypt(toSave.supabaseKey);
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), { mode: 0o600 }); // rw-------
  }

  // AES-256-CBC 암호화
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  // AES-256-CBC 복호화
  private decrypt(text: string): string {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }
}
