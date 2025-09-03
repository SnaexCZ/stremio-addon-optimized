// scraper/helpers.js — Scraping helpers s podporou stealth mode

const { createStealthPage, humanDelay, humanScroll } = require('./stealth');
const { JSDOM } = require('jsdom');

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

async function runStealthHosterFlow({ sourcesUrl, userAgent, parentRef, cookies }) {
    const page = await createStealthPage();
    const captured = [];
    const seen = new Set();

    page.on('request', (req) => {
        const u = req.url();
        if ((/\.(m3u8|mp4|avi|mkv|webm)(\?|$)/i.test(u)) && !seen.has(u)) {
            seen.add(u);
            captured.push(u);
            console.log(`📥 Stealth request captured: ${u}`);
        }
    });

    page.on('response', (res) => {
        try {
            const u = res.url();
            if ((/\.(m3u8|mp4|avi|mkv|webm)(\?|$)/i.test(u)) && !seen.has(u)) {
                seen.add(u);
                captured.push(u);
                console.log(`📤 Stealth response captured: ${u}`);
            }
        } catch {}
    });

    try {
        console.log(`🥷 Stealth loading sources: ${sourcesUrl}`);
        await page.goto(sourcesUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000,
            referer: parentRef || undefined
        });

        await humanDelay(2000, 4000);
        await humanScroll(page);

        const embedUrl = await page.evaluate(() => {
            const iframe = document.querySelector('iframe');
            return iframe ? iframe.src : null;
        });

        if (embedUrl) {
            console.log(`🥷 Stealth loading embed: ${embedUrl}`);
            await page.goto(embedUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000,
                referer: parentRef || sourcesUrl
            });

            await humanDelay(1000, 2000);
            await humanScroll(page);

            // Zkus najít a kliknout play button
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
                '[data-play]'
            ];

            for (const sel of playSelectors) {
                try {
                    await page.click(sel, { timeout: 1000 });
                    console.log(`▶️ Stealth clicked play: ${sel}`);
                    await humanDelay(500, 1000);
                    break;
                } catch {}
            }

            await waitForMediaResponse(page, 10000);
            await humanDelay(1000, 2000);
        }

        const domUrls = await extractFromDom(page);
        console.log(`📊 STEALTH CAPTURED: ${captured.length}, DOM: ${domUrls.length}`);

        const allUrls = Array.from(new Set([...captured, ...domUrls]));
        const result = [];
        
        allUrls.forEach(u => {
            if (/\.m3u8(\?|$)/i.test(u)) {
                result.push({ url: u, type: 'hls' });
            } else if (/\.(mp4|avi|mkv|webm)(\?|$)/i.test(u)) {
                result.push({ url: u, type: 'file' });
            }
        });

        await page.close();
        return result;

    } catch (e) {
        console.error('❌ Stealth hoster flow error:', e.message);
        try { await page.close(); } catch {}
        return [];
    }
}

async function runVoeHeadless(sourcesUrl, userAgent, parentRef, cookies) {
    const streams = await runStealthHosterFlow({ sourcesUrl, userAgent, parentRef, cookies });
    
    const page = await createStealthPage();
    let originalIframeUrl = '';
    
    try {
        await page.goto(sourcesUrl, {
            waitUntil: 'networkidle2',
            timeout: 15000,
            referer: parentRef || undefined
        });
        
        originalIframeUrl = await page.evaluate(() => {
            const iframe = document.querySelector('iframe');
            return iframe ? iframe.src : '';
        });
        
        console.log(`🔍 Voe stealth iframe URL: ${originalIframeUrl.slice(0, 100)}...`);
        
    } catch (e) {
        console.log(`⚠️ Voe iframe extraction failed: ${e.message}`);
    }
    
    try { await page.close(); } catch {}
    
    return streams.map(s => ({
        ...s,
        name: 'Voe',
        title: (s.type === 'hls' ? 'HLS' : 'MP4') + ' • Voe',
        originalIframeUrl
    }));
}

async function runFileMoonHeadless(sourcesUrl, userAgent, parentRef, cookies) {
    console.log('🎬 Processing FileMoon with stealth mode...');
    const streams = await runStealthHosterFlow({ sourcesUrl, userAgent, parentRef, cookies });
    
    return streams.map(s => ({
        ...s,
        name: 'FileMoon',
        title: (s.type === 'hls' ? 'HLS' : 'MP4') + ' • FileMoon'
    }));
}

function detectLangAndDub(htmlChunk, url = '') {
    const low = (htmlChunk || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
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

// ✅ KLÍČOVÁ FUNKCE - parsování CZ Dabing sekce s STEALTH MODE
async function parseEpisodeHeadless(epUrl, userAgent, cookies) {
    const page = await createStealthPage();
    const hosters = [];
    const subtitles = [];

    try {
        console.log(`🥷 Stealth parsing episode: ${epUrl}`);
        await page.goto(epUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await humanDelay(1000, 2000);
        await humanScroll(page);

        // Najdi a klikni na CZ Dabing tlačítko
        const czSelectors = [
            '.langCZ',
            'div.LangHeader.langCZ',  
            '.LangHeader.langCZ',
            '[class*="langCZ"]',
            '.cz-dabing',
            '.dabing-cz'
        ];

        let czDabingClicked = false;
        for (const sel of czSelectors) {
            try {
                const el = page.locator(sel).first();
                if (await el.count() > 0) {
                    console.log(`🎯 Stealth našel CZ tlačítko: ${sel}`);
                    
                    await el.click({ timeout: 2000 });
                    console.log('✅ Stealth kliknuto na CZ Dabing tlačítko');
                    
                    await humanDelay(2000, 4000);
                    czDabingClicked = true;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
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
                        
                        if (!raw || seen.has(raw)) return;
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

            console.log(`🔍 Stealth nalezeno ${czDabingItems.length} unikátních CZ dabing položek`);

            for (const item of czDabingItems) {
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
                console.log(`🎬 CZ Dabing hoster: ${isFM ? 'FileMoon' : 'Voe'} - ${absoluteUrl}`);
                
                hosters.push({
                    kind: isFM ? 'filemoon' : 'voe',
                    url: absoluteUrl,
                    lang: 'cs',
                    dub: true
                });
            }
        }

        // Fallback parsing pokud CZ Dabing sekce selhala
        if (hosters.length === 0) {
            console.log('📺 Stealth fallback: parsing default content...');
            
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
        console.warn('❌ Stealth parseEpisodeHeadless error:', e.message);
    }

    try { await page.close(); } catch {}

    const uniqueSubtitles = Array.from(new Map(subtitles.map(s => [s.url, s])).values());
    const uniqueHosters = Array.from(new Map(hosters.map(h => [`${h.kind}|${h.url}`, h])).values());

    console.log(`📊 Stealth parsed ${uniqueHosters.length} unique hosters, ${uniqueSubtitles.length} subtitles`);
    return { hosters: uniqueHosters, subtitles: uniqueSubtitles };
}

module.exports = {
    htmlDecode,
    sanitizeUrl,
    runVoeHeadless,
    runFileMoonHeadless,
    parseEpisodeHeadless
};
