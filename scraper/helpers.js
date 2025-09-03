// scraper/helpers.js — KOMPLETNÍ scraping logika s CZ Dabing podporou

const { chromium } = require('playwright');

let browser;

async function getBrowser(headless = true) {
    if (browser) return browser;
    browser = await chromium.launch({
        headless,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage', 
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ]
    });
    return browser;
}

function uniquePush(arr, u) { 
    if (u && !arr.includes(u)) arr.push(u); 
}

function htmlDecode(s) {
    if (typeof s !== 'string') return s;
    return s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function sanitizeUrl(u) {
    if (typeof u !== 'string') return null;
    let s = htmlDecode(u.trim());
    s = s.replace(/\[(https?:\/\/[^\]\s]+)\]/g, '$1').replace(/\((https?:\/\/[^\)\s]+)\)/g, '$1');
    s = s.replace(/\[[^\]]+\]\((https?:\/\/[^\)]+)\)/g, '$1');
    return s;
}

async function clickCzDabingButton(page) {
    console.log('🇨🇿 Hledám CZ Dabing tlačítko...');
    
    const czSelectors = [
        '.langCZ',
        'div.LangHeader.langCZ',  
        '.LangHeader.langCZ',
        '[class*="langCZ"]',
        '.cz-dabing',
        '.dabing-cz'
    ];

    for (const sel of czSelectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
                console.log(`🎯 Našel CZ tlačítko: ${sel}`);
                
                await el.click({ timeout: 2000 });
                console.log('✅ Kliknuto na CZ Dabing tlačítko');
                
                await page.waitForTimeout(2000);
                
                try {
                    await page.waitForSelector('.tabshe8 ul.tabs li', { timeout: 5000 });
                    console.log('✅ CZ Dabing hostery načteny');
                } catch {
                    console.log('⚠️ Timeout čekání na CZ hostery, pokračuji...');
                }
                
                return true;
            }
        } catch (e) {
            console.log(`⚠️ Chyba při klikání na ${sel}:`, e.message);
            continue;
        }
    }

    console.log('❌ CZ Dabing tlačítko nenalezeno');
    return false;
}

async function clickCzechIfPresent(page) {
    const selectors = [
        'img[alt*="CZ" i], img[alt*="Czech" i], img[alt*="Česk" i]',
        '[class*="flag"][class*="cz" i], [class*="flag"][class*="czech" i]',
        '[data-lang="cs"], [data-lang="cz"], [data-lang="czech"]',
        'button:has-text("CZ"), a:has-text("CZ")',
        'button:has-text("CZSK"), a:has-text("CZSK")',
        'button:has-text("Czech"), a:has-text("Czech")',
        'button:has-text("Čeština"), a:has-text("Čeština")',
        'button:has-text("Česky"), a:has-text("Česky")'
    ];

    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
                await el.click({ timeout: 1000 });
                await page.waitForTimeout(500);
                console.log(`✅ Clicked Czech element: ${sel}`);
                return true;
            }
        } catch (e) {
            continue;
        }
    }
    return false;
}

function normTxt(s) { 
    return (typeof s === 'string' ? s : '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); 
}

async function clickCzechFlagStrict(page) {
    console.log('🔍 Pokročilé hledání CZ prvků...');
    
    const directSelectors = [
        'li:has(img[alt*="cz" i]) a, li:has(img[alt*="cz" i]) button',
        'img[alt*="cz" i], img[alt*="Czech" i]',
        '[data-lang="cz"], [data-lang="cs"]',
        'a:has-text("CZ"), button:has-text("CZ")',
        'a:has-text("CZSK"), button:has-text("CZSK")',
        'a:has-text("Čeština"), button:has-text("Čeština")',
        'a:has-text("Czech"), button:has-text("Czech")'
    ];

    for (const sel of directSelectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
                await el.click({ timeout: 1500 });
                await page.waitForTimeout(700);
                console.log(`✅ Clicked CZ element: ${sel}`);
                return true;
            }
        } catch (e) {
            continue;
        }
    }

    console.log('❌ Žádný CZ prvek nenalezen');
    return false;
}

async function ensureMutedAndPlay(page) {
    await page.addInitScript(() => {
        try {
            document.querySelectorAll('video').forEach(v => {
                v.setAttribute('playsinline', '');
                v.setAttribute('muted', '');
                v.muted = true;
            });
        } catch {}
    });

    const playSelectors = [
        'button[aria-label*="play" i]',
        'button[class*="play" i]',
        '.vjs-big-play-button',
        '.jw-icon-play',
        '.jw-display-icon-display', 
        '.plyr__control--overlaid',
        '.plyr__control[data-plyr="play"]',
        '.play-btn',
        '.play-button',
        'video',
        '[data-play]'
    ];

    for (const sel of playSelectors) {
        try {
            await page.click(sel, { timeout: 1000 });
            console.log(`▶️ Clicked play: ${sel}`);
            await page.waitForTimeout(500);
        } catch {}
    }

    try {
        await page.evaluate(() => {
            const videos = document.querySelectorAll('video');
            videos.forEach(v => {
                if (v) {
                    v.muted = true;
                    if (v.play) {
                        v.play().catch(() => {});
                    }
                }
            });
        });
    } catch {}
}

async function waitForMediaResponse(page, timeout = 15000) {
    try {
        const resp = await page.waitForResponse(
            r => /\.(m3u8|mp4|avi|mkv|webm)(\?|$)/i.test(r.url()),
            { timeout }
        );
        return resp ? resp.url() : null;
    } catch {
        return null;
    }
}

async function extractFromDom(page) {
    const urls = [];

    try {
        const videoSources = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('video source').forEach(s => {
                if (s.src) out.push(s.src);
            });
            document.querySelectorAll('video').forEach(v => {
                if (v.src) out.push(v.src);
                if (v.currentSrc) out.push(v.currentSrc);
            });
            return out;
        });
        videoSources.forEach(u => uniquePush(urls, u));
    } catch {}

    const html = await page.content();
    
    const sourcesMatch = html.match(/sources\s*:\s*(\[[\s\S]*?\])/i);
    if (sourcesMatch) {
        try {
            const sources = JSON.parse(sourcesMatch[1]);
            sources.forEach(src => {
                if (src && typeof src.file === 'string') uniquePush(urls, src.file);
                if (src && typeof src.src === 'string') uniquePush(urls, src.src);
            });
        } catch {}
    }

    const hlsPattern = /https?:\/\/[^\s"'<>()]+\.m3u8[^\s"'<>()]*/ig;
    const mp4Pattern = /https?:\/\/[^\s"'<>()]+\.(mp4|avi|mkv|webm)[^\s"'<>()]*/ig;
    
    const hlsUrls = html.match(hlsPattern) || [];
    const mp4Urls = html.match(mp4Pattern) || [];
    
    [...hlsUrls, ...mp4Urls].forEach(u => uniquePush(urls, u));

    return urls;
}

async function runHeadlessHosterFlow({ sourcesUrl, userAgent, parentRef, cookies }) {
    const br = await getBrowser(true);
    const context = await br.newContext({
        userAgent: userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block',
        extraHTTPHeaders: {
            'Accept': 'text/html,*/*',
            'Accept-Language': 'cs,en;q=0.9'
        }
    });

    if (Array.isArray(cookies) && cookies.length) {
        try { await context.addCookies(cookies); } catch {}
    }

    const page = await context.newPage();
    const captured = [];
    const seen = new Set();

    page.on('request', (req) => {
        const u = req.url();
        if ((/\.(m3u8|mp4|avi|mkv|webm)(\?|$)/i.test(u)) && !seen.has(u)) {
            seen.add(u);
            captured.push(u);
            console.log(`📥 Request captured: ${u}`);
        }
    });

    page.on('response', (res) => {
        try {
            const u = res.url();
            if ((/\.(m3u8|mp4|avi|mkv|webm)(\?|$)/i.test(u)) && !seen.has(u)) {
                seen.add(u);
                captured.push(u);
                console.log(`📤 Response captured: ${u}`);
            }
        } catch {}
    });

    try {
        console.log(`🌐 Loading sources: ${sourcesUrl}`);
        await page.goto(sourcesUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
            referer: parentRef || undefined
        });

        await clickCzechIfPresent(page);
        await clickCzechFlagStrict(page);

        const embedUrl = await page.evaluate(() => {
            const iframe = document.querySelector('iframe');
            return iframe ? iframe.src : null;
        });

        if (embedUrl) {
            console.log(`🎬 Loading embed: ${embedUrl}`);
            await page.goto(embedUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
                referer: parentRef || sourcesUrl
            });

            await page.waitForTimeout(1000);
            await clickCzechIfPresent(page);
            await clickCzechFlagStrict(page);
            await page.waitForTimeout(500);

            await ensureMutedAndPlay(page);
            await page.waitForTimeout(1000);

            await waitForMediaResponse(page, 10000);
            await page.waitForTimeout(1000);
        }

        const domUrls = await extractFromDom(page);
        console.log(`📊 HEADLESS CAPTURED: ${captured.length}, DOM: ${domUrls.length}`);

        const allUrls = Array.from(new Set([...captured, ...domUrls]));
        const result = [];
        
        allUrls.forEach(u => {
            if (/\.m3u8(\?|$)/i.test(u)) {
                result.push({ url: u, type: 'hls' });
            } else if (/\.(mp4|avi|mkv|webm)(\?|$)/i.test(u)) {
                result.push({ url: u, type: 'file' });
            }
        });

        await context.close();
        return result;

    } catch (e) {
        console.error('❌ Headless flow error:', e.message);
        try { await context.close(); } catch {}
        return [];
    }
}

async function runVoeHeadless(sourcesUrl, userAgent, parentRef, cookies) {
    const streams = await runHeadlessHosterFlow({ sourcesUrl, userAgent, parentRef, cookies });
    
    const br = await getBrowser(true);
    const context = await br.newContext({
        userAgent: userAgent,
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block'
    });
    
    if (Array.isArray(cookies) && cookies.length) {
        try { await context.addCookies(cookies); } catch {}
    }
    
    const page = await context.newPage();
    let originalIframeUrl = '';
    
    try {
        await page.goto(sourcesUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
            referer: parentRef || undefined
        });
        
        originalIframeUrl = await page.evaluate(() => {
            const iframe = document.querySelector('iframe');
            return iframe ? iframe.src : '';
        });
        
        console.log(`🔍 Voe original iframe URL: ${originalIframeUrl.slice(0, 100)}...`);
        
    } catch (e) {
        console.log(`⚠️ Voe iframe extraction failed: ${e.message}`);
    }
    
    try { await context.close(); } catch {}
    
    return streams.map(s => ({
        ...s,
        name: 'Voe',
        title: (s.type === 'hls' ? 'HLS' : 'MP4') + ' • Voe',
        originalIframeUrl
    }));
}

// ⚡ VYPNUTÁ FileMoon funkce pro rychlost
async function runFileMoonHeadless(sourcesUrl, userAgent, parentRef, cookies) {
    console.log('⚡ FileMoon DISABLED for performance optimization');
    return [];
}

function detectLangAndDub(htmlChunk, url = '') {
    const low = normTxt(htmlChunk || '');
    const lowUrl = (url || '').toLowerCase();
    
    let lang = null;
    if (/\bczsk\b|\bcz\b|\bcs\b|czech|cesk/.test(low) || lowUrl.includes('cz')) {
        lang = 'cs';
    } else if (/\ben\b|english|anglick/.test(low) || lowUrl.includes('en')) {
        lang = 'en';
    }
    
    const dub = /dab|dabing|\bcz\s*dab|czech\s*dub|cesk.*dub/.test(low) || 
              lowUrl.includes('dabing') || 
              lowUrl.includes('czsk');
    
    return { lang, dub };
}

// ✅ KLÍČOVÁ FUNKCE - parsování CZ Dabing sekce
async function parseEpisodeHeadless(epUrl, userAgent, cookies) {
    const br = await getBrowser(true);
    const context = await br.newContext({
        userAgent: userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block',
        extraHTTPHeaders: {
            'Accept': 'text/html,*/*',
            'Accept-Language': 'cs,en;q=0.9'
        }
    });

    if (Array.isArray(cookies) && cookies.length) {
        try { await context.addCookies(cookies); } catch {}
    }

    const page = await context.newPage();
    const hosters = [];
    const subtitles = [];

    try {
        console.log(`🎭 Parsing episode: ${epUrl}`);
        await page.goto(epUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });

        await clickCzechIfPresent(page);
        await page.waitForTimeout(300);

        // ✅ KLÍČOVÉ: Kliknutí na CZ Dabing tlačítko
        const czDabingClicked = await clickCzDabingButton(page);
        
        if (czDabingClicked) {
            console.log('🇨🇿 CZ Dabing obsah načten, parsuju hostery...');
            
            const czDabingItems = await page.evaluate(() => {
                const out = [];
                const seen = new Set();
                
                const selectors = [
                    '.tabshe8 a.source_link',
                    '.tabshe8 [data-iframe]',
                    '.tabs a.source_link',
                    'a.source_link',
                    '[data-iframe]'
                ];
                
                selectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(a => {
                        const cls = (a.getAttribute('class') || '').toLowerCase();
                        const raw = a.getAttribute('data-iframe') ||
                                   a.getAttribute('data-source') ||
                                   a.getAttribute('href') || '';
                        
                        if (!raw) return;
                        
                        if (seen.has(raw)) return;
                        seen.add(raw);
                        
                        const parentElement = a.closest('li') || a.parentElement || document.body;
                        
                        out.push({
                            cls,
                            raw,
                            html: parentElement.innerText || parentElement.textContent || ''
                        });
                    });
                });
                
                return out;
            });

            console.log(`🔍 Nalezeno ${czDabingItems.length} unikátních CZ dabing položek`);

            for (const item of czDabingItems) {
                const isFM = item.cls.includes('filemoon') || /filemoon/i.test(item.raw);
                const isVoe = /\bvoe\b/i.test(item.cls) || /voe/i.test(item.raw);

                if (!isFM && !isVoe) continue;
                
                // ⚡ VŠECHNY hostery, ne jen Voe - toto je klíč!
                // if (isFM) {
                //     console.log('⚡ Skipping FileMoon hoster for performance');
                //     continue;
                // }

                let path = '';
                if (/^https?:\/\//i.test(item.raw)) {
                    path = item.raw;
                } else {
                    try {
                        path = Buffer.from(item.raw, 'base64').toString('utf8');
                    } catch {}
                }

                if (!path) continue;

                const absoluteUrl = new URL(path, epUrl).toString();
                console.log(`🎬 CZ Dabing hoster: ${isFM ? 'FileMoon' : 'Voe'} - ${absoluteUrl}`);
                
                hosters.push({
                    kind: isFM ? 'filemoon' : 'voe',
                    url: absoluteUrl,
                    lang: 'cs',
                    dub: true // ✅ KLÍČOVÉ: označit jako dabing
                });
            }
        }

        // Fallback parsing - pokud CZ Dabing sekce selhala
        if (hosters.length === 0) {
            console.log('📺 Fallback: parsing default content...');
            
            const defaultItems = await page.evaluate(() => {
                const out = [];
                const selectors = [
                    'a.source_link',
                    '[data-iframe]',
                    'a[href*="/sources/"]',
                    'a[data-source]',
                    '.source-link'
                ];
                
                selectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(a => {
                        const cls = (a.getAttribute('class') || '').toLowerCase();
                        const raw = a.getAttribute('data-iframe') ||
                                   a.getAttribute('data-source') ||
                                   a.getAttribute('href') || '';
                        
                        const parentElement = a.closest('li') || a.parentElement || document.body;
                        
                        out.push({
                            cls,
                            raw,
                            html: parentElement.innerText || parentElement.textContent || ''
                        });
                    });
                });

                const subs = [];
                document.querySelectorAll('track, a[href$=".vtt"], a[href$=".srt"]').forEach(t => {
                    const surl = t.getAttribute('src') || t.getAttribute('href');
                    if (surl) subs.push(surl);
                });
                
                return { items: out, subs };
            });

            for (const item of defaultItems.items) {
                const isFM = item.cls.includes('filemoon') || /filemoon/i.test(item.raw);
                const isVoe = /\bvoe\b/i.test(item.cls) || /voe/i.test(item.raw);

                if (!isFM && !isVoe) continue;

                let path = '';
                if (/^https?:\/\//i.test(item.raw)) {
                    path = item.raw;
                } else {
                    try {
                        path = Buffer.from(item.raw, 'base64').toString('utf8');
                    } catch {}
                }

                if (!path) continue;

                const absoluteUrl = new URL(path, epUrl).toString();
                const { lang, dub } = detectLangAndDub(item.html || '', absoluteUrl);

                hosters.push({
                    kind: isFM ? 'filemoon' : 'voe',
                    url: absoluteUrl,
                    lang: lang || 'en',
                    dub: !!dub
                });
            }

            for (const subUrl of defaultItems.subs) {
                const fullUrl = new URL(subUrl, epUrl).toString();
                const lowUrl = fullUrl.toLowerCase();
                
                let lang = 'cs', label = 'Čeština';
                if (lowUrl.includes('-en-') || lowUrl.endsWith('.en.vtt') || lowUrl.endsWith('.en.srt') || lowUrl.includes('/en/')) {
                    lang = 'en';
                    label = 'English';
                }
                
                subtitles.push({ url: fullUrl, lang, label });
            }
        }

    } catch (e) {
        console.warn('❌ parseEpisodeHeadless error:', e.message);
    }

    try { await context.close(); } catch {}

    const uniqueSubtitles = Array.from(new Map(subtitles.map(s => [s.url, s])).values());
    const uniqueHosters = Array.from(new Map(hosters.map(h => [`${h.kind}|${h.url}`, h])).values());

    console.log(`📊 Parsed ${uniqueHosters.length} unique hosters, ${uniqueSubtitles.length} subtitles`);
    return { hosters: uniqueHosters, subtitles: uniqueSubtitles };
}

module.exports = {
    htmlDecode,
    sanitizeUrl,
    clickCzechIfPresent,
    clickCzechFlagStrict,
    runVoeHeadless,
    runFileMoonHeadless,
    parseEpisodeHeadless
};
