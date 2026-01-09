import { Command } from 'commander';
import inquirer from 'inquirer';
import { ConfigManager } from '../core/config-manager.js';

// 추천 모델 목록 (검증된 모델들)
const RECOMMENDED_MODELS = [
  {
    name: 'Google Gemini 2.0 Flash (Free & Fast) 🌟',
    value: 'google/gemini-2.0-flash-exp:free',
    description: '무료, 매우 빠름, 100만 토큰 컨텍스트. 가성비 최강.'
  },
  {
    name: 'Google Gemini 2.0 Flash (Stable)',
    value: 'google/gemini-2.0-flash-001',
    description: '안정적인 유료 버전 (저렴함).'
  },
  {
    name: 'Anthropic Claude 3.5 Haiku',
    value: 'anthropic/claude-3-5-haiku',
    description: '빠르고 똑똑함. 코딩 능력 우수.'
  },
  {
    name: 'OpenAI GPT-4o Mini',
    value: 'openai/gpt-4o-mini',
    description: '균형 잡힌 성능과 가격.'
  },
  {
    name: 'OpenAI GPT-4o (High Performance)',
    value: 'openai/gpt-4o',
    description: '최고 성능, 비쌈. 중요한 요약에 추천.'
  }
];

export function registerModelCommand(program: Command) {
  const modelCmd = program.command('model')
    .description('요약 및 압축에 사용할 AI 모델 관리');

  modelCmd.command('list')
    .description('사용 가능한 추천 모델 목록 보기')
    .action(async () => {
      const configManager = new ConfigManager();
      const currentModel = configManager.getConfig().model || 'google/gemini-2.0-flash-exp:free';

      console.log('\n🤖 추천 AI 모델 목록:\n');
      RECOMMENDED_MODELS.forEach(m => {
        const isCurrent = m.value === currentModel;
        console.log(`  ${isCurrent ? '✅' : '  '} ${m.name}`);
        console.log(`     ID: ${m.value}`);
        console.log(`     Desc: ${m.description}\n`);
      });
      console.log(`현재 설정된 모델: ${currentModel}\n`);
    });

  modelCmd.command('set [modelId]')
    .description('사용할 모델 변경 (ID 직접 입력 또는 선택)')
    .action(async (modelId) => {
      const configManager = new ConfigManager();

      if (modelId) {
        // 직접 입력한 경우
        await configManager.setConfig('model', modelId);
        console.log(`\n✅ 모델이 변경되었습니다: ${modelId}`);
      } else {
        // 선택 메뉴 표시
        const answers = await inquirer.prompt([
          {
            type: 'list',
            name: 'model',
            message: '사용할 모델을 선택하세요:',
            choices: RECOMMENDED_MODELS,
            default: configManager.getConfig().model
          }
        ]);

        await configManager.setConfig('model', answers.model);
        console.log(`\n✅ 모델이 변경되었습니다: ${answers.model}`);
      }
    });
}
