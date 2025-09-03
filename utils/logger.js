// utils/logger.js - Logging systém

const fs = require('fs');
const path = require('path');

// Vytvoř logs složku
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    // Console
    console.log(logMessage, ...args);
    
    // Soubor
    const logFile = path.join(logsDir, `addon-${new Date().toISOString().split('T')[0]}.log`);
    const fullMessage = args.length > 0 
        ? `${logMessage} ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ')}\n`
        : `${logMessage}\n`;
    
    fs.appendFileSync(logFile, fullMessage);
}

function info(message, ...args) { log('info', message, ...args); }
function warn(message, ...args) { log('warn', message, ...args); }
function error(message, ...args) { log('error', message, ...args); }

module.exports = { log, info, warn, error };
