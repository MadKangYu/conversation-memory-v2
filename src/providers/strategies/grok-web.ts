import { BaseStrategy } from './base.js';
import { LLMMessage, LLMResponse, LLMProviderConfig } from '../llm-provider.js';
import * as puppeteer from 'puppeteer-core';
import * as chromeLauncher from 'chrome-launcher';
import fs from 'fs';
import path from 'path';
import os from 'os';

export class GrokWebStrategy extends BaseStrategy {
  id = 'grok-web';
  
  isSupported(model: string): boolean {
    return model === 'grok/web-auto';
  }

  async complete(messages: LLMMessage[], config: LLMProviderConfig): Promise<LLMResponse> {
    const lastMessage = messages[messages.length - 1];
    let prompt = '';
    
    if (typeof lastMessage.content === 'string') {
      prompt = lastMessage.content;
    } else {
      prompt = lastMessage.content.map(p => p.text || '').join('\n');
    }
    
    console.log('🌐 Launching Chrome for Grok Web Automation...');
    
    // 1. Chrome 실행 (또는 기존 Chrome 찾기)
    // 사용자의 프로필을 사용하여 로그인 상태를 유지함
    const chrome = await chromeLauncher.launch({
      startingUrl: 'https://grok.x.ai',
      chromeFlags: [
        '--disable-gpu',
        '--no-sandbox', // 샌드박스 환경용 (실제 로컬에서는 제거 가능)
        '--user-data-dir=' + path.join(os.homedir(), '.forge/chrome-profile') // 프로필 격리
      ]
    });

    try {
      // 2. Puppeteer 연결
      const browser = await puppeteer.connect({
        browserURL: `http://localhost:${chrome.port}`,
        defaultViewport: null
      });

      const pages = await browser.pages();
      const page = pages[0];

      // 3. Grok 페이지 로딩 대기
      console.log('Waiting for Grok to load...');
      await page.waitForSelector('textarea', { timeout: 60000 });

      // 4. 질문 입력
      console.log('Typing prompt...');
      await page.type('textarea', prompt);
      await page.keyboard.press('Enter');

      // 5. 답변 대기 (스트리밍이 끝날 때까지)
      // Grok의 UI 구조에 따라 선택자가 달라질 수 있음. 
      // 여기서는 일반적인 채팅 UI 구조를 가정하고, 답변이 더 이상 변하지 않을 때까지 기다리는 방식을 사용.
      console.log('Waiting for response...');
      
      // 답변 생성 완료 감지 로직 (간소화됨)
      await page.waitForFunction(
        // @ts-ignore
        () => !document.querySelector('button[aria-label="Stop generating"]'),
        { timeout: 120000 }
      );

      // 6. 마지막 답변 추출
      const response = await page.evaluate(() => {
        // @ts-ignore
        const messages = document.querySelectorAll('.prose');
        if (messages.length === 0) return '';
        // @ts-ignore
        return messages[messages.length - 1].textContent || '';
      });

      return {
        content: response,
        usage: { 
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0 
        },
        cost: 0
      };

    } catch (error) {
      console.error('Grok Web Automation Failed:', error);
      throw error;
    } finally {
      // 브라우저는 닫지 않고 유지할 수도 있음 (속도를 위해)
      // 여기서는 일단 닫음
      await chrome.kill();
    }
  }
}
