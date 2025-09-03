// scraper/stealth.js - OPRAVENÁ verze s correct Chrome path

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

let stealthBrowser = null;

async function getStealthBrowser() {
    if (stealthBrowser) return stealthBrowser;
    
    console.log('🥷 Launching stealth browser...');
    
    // ✅ KLÍČOVÁ OPRAVA: Detekce správné Chrome path pro různá prostředí
    let executablePath;
    
    if (process.env.NODE_ENV === 'production') {
        // Pro Render.com - zkus několik možných cest
        const possiblePaths = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome'
        ];
        
        executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || possiblePaths[0];
        console.log(`🥷 Production executable path: ${executablePath}`);
    } else {
        // Pro lokální development
        executablePath = puppeteer.executablePath();
        console.log(`🥷 Development executable path: ${executablePath}`);
    }
    
    stealthBrowser = await puppeteer.launch({
        headless: "new", // ✅ OPRAVA: Použij nový headless mode
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
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--single-process', // Pro Render.com memory limit
            '--no-zygote'       // Pro Render.com stability
        ],
        executablePath: executablePath
    });
    
    console.log('✅ Stealth browser ready with path:', executablePath);
    return stealthBrowser;
}

// Zbytek souboru zůstává stejný...
async function createStealthPage() {
    const browser = await getStealthBrowser();
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
    });
    
    await page.evaluateOnNewDocument(() => {
        delete navigator.__proto__.webdriver;
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['cs-CZ', 'cs', 'en-US', 'en']
        });
    });
    
    return page;
}

async function humanDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function humanScroll(page) {
    await page.evaluate(() => {
        const scrollHeight = Math.floor(Math.random() * 1000) + 500;
        window.scrollTo(0, scrollHeight);
    });
    await humanDelay(500, 1500);
}

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
