export interface CommandDoc {
  name: string;
  description: string;
  usage: string;
  examples: string[];
  aliases?: string[];
  category: 'System' | 'Filesystem' | 'Knowledge' | 'General';
}

export const COMMANDS: Record<string, CommandDoc> = {
  sh: {
    name: '@sh',
    description: 'Executes a shell command in the underlying system. Use with caution.',
    usage: '@sh <command>',
    examples: [
      '@sh ls -la',
      '@sh git status',
      '@sh npm install lodash'
    ],
    category: 'System'
  },
  read: {
    name: '@read',
    description: 'Reads the content of a file from the local filesystem.',
    usage: '@read <path>',
    examples: [
      '@read package.json',
      '@read src/index.ts'
    ],
    category: 'Filesystem'
  },
  list: {
    name: '@list',
    description: 'Lists files and directories in the specified path. Defaults to current directory.',
    usage: '@list [path]',
    examples: [
      '@list',
      '@list src/components'
    ],
    category: 'Filesystem'
  },
  wiki: {
    name: '@wiki',
    description: 'Analyzes the current conversation context and updates the project documentation (The Garden).',
    usage: '@wiki',
    examples: ['@wiki'],
    category: 'Knowledge'
  },
  help: {
    name: '@help',
    description: 'Displays this help message or detailed information about a specific command.',
    usage: '@help [command]',
    examples: [
      '@help',
      '@help sh'
    ],
    category: 'General'
  },
  exit: {
    name: 'exit',
    description: 'Terminates the current session and closes the CLI.',
    usage: 'exit',
    examples: ['exit'],
    category: 'General'
  }
};
