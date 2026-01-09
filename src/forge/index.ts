import { startRepl, runOneShot } from './cli/repl.js';

// 메인 실행 함수
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    await runOneShot(args.join(' '));
  } else {
    await startRepl();
  }
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { startRepl, runOneShot };
