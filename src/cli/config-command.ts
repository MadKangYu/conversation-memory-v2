import { Command } from 'commander';
import { ConfigManager } from '../core/config-manager';
import inquirer from 'inquirer';

export function registerConfigCommand(program: Command) {
  const configManager = new ConfigManager();

  program
    .command('config')
    .description('Conversation Memory 설정 관리 (Supabase 연동 등)')
    .action(async () => {
      const currentConfig = configManager.getConfig();

      console.log('\n🔧 Conversation Memory 설정\n');

      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'syncEnabled',
          message: '클라우드 동기화(Supabase)를 활성화하시겠습니까?',
          default: currentConfig.syncEnabled
        },
        {
          type: 'input',
          name: 'supabaseUrl',
          message: 'Supabase Project URL:',
          default: currentConfig.supabaseUrl,
          when: (answers) => answers.syncEnabled,
          validate: (input) => input.startsWith('https://') ? true : 'URL은 https://로 시작해야 합니다.'
        },
        {
          type: 'password', // 비밀번호 타입으로 입력 (화면에 노출 안 됨)
          name: 'supabaseKey',
          message: 'Supabase Anon/Service Key:',
          default: currentConfig.supabaseKey, // 기존 키가 있어도 마스킹되어 표시됨
          when: (answers) => answers.syncEnabled,
          validate: (input) => input.length > 0 ? true : 'Key를 입력해주세요.'
        }
      ]);

      // 설정 저장
      await configManager.setConfig('syncEnabled', answers.syncEnabled);
      if (answers.syncEnabled) {
        await configManager.setConfig('supabaseUrl', answers.supabaseUrl);
        await configManager.setConfig('supabaseKey', answers.supabaseKey);
        console.log('\n✅ 설정이 안전하게 저장되었습니다. (Key는 암호화됨)');
      } else {
        console.log('\n✅ 동기화가 비활성화되었습니다.');
      }

      console.log('\n💡 변경 사항을 적용하려면 데몬을 재시작해주세요:');
      console.log('   memory-factory restart');
    });
}
