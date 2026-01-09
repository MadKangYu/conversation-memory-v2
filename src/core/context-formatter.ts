/**
 * The "Grok" Format: Claude-friendly XML Context Formatter
 * 
 * Claude 모델은 XML 태그로 구조화된 데이터를 가장 잘 이해합니다.
 * 단순 텍스트 나열보다 XML 구조가 할루시네이션을 줄이고 문맥 파악 속도를 높입니다.
 */

export interface CompressedMemory {
  id: number;
  timestamp: string;
  summary: string;
  keywords: string[];
  importance: number;
}

export class ContextFormatter {
  /**
   * 압축된 기억들을 Claude가 이해하기 쉬운 XML 포맷으로 변환합니다.
   */
  static format(memories: CompressedMemory[]): string {
    if (memories.length === 0) return '';

    const xmlParts = [
      '<long_term_memory>',
      '  <description>These are compressed summaries of previous conversations. Use them to maintain context.</description>',
      '  <memories>'
    ];

    for (const memory of memories) {
      xmlParts.push(`    <memory id="${memory.id}" importance="${memory.importance}">`);
      xmlParts.push(`      <timestamp>${memory.timestamp}</timestamp>`);
      xmlParts.push(`      <summary>${this.escapeXml(memory.summary)}</summary>`);
      if (memory.keywords && memory.keywords.length > 0) {
        xmlParts.push(`      <keywords>${memory.keywords.join(', ')}</keywords>`);
      }
      xmlParts.push('    </memory>');
    }

    xmlParts.push('  </memories>');
    xmlParts.push('</long_term_memory>');

    return xmlParts.join('\n');
  }

  /**
   * XML 특수 문자를 이스케이프 처리합니다.
   */
  private static escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }
}
