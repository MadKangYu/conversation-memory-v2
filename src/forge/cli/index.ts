#!/usr/bin/env node
import { startRepl, runOneShot } from './repl.js';
import { UI } from './ui.js';

const args = process.argv.slice(2);

if (args.length > 0) {
  // Help flag check
  if (args[0] === '--help' || args[0] === '-h') {
    UI.printHeader();
    UI.printHelp();
    process.exit(0);
  }

  // One-shot mode
  const prompt = args.join(' ');
  runOneShot(prompt);
} else {
  // Interactive REPL mode
  startRepl();
}
