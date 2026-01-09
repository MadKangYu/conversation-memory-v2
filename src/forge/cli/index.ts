#!/usr/bin/env node
import { startRepl, runOneShot } from './repl.js';

const args = process.argv.slice(2);

if (args.length > 0) {
  // One-shot mode
  const prompt = args.join(' ');
  runOneShot(prompt);
} else {
  // Interactive REPL mode
  startRepl();
}
