// utils/auth.js - STEALTH AUTH s anti-bot ochranou

const fetchBase = require('node-fetch');
const ToughCookie = require('tough-cookie');
const { JSDOM } = require('jsdom');
const { createStealthPage, humanDelay, humanScroll } = require('../scraper/stealth');

const SV_BASE = process.env.SVETSERIALU_BASE || 'https://svetserialu.io';
const SV_EMAIL = process.env.SVETSERIALU_LOGIN_EMAIL || '';
const SV_PASS = process.env.SVETSERIALU_LOGIN_PASSWORD || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const jar = new ToughCookie.CookieJar();

async function withCookies(url, opts = {}) {
    const u = typeof url === 'string' ? url : url.toString();
    const cookieHeader = await new Promise(res => jar.getCookieString(u, (_, s) => res(s || '')));
    const headers = Object.assign({ Cookie: cookieHeader, 'User-Agent': UA }, opts.headers || {});
    const res = await fetchBase(u, Object.assign({}, opts, { headers }));
    const raw = res.headers.raw ? res.headers.raw() : {};
    const setCookie = (raw && raw['set-cookie']) || [];
    await Promise.all(setCookie.map(sc => new Promise(r => jar.setCookie(sc, u, () => r()))));
    return res;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHtml(url, ref) {
    const res = await withCookies(url, {
        headers: {
            'User-Agent': UA,
            'Referer': ref || SV_BASE,
            'Accept': 'text/html,*/*',
            'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache'
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
}

async function getPlaywrightCookiesFor(urlStr) {
    return new Promise((resolve) => {
        try {
            jar.getCookies(urlStr, (err, cookies) => {
                if (err || !cookies) return resolve([]);
                const out = cookies.map(c => ({
                    name: c.key,
                    value: c.value,
                    domain: c.domain || new URL(urlStr).hostname,
                    path: c.path || '/',
                    httpOnly: !!c.httpOnly,
                    secure: !!c.secure
                }));
                resolve(out);
            });
        } catch {
            resolve([]);
        }
    });
}

// ✅ STEALTH LOGIN - obchází anti-bot ochranu
async function svLogin() {
    if (!SV_EMAIL || !SV_PASS) {
        console.warn('⚠️ SV login: chybí přihlašovací údaje (.env)');
        return false;
    }

    try {
        console.log('🥷 Starting STEALTH login to SvetSerialu...');
        
        const page = await createStealthPage();
        
        // Nejdříve navštív hlavní stránku pro získání session
        console.log('🥷 Visiting homepage first...');
        await page.goto(SV_BASE, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        await humanDelay(2000, 4000);
        await humanScroll(page);
        
        // Jdi na login stránku
        console.log('🥷 Navigating to login page...');
        const loginUrl = `${SV_BASE}/user/login`;
        await page.goto(loginUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        await humanDelay(3000, 5000);
        
        // Najdi login formulář
        const emailSelector = 'input[name*="email"], input[type="email"], input[name*="mail"]';
        const passwordSelector = 'input[name*="password"], input[type="password"], input[name*="pass"]';
        
        try {
            await page.waitForSelector(emailSelector, { timeout: 10000 });
            console.log('🥷 Login form found');
        } catch (e) {
            console.error('❌ Login form not found');
            await page.close();
            return false;
        }
        
        // Vyplň email s lidským tempem
        await page.click(emailSelector);
        await humanDelay(500, 1000);
        await page.type(emailSelector, SV_EMAIL, { delay: 120 });
        
        await humanDelay(1000, 2000);
        
        // Vyplň heslo
        await page.click(passwordSelector);
        await humanDelay(500, 1000);
        await page.type(passwordSelector, SV_PASS, { delay: 100 });
        
        await humanDelay(2000, 3000);
        
        // Submit formulář
        console.log('🥷 Submitting login form...');
        
        const submitSelectors = [
            'input[type="submit"]',
            'button[type="submit"]',
            'button:has-text("Přihlásit")',
            'button:has-text("Login")',
            '[value*="přihlás"]'
        ];
        
        let submitted = false;
        for (const selector of submitSelectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    await element.click();
                    submitted = true;
                    console.log(`🥷 Clicked submit: ${selector}`);
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!submitted) {
            console.log('🥷 Trying Enter key...');
            await page.keyboard.press('Enter');
        }
        
        // Čekej na redirect nebo response
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        } catch (e) {
            console.log('⚠️ Navigation timeout, checking current status...');
        }
        
        await humanDelay(2000, 3000);
        
        // Zkontroluj úspěch loginu
        const currentUrl = page.url();
        const pageContent = await page.content();
        
        const isLoggedIn = !currentUrl.includes('/user/login') && 
                          (pageContent.includes('logout') || 
                           pageContent.includes('odhlás') ||
                           pageContent.includes('profil') ||
                           !pageContent.includes('přihlášení'));
        
        if (isLoggedIn) {
            // Získej cookies
            const cookies = await page.cookies();
            
            // Přenos cookies do fetch session
            let cookieCount = 0;
            for (const cookie of cookies) {
                try {
                    await new Promise(resolve => {
                        const cookieString = `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}`;
                        jar.setCookie(cookieString, `https://${cookie.domain}`, () => resolve());
                    });
                    cookieCount++;
                } catch (e) {
                    console.warn(`⚠️ Failed to set cookie: ${cookie.name}`);
                }
            }
            
            console.log(`✅ STEALTH LOGIN SUCCESSFUL - transferred ${cookieCount} cookies`);
            await page.close();
            return true;
        } else {
            console.error('❌ STEALTH LOGIN FAILED - still on login page or error detected');
            console.log(`Current URL: ${currentUrl}`);
            await page.close();
            return false;
        }
        
    } catch (e) {
        console.error('❌ STEALTH LOGIN ERROR:', e.message);
        return false;
    }
}

// ✅ STEALTH SEARCH - obchází anti-bot ochranu
async function findSlugOnSvetserialu(title) {
    try {
        console.log(`🥷 STEALTH search for: "${title}"`);
        
        const page = await createStealthPage();
        
        const searchUrl = `${SV_BASE}/?searchfor=${encodeURIComponent(title)}`;
        console.log(`🥷 Search URL: ${searchUrl}`);
        
        await page.goto(searchUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        await humanDelay(2000, 4000);
        await humanScroll(page);
        
        // Extrahuj linky na seriály
        const serialLinks = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/serial/"]'));
            return anchors.map(a => ({
                href: a.getAttribute('href'),
                text: (a.textContent || '').trim()
            })).filter(link => link.href && link.text);
        });
        
        await page.close();
        
        console.log(`🥷 STEALTH search found ${serialLinks.length} results`);
        
        if (serialLinks.length === 0) {
            console.warn(`❌ No results found for: "${title}"`);
            return null;
        }
        
        // Najdi nejlepší match
        const titleLower = title.toLowerCase();
        
        // Nejdříve hledej přesnou shodu
        for (const link of serialLinks) {
            const linkTextLower = link.text.toLowerCase();
            if (linkTextLower === titleLower) {
                const match = link.href.match(/\/serial\/([^\/?#]+)/i);
                if (match) {
                    console.log(`✅ STEALTH search EXACT match: "${link.text}" -> ${match[1]}`);
                    return match[1];
                }
            }
        }
        
        // Pak hledej částečnou shodu
        for (const link of serialLinks) {
            const linkTextLower = link.text.toLowerCase();
            if (linkTextLower.includes(titleLower) || titleLower.includes(linkTextLower)) {
                const match = link.href.match(/\/serial\/([^\/?#]+)/i);
                if (match) {
                    console.log(`📍 STEALTH search PARTIAL match: "${link.text}" -> ${match[1]}`);
                    return match[1];
                }
            }
        }
        
        // Fallback na první výsledek
        const firstMatch = serialLinks[0].href?.match(/\/serial\/([^\/?#]+)/i);
        if (firstMatch) {
            console.log(`🎯 STEALTH search FALLBACK: "${serialLinks[0].text}" -> ${firstMatch[1]}`);
            return firstMatch[1];
        }
        
        console.warn(`❌ No suitable match found for: "${title}"`);
        return null;
        
    } catch (e) {
        console.error('❌ STEALTH SEARCH ERROR:', e.message);
        return null;
    }
}

async function getTitleFromImdb(imdbId) {
    try {
        console.log(`📽️ Fetching title for ${imdbId}`);
        const html = await fetchHtml(`https://www.imdb.com/title/${imdbId}/`, 'https://www.imdb.com/');
        
        // Zkus najít JSON-LD data
        const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
        if (ldMatch) {
            try {
                const jsonData = JSON.parse(ldMatch[1]);
                if (jsonData && jsonData.name) {
                    let title = String(jsonData.name).trim();
                    console.log(`📽️ Title from JSON-LD: "${title}"`);
                    return title;
                }
            } catch (e) {
                console.log('⚠️ JSON-LD parsing failed:', e.message);
            }
        }
        
        // Fallback: parsuj z <title> tagu
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
            let title = titleMatch[1].trim();
            console.log(`📽️ Raw title from <title>: "${title}"`);
            
            // Vyčisti název - odstraň vše za prvním "("
            title = title.split('(')[0].trim();
            
            // Odstraň " - IMDb" na konci
            title = title.replace(/\s*-\s*IMDb\s*$/i, '').trim();
            
            console.log(`📽️ Cleaned title: "${title}"`);
            
            if (title && title.length > 0) {
                return title;
            }
        }
        
        console.warn(`⚠️ No title found for ${imdbId}`);
        return null;
        
    } catch (e) {
        console.error('❌ IMDb fetch error:', e.message);
        return null;
    }
}

function buildEpisodeUrl(slug, season, episode) {
    const s = Number.isFinite(season) ? String(season).padStart(2, '0') : '01';
    const e = Number.isFinite(episode) ? String(episode).padStart(2, '0') : '01';
    return `${SV_BASE}/serial/${slug}/s${s}e${e}`;
}

async function getResolutionFromUrl(streamUrl, streamType) {
    try {
        if (streamType === 'hls') {
            const response = await fetchBase(streamUrl, {
                headers: { 'User-Agent': UA },
                timeout: 5000
            });
            
            if (!response.ok) return null;
            
            const content = await response.text();
            const lines = content.split('\n');
            
            let bestResolution = null;
            let bestBandwidth = 0;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                    const attrLine = lines[i];
                    
                    const resMatch = attrLine.match(/RESOLUTION=(\d+x\d+)/);
                    const bandMatch = attrLine.match(/BANDWIDTH=(\d+)/);
                    
                    if (resMatch && bandMatch) {
                        const bandwidth = parseInt(bandMatch[1]);
                        if (bandwidth > bestBandwidth) {
                            bestBandwidth = bandwidth;
                            bestResolution = resMatch[1];
                        }
                    }
                }
            }
            
            if (bestResolution) {
                const [width, height] = bestResolution.split('x').map(Number);
                if (height >= 1080) return '1080p';
                else if (height >= 720) return '720p';
                else if (height >= 480) return '480p';
                else return '360p';
            }
        } else {
            const url = streamUrl.toLowerCase();
            if (url.includes('_h.mp4') || url.includes('high') || url.includes('1080')) {
                return '1080p';
            } else if (url.includes('_m.mp4') || url.includes('med') || url.includes('720')) {
                return '720p';
            } else if (url.includes('_l.mp4') || url.includes('low') || url.includes('480')) {
                return '480p';
            } else {
                return '720p';
            }
        }
        
        return null;
    } catch (e) {
        console.log(`⚠️ Resolution detection failed: ${e.message}`);
        return null;
    }
}

module.exports = {
    withCookies,
    fetchHtml,
    getPlaywrightCookiesFor,
    svLogin,
    getTitleFromImdb,
    findSlugOnSvetserialu,
    buildEpisodeUrl,
    getResolutionFromUrl,
    delay
};
