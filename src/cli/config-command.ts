import { Command } from 'commander';
import { ConfigManager } from '../core/config-manager.js';
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
          when: (answers: any) => answers.syncEnabled,
          validate: (input: string) => input.startsWith('https://') ? true : 'URL은 https://로 시작해야 합니다.'
        },
        {
          type: 'password', // 비밀번호 타입으로 입력 (화면에 노출 안 됨)
          name: 'supabaseKey',
          message: 'Supabase Anon/Service Key:',
          default: currentConfig.supabaseKey, // 기존 키가 있어도 마스킹되어 표시됨
          when: (answers: any) => answers.syncEnabled,
          validate: (input: string) => input.length > 0 ? true : 'Key를 입력해주세요.'
        },
        {
          type: 'confirm',
          name: 'configureKeys',
          message: 'LLM API Key를 설정하시겠습니까? (OpenRouter, Google, OpenAI 등)',
          default: false
        },
        {
          type: 'password',
          name: 'openrouterKey',
          message: 'OpenRouter API Key (통합용):',
          default: currentConfig.apiKeys?.openrouter,
          when: (answers: any) => answers.configureKeys
        },
        {
          type: 'password',
          name: 'googleKey',
          message: 'Google Gemini API Key (Direct):',
          default: currentConfig.apiKeys?.google,
          when: (answers: any) => answers.configureKeys
        },
        {
          type: 'password',
          name: 'openaiKey',
          message: 'OpenAI API Key (Direct):',
          default: currentConfig.apiKeys?.openai,
          when: (answers: any) => answers.configureKeys
        },
        {
          type: 'password',
          name: 'anthropicKey',
          message: 'Anthropic API Key (Direct):',
          default: currentConfig.apiKeys?.anthropic,
          when: (answers: any) => answers.configureKeys
        },
        {
          type: 'password',
          name: 'xaiKey',
          message: 'xAI (Grok) API Key (Direct):',
          default: currentConfig.apiKeys?.xai,
          when: (answers: any) => answers.configureKeys
        }
      ]);

      // 설정 저장
      await configManager.setConfig('syncEnabled', answers.syncEnabled);
      if (answers.syncEnabled) {
        await configManager.setConfig('supabaseUrl', answers.supabaseUrl);
        await configManager.setConfig('supabaseKey', answers.supabaseKey);
      }

      if (answers.configureKeys) {
        const apiKeys = {
          openrouter: answers.openrouterKey || undefined,
          google: answers.googleKey || undefined,
          openai: answers.openaiKey || undefined,
          anthropic: answers.anthropicKey || undefined,
          xai: answers.xaiKey || undefined
        };
        await configManager.setConfig('apiKeys', apiKeys);
        console.log('\n✅ API Key가 안전하게 저장되었습니다. (암호화됨)');
      }

      if (answers.syncEnabled || answers.configureKeys) {
        console.log('\n✅ 설정이 완료되었습니다.');
      } else {
        console.log('\n✅ 동기화가 비활성화되었습니다.');
      }

      console.log('\n💡 변경 사항을 적용하려면 데몬을 재시작해주세요:');
      console.log('   memory-factory restart');
    });
}
