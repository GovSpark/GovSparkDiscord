import { registerGuildCommands } from './commands.js';
import { getConfig } from './config.js';

const config = getConfig();
await registerGuildCommands(config);
console.info('Guild slash commands registered.');
