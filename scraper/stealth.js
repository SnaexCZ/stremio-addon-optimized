// scraper/stealth.js - Stealth browser pro obejití anti-bot ochrany

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Aktivuj stealth mode
puppeteer.use(StealthPlugin());

let stealthBrowser = null;

async function getStealthBrowser() {
    if (stealthBrowser) return stealthBrowser;
    
    console.log('🥷 Launching stealth browser...');
    
    stealthBrowser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--window-size=1366,768',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
    });
    
    console.log('✅ Stealth browser ready');
    return stealthBrowser;
}

async function createStealthPage() {
    const browser = await getStealthBrowser();
    const page = await browser.newPage();
    
    // Nastavení realistického user-agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Nastavení viewport
    await page.setViewport({ width: 1366, height: 768 });
    
    // Extra headers pro realismus
    await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
    });
    
    // Odstranění webdriver vlastností
    await page.evaluateOnNewDocument(() => {
        // Remove webdriver property
        delete navigator.__proto__.webdriver;
        
        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        
        // Mock languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['cs-CZ', 'cs', 'en-US', 'en']
        });
        
        // Mock vendor
        Object.defineProperty(navigator, 'vendor', {
            get: () => 'Google Inc.'
        });
        
        // Mock permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });
    
    return page;
}

// Random delay mezi akcemi
async function humanDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
}

// Simulace lidského scrollování
async function humanScroll(page) {
    await page.evaluate(() => {
        const scrollHeight = Math.floor(Math.random() * 1000) + 500;
        window.scrollTo(0, scrollHeight);
    });
    await humanDelay(500, 1500);
}

// Cleanup function
async function closeBrowser() {
    if (stealthBrowser) {
        await stealthBrowser.close();
        stealthBrowser = null;
        console.log('🥷 Stealth browser closed');
    }
}

module.exports = {
    getStealthBrowser,
    createStealthPage,
    humanDelay,
    humanScroll,
    closeBrowser
};
