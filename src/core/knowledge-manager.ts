import fs from 'fs';
import path from 'path';
import { LLMProvider } from '../providers/llm-provider.js';
import { MemoryManager } from './memory-manager.js';

interface WikiPage {
  category: 'architecture' | 'features' | 'issues' | 'decisions' | 'general';
  topic: string; // 파일명으로 사용 (kebab-case)
  title: string; // 문서 제목
  content: string; // 문서 내용 (Markdown)
}

export class KnowledgeManager {
  private docsDir: string;
  private llm: LLMProvider;
  private memory: MemoryManager;

  constructor(projectRoot: string, llm: LLMProvider, memory: MemoryManager) {
    this.docsDir = path.join(projectRoot, 'docs');
    this.llm = llm;
    this.memory = memory;
  }

  /**
   * 최근 대화를 분석하여 위키 문서를 생성하거나 업데이트합니다.
   */
  async digestConversation(cwd: string): Promise<string> {
    // 1. 최근 대화 가져오기 (압축되지 않은 것들)
    const context = await this.memory.getContextAsync(cwd);
    const recentLogs = context.recent_history;

    if (recentLogs.length === 0) {
      return 'No recent conversation to digest.';
    }

    // 2. LLM에게 분석 요청
    const analysis = await this.analyzeConversation(recentLogs);
    
    if (!analysis) {
      return 'Failed to analyze conversation.';
    }

    // 3. 문서 생성 및 업데이트
    await this.updateWiki(analysis);

    // 4. 인덱스(README) 업데이트
    await this.updateIndex();

    return `Documentation updated: docs/${analysis.category}/${analysis.topic}.md`;
  }

  private async analyzeConversation(logs: any[]): Promise<WikiPage | null> {
    const conversationText = logs.map(l => `${l.role}: ${l.content}`).join('\n');
    
    const prompt = `
    Analyze the following conversation and extract a structured documentation entry.
    
    Categories:
    - architecture: System design, structure decisions
    - features: Feature specifications, ideas, requirements
    - issues: Bug reports, troubleshooting logs
    - decisions: Key architectural decisions (ADR)
    - general: General discussions

    Output JSON format:
    {
      "category": "one of the categories above",
      "topic": "kebab-case-filename-summary",
      "title": "Human Readable Title",
      "content": "Markdown content summarizing the discussion. Include key points, code snippets if relevant, and conclusions."
    }

    Conversation:
    ${conversationText}
    `;

    try {
      const response = await this.llm.complete([
        { role: 'user', content: prompt }
      ]);

      // JSON 파싱 (Markdown 코드 블록 제거)
      const jsonStr = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(jsonStr) as WikiPage;
    } catch (e) {
      console.error('Error analyzing conversation:', e);
      return null;
    }
  }

  private async updateWiki(page: WikiPage) {
    const categoryDir = path.join(this.docsDir, page.category);
    
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    const filePath = path.join(categoryDir, `${page.topic}.md`);
    let content = `# ${page.title}\n\n${page.content}`;

    // 기존 파일이 있으면 내용을 덧붙임 (Append 모드)
    // 단, 단순히 뒤에 붙이는 것보다 날짜별로 구분하는 것이 좋음
    if (fs.existsSync(filePath)) {
      const existingContent = fs.readFileSync(filePath, 'utf-8');
      const date = new Date().toISOString().split('T')[0];
      content = `${existingContent}\n\n## Update (${date})\n\n${page.content}`;
    }

    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * 사용자의 질문을 히스토리에 기록합니다.
   */
  async archiveQuery(query: string) {
    const historyDir = path.join(this.docsDir, 'history');
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const filePath = path.join(historyDir, 'queries.md');
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    
    let content = '';
    
    // 파일이 없으면 헤더 생성
    if (!fs.existsSync(filePath)) {
      content = '# 📜 User Query History\n\nThis file tracks all user queries to preserve project context and history.\n\n';
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
    }

    // 날짜 헤더가 없으면 추가 (하루 단위 그룹화)
    const dateHeader = `## ${dateStr}`;
    if (!content.includes(dateHeader)) {
      content += `\n${dateHeader}\n\n`;
    }

    // 쿼리 추가 (타임스탬프 포함)
    content += `- **[${timeStr}]** ${query}\n`;

    fs.writeFileSync(filePath, content, 'utf-8');
  }

  private async updateIndex() {
    if (!fs.existsSync(this.docsDir)) return;

    const categories = ['architecture', 'features', 'issues', 'decisions', 'general'];
    let indexContent = '# 🌳 Project Knowledge Garden\n\n';

    for (const category of categories) {
      const catDir = path.join(this.docsDir, category);
      if (fs.existsSync(catDir)) {
        indexContent += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;
        const files = fs.readdirSync(catDir).filter(f => f.endsWith('.md'));
        
        for (const file of files) {
          // 파일 첫 줄에서 제목 추출 시도
          const filePath = path.join(catDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n')[0].replace('# ', '');
          
          indexContent += `- [${firstLine}](${category}/${file})\n`;
        }
        indexContent += '\n';
      }
    }

    fs.writeFileSync(path.join(this.docsDir, 'README.md'), indexContent, 'utf-8');
  }
}
