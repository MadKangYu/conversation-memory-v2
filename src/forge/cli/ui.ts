import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import ora from 'ora';

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
  prompt: () => chalk.hex(COLORS.neonGreen).bold('Forge> ')
};
