// handlers/stream.js - Stream handling s podporou stealth mode

const { 
    parseEpisodeHeadless,
    runVoeHeadless,
    runFileMoonHeadless
} = require('../scraper/helpers');

const { get: getCache, set: setCache } = require('../utils/cache');
const { 
    svLogin,
    getTitleFromImdb,
    findSlugOnSvetserialu,
    getPlaywrightCookiesFor,
    buildEpisodeUrl,
    getResolutionFromUrl,
    delay
} = require('../utils/auth');

const SV_BASE = process.env.SVETSERIALU_BASE || 'https://svetserialu.io';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PORT_PROXY = process.env.PORT_PROXY || 7160;

async function getStreamsForEpisode(slug, season, episode) {
    console.log(`🎬 Getting streams for: ${slug} S${season}E${episode}`);
    
    const epUrl = buildEpisodeUrl(slug, season, episode);
    const cookies = await getPlaywrightCookiesFor(SV_BASE);
    
    try {
        const episodeData = await parseEpisodeHeadless(epUrl, UA, cookies);
        const hosters = episodeData.hosters || [];
        const subtitles = episodeData.subtitles || [];
        
        console.log(`📊 Found ${hosters.length} unique hosters:`);
        hosters.forEach(h => {
            console.log(`  - ${h.kind}: ${h.dub ? 'DABING' : 'TITULKY'} (${h.lang || 'unknown'})`);
        });

        const allStreams = [];
        
        const sortedHosters = hosters.sort((a, b) => {
            if (a.dub && !b.dub) return -1;
            if (!a.dub && b.dub) return 1;
            if (a.lang === 'cs' && b.lang !== 'cs') return -1;
            if (a.lang !== 'cs' && b.lang === 'cs') return 1;
            return 0;
        });

        // SEKVENČNÍ ZPRACOVÁNÍ VŠECH HOSTERŮ
        for (const hoster of sortedHosters) {
            console.log(`🎭 Processing ${hoster.kind} (${hoster.dub ? 'dabing' : 'titulky'})...`);
            
            try {
                let sources = [];
                
                if (hoster.kind === 'voe') {
                    sources = await runVoeHeadless(hoster.url, UA, epUrl, cookies);
                } else if (hoster.kind === 'filemoon') {
                    // Zpracovat FileMoon pouze pro CZ dabing
                    if (hoster.dub && hoster.lang === 'cs') {
                        console.log('🎬 Processing FileMoon for CZ dabing...');
                        sources = await runFileMoonHeadless(hoster.url, UA, epUrl, cookies);
                    } else {
                        console.log('⚡ Skipping FileMoon for non-CZ streams');
                        continue;
                    }
                }

                for (const src of sources) {
                    if (!src.url || src.url.length < 10) continue;
                    
                    // Filtr testovacích videí
                    if (src.url.includes('test-videos.co.uk') || 
                        src.url.includes('example.com') ||
                        src.url.includes('sample') ||
                        src.url.includes('demo')) {
                        console.log(`⚠️ Skipping test video: ${src.url.slice(0, 50)}...`);
                        continue;
                    }
                    
                    console.log(`🔍 Analyzing: ${src.url.slice(0, 100)}...`);
                    
                    // Detekce jazyka podle kontextu
                    const urlToAnalyze = src.originalIframeUrl || src.url;
                    console.log(`🔍 Hoster context: dub=${hoster.dub}, lang=${hoster.lang}`);

                    let actualLanguage = 'en';
                    let hasSubtitles = false;

                    if (urlToAnalyze.includes('subtitles[]') || urlToAnalyze.includes('subtitles%5B%5D') || 
                        urlToAnalyze.includes('overrideSubtitles=true')) {
                        hasSubtitles = true;
                        console.log('📝 Stream má titulky');
                        
                        // Detekce podle CZ Dabing kontextu
                        if (hoster.dub && hoster.lang === 'cs') {
                            if (urlToAnalyze.includes('Forced;fcd')) {
                                actualLanguage = 'cz';
                                hasSubtitles = false;
                                console.log('🔤 Detekován český dabing (forced titulky)');
                            } else if (urlToAnalyze.includes('CZSK;cs') && urlToAnalyze.includes('English;en')) {
                                actualLanguage = 'en';
                                console.log('🔤 Detekován anglický originál (CZ + EN titulky)');
                            } else if (urlToAnalyze.includes('CZSK;cs')) {
                                actualLanguage = 'cz';
                                console.log('🔤 Detekován český obsah (pouze CZ titulky)');
                            } else {
                                actualLanguage = 'cz';
                                console.log('🔤 Detekován český dabing (fallback)');
                            }
                        } else {
                            if (urlToAnalyze.includes('CZSK;cs')) {
                                actualLanguage = 'cz';
                                console.log('🔤 Detekován český obsah (mimo CZ sekci)');
                            } else {
                                actualLanguage = 'en';
                                console.log('🔤 Detekován anglický obsah');
                            }
                        }
                    } else {
                        // Bez titulků
                        if (hoster.dub && hoster.lang === 'cs') {
                            actualLanguage = 'cz';
                            console.log('🎤 Stream z CZ Dabing sekce → český dabing');
                        } else {
                            actualLanguage = 'en';
                            console.log('🎤 Stream bez titulků → anglický');
                        }
                    }

                    // Sestavení popisků
                    let streamLabel, quality;
                    if (actualLanguage === 'cz' && !hasSubtitles) {
                        streamLabel = 'CZ';
                        quality = 'CZ DABING';
                    } else if (actualLanguage === 'cz' && hasSubtitles) {
                        streamLabel = 'CZ';
                        quality = 'CZ TITULKY';
                    } else {
                        streamLabel = 'ENG';
                        quality = 'EN ORIGINAL';
                    }

                    console.log(`✅ Final: ${streamLabel} (${quality})`);

                    // Tvorba stream URL s proxy
                    const proxyUrl = src.type === 'hls' 
                        ? `http://localhost:${PORT_PROXY}/hls-proxy?url=${encodeURIComponent(src.url)}`
                        : `http://localhost:${PORT_PROXY}/mp4-proxy?url=${encodeURIComponent(src.url)}`;

                    // Získání rozlišení
                    let resolution = null;
                    console.log(`🔍 Getting resolution for ${src.type}: ${src.url.slice(0, 50)}...`);
                    resolution = await getResolutionFromUrl(src.url, src.type);

                    // Sestavení názvu s rozlišením
                    let streamName = `${src.name} • ${streamLabel}`;
                    if (resolution) {
                        streamName += ` ${resolution}`;
                        console.log(`📺 Added resolution: ${resolution}`);
                    }

                    const stream = {
                        name: streamName,
                        title: streamName,
                        url: proxyUrl,
                        originalUrl: src.url,
                        quality: quality,
                        hosterKind: hoster.kind,
                        streamLabel: streamLabel,
                        behaviorHints: {
                            bingeGroup: `${slug}-${streamLabel}`,
                            notWebReady: src.type !== 'hls'
                        }
                    };

                    // Přidání titulků pokud jsou dostupné
                    if (hasSubtitles && subtitles.length > 0) {
                        stream.subtitles = subtitles.map(sub => ({
                            url: sub.url,
                            lang: sub.lang,
                            label: sub.label
                        }));
                    }

                    allStreams.push(stream);
                    console.log(`✅ Added stream: ${stream.name} (${stream.hosterKind})`);
                }

            } catch (e) {
                console.error(`❌ Error processing ${hoster.kind}:`, e.message);
                continue;
            }
        }

        // Deduplikace streamů
        console.log(`🔄 Deduplicating ${allStreams.length} streams...`);
        
        const uniqueStreams = [];
        const seenKeys = new Set();
        
        for (const stream of allStreams) {
            const baseUrl = stream.originalUrl.split('?')[0];
            const uniqueKey = `${baseUrl}|${stream.quality}|${stream.streamLabel}`;
            
            if (!seenKeys.has(uniqueKey)) {
                seenKeys.add(uniqueKey);
                uniqueStreams.push(stream);
                console.log(`✅ Kept unique: ${stream.name}`);
            } else {
                console.log(`⚠️ Skipped duplicate: ${stream.name}`);
            }
        }

        // Finální validace
        const validStreams = uniqueStreams.filter(stream => {
            if (!stream.originalUrl || stream.originalUrl.length < 20) {
                console.log(`⚠️ Filtered invalid URL: ${stream.name}`);
                return false;
            }
            return true;
        });

        console.log(`✅ Returning ${validStreams.length} unique validated streams`);
        return validStreams;

    } catch (e) {
        console.error('❌ getStreamsForEpisode error:', e.message);
        return [];
    }
}

async function handleStream({ type, id }) {
    try {
        if (type !== 'series') return { streams: [] };
        const mm = /^(tt\d+):(\d+):(\d+)$/.exec(id || '');
        if (!mm) {
            console.warn('Bad id format:', id);
            return { streams: [] };
        }
        
        const imdb = mm[1];
        const season = Number(mm[2]);
        const episode = Number(mm[3]);
        
        console.log('🔍 Processing:', imdb, 'S' + season + 'E' + episode);
        
        // Check cache first
        const cacheKey = `${imdb}-${season}-${episode}`;
        const cached = getCache(cacheKey);
        if (cached) {
            console.log('💾 Returning cached streams');
            return { streams: cached };
        }
        
        // STEALTH LOGIN před každým requestem
        const loginSuccess = await svLogin();
        if (!loginSuccess) {
            console.warn('⚠️ Stealth login failed, trying anyway...');
        }
        
        await delay(1000);
        
        if (!/^tt\d+$/.test(imdb) || !Number.isFinite(season) || !Number.isFinite(episode)) {
            console.warn('Invalid parsed values:', { imdb, season, episode });
            return { streams: [] };
        }
        
        const title = await getTitleFromImdb(imdb);
        if (!title) {
            console.warn('IMDb title not found for', imdb);
            return { streams: [] };
        }
        
        const slug = await findSlugOnSvetserialu(title);
        if (!slug) {
            console.warn('Slug not found for title', title);
            return { streams: [] };
        }
        
        const streams = await getStreamsForEpisode(slug, season, episode);
        
        // Cache successful results
        if (streams.length > 0) {
            setCache(cacheKey, streams, 300000); // 5 minutes
        }
        
        console.log(`✅ Returning ${streams.length} streams`);
        return { streams };
        
    } catch (e) {
        console.error('❌ handleStream error:', e.message);
        return { streams: [] };
    }
}

module.exports = {
    handleStream,
    getStreamsForEpisode
};
