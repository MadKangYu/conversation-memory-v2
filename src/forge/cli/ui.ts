import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import ora from 'ora';
import { CommandDoc, COMMANDS } from './commands.js';

// Hextech Color Palette
const COLORS = {
  neonGreen: '#39FF14',
  darkGreen: '#004d00',
  hexGold: '#C8AA6E',
  hexBlue: '#0AC8B9',
  voidPurple: '#A020F0',
  zaunGrey: '#2C3E50'
};

// Gradient Themes
const hextechGradient = gradient([COLORS.neonGreen, COLORS.hexBlue]);
const warningGradient = gradient(['#FF4500', '#FFD700']);

export const UI = {
  // ASCII Art Header
  printHeader: () => {
    console.clear();
    const title = figlet.textSync('THE FORGE', {
      font: 'ANSI Shadow',
      horizontalLayout: 'full'
    });
    
    console.log(hextechGradient(title));
    console.log(chalk.hex(COLORS.neonGreen)('  /// AUTONOMOUS CODING AGENT - V3.0 HEXTECH EDITION ///\n'));
  },

  // Hextech Box Style
  box: (text: string, title?: string, style: 'info' | 'error' | 'success' = 'info') => {
    const borderColor = style === 'error' ? 'red' : style === 'success' ? COLORS.neonGreen : COLORS.hexBlue;
    
    console.log(boxen(text, {
      title: title ? chalk.bold(title) : undefined,
      titleAlignment: 'center',
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: borderColor,
      backgroundColor: '#050505'
    }));
  },

  // Spinner
  spinner: (text: string) => {
    return ora({
      text: chalk.hex(COLORS.neonGreen)(text),
      color: 'green',
      spinner: {
        interval: 80,
        frames: [
          "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"
        ]
      }
    });
  },

  // Loggers
  log: {
    info: (msg: string) => console.log(chalk.hex(COLORS.hexBlue)(`ℹ ${msg}`)),
    success: (msg: string) => console.log(chalk.hex(COLORS.neonGreen)(`✔ ${msg}`)),
    warn: (msg: string) => console.log(chalk.yellow(`⚠ ${msg}`)),
    error: (msg: string) => console.log(chalk.red(`✖ ${msg}`)),
    agent: (msg: string) => {
      console.log(chalk.hex(COLORS.hexGold)('\n🤖 AGENT OUTPUT:'));
      console.log(boxen(msg, {
        padding: 1,
        borderStyle: 'classic',
        borderColor: COLORS.hexGold
      }));
    },
    system: (msg: string) => console.log(chalk.gray(`> ${msg}`))
  },

  // Prompt Style
  prompt: () => chalk.hex(COLORS.neonGreen).bold('Forge> '),

  // Help Documentation Renderer
  printHelp: (commandName?: string) => {
    if (commandName) {
      // Specific command help
      const cmd = COMMANDS[commandName] || Object.values(COMMANDS).find(c => c.name === `@${commandName}`);
      
      if (!cmd) {
        console.log(chalk.red(`\n✖ Unknown command: ${commandName}`));
        console.log(chalk.gray('Type "@help" to see all available commands.\n'));
        return;
      }

      const content = [
        chalk.hex(COLORS.hexGold).bold(`USAGE: ${cmd.usage}`),
        '',
        chalk.white(cmd.description),
        '',
        chalk.hex(COLORS.hexBlue).bold('EXAMPLES:'),
        ...cmd.examples.map(ex => chalk.gray(`  $ ${ex}`))
      ].join('\n');

      console.log(boxen(content, {
        title: chalk.hex(COLORS.neonGreen).bold(` ${cmd.name.toUpperCase()} `),
        padding: 1,
        borderStyle: 'double',
        borderColor: COLORS.hexBlue,
        backgroundColor: '#050505'
      }));

    } else {
      // All commands list
      const categories = ['System', 'Filesystem', 'Knowledge', 'General'] as const;
      
      let content = chalk.hex(COLORS.hexGold).bold('AVAILABLE COMMANDS\n\n');

      categories.forEach(cat => {
        const cmds = Object.values(COMMANDS).filter(c => c.category === cat);
        if (cmds.length > 0) {
          content += chalk.hex(COLORS.neonGreen).bold(`[ ${cat} ]\n`);
          cmds.forEach(cmd => {
            content += `${chalk.hex(COLORS.hexBlue).bold(cmd.name.padEnd(10))} ${chalk.white(cmd.description)}\n`;
          });
          content += '\n';
        }
      });

      content += chalk.gray('Type "@help <command>" for detailed usage.');

      console.log(boxen(content, {
        title: chalk.bold(' HEXTECH MANUAL '),
        padding: 1,
        borderStyle: 'round',
        borderColor: COLORS.neonGreen,
        backgroundColor: '#050505'
      }));
    }
  }
};
