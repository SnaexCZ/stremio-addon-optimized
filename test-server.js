// test-server.js - Hlavní server s port fix pro Render.com

require('dotenv').config();

const http = require('http');
const url = require('url');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetchBase = require('node-fetch');

const { handleStream } = require('./handlers/stream');

// ✅ KLÍČOVÁ OPRAVA: Použij Render PORT pro addon server
const PORT_ADDON = process.env.PORT || 10000;  // Render default
const PORT_PROXY = process.env.PORT_PROXY || 7160;  // Proxy zůstává

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Stats tracking
let requestCount = 0;
let lastUsed = new Date();
const startTime = new Date();

// Manifest
const manifest = {
    id: 'io.svetserialu.addon.stealth',
    version: '2.5.0',
    name: 'Svět Seriálů CZ STEALTH',
    description: 'České seriály s anti-bot ochranou - Stealth Mode',
    catalogs: [],
    resources: ['stream'],
    types: ['series'],
    idPrefixes: ['tt']
};

function createHlsProxy(originalUrl) {
    return async (req, res) => {
        try {
            const response = await fetchBase(originalUrl, {
                headers: { 'User-Agent': UA }
            });
            
            if (!response.ok) {
                res.statusCode = response.status;
                res.end();
                return;
            }

            let content = await response.text();
            const contentType = response.headers.get('content-type') || 'application/vnd.apple.mpegurl';

            if (content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA')) {
                console.log('📺 Processing HLS master playlist for CZ priority...');
                
                content = content.replace(
                    /#EXT-X-MEDIA:([^\n\r]*LANGUAGE="cs"[^\n\r]*)/gi,
                    (match, params) => {
                        let newParams = params
                            .replace(/DEFAULT=(?:YES|NO)/gi, '')
                            .replace(/AUTOSELECT=(?:YES|NO)/gi, '');
                        
                        newParams += ',DEFAULT=YES,AUTOSELECT=YES';
                        return `#EXT-X-MEDIA:${newParams}`;
                    }
                );

                content = content.replace(
                    /#EXT-X-MEDIA:([^\n\r]*LANGUAGE="(?!cs")[^"]*"[^\n\r]*)/gi,
                    (match, params) => {
                        let newParams = params
                            .replace(/DEFAULT=YES/gi, 'DEFAULT=NO')
                            .replace(/AUTOSELECT=YES/gi, 'AUTOSELECT=NO');
                        return `#EXT-X-MEDIA:${newParams}`;
                    }
                );

                console.log('✅ HLS master processed - CZ priority set');
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.end(content);

        } catch (e) {
            console.error('❌ HLS proxy error:', e.message);
            res.statusCode = 500;
            res.end('HLS Proxy Error');
        }
    };
}

function createMp4Proxy(originalUrl) {
    return async (req, res) => {
        try {
            const headers = { 'User-Agent': UA };
            
            if (req.headers.range) {
                headers['Range'] = req.headers.range;
            }

            const response = await fetchBase(originalUrl, { headers });
            
            Object.keys(response.headers.raw()).forEach(key => {
                res.setHeader(key, response.headers.get(key));
            });
            
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.statusCode = response.status;
            
            response.body.pipe(res);

        } catch (e) {
            console.error('❌ MP4 proxy error:', e.message);
            res.statusCode = 500;
            res.end('MP4 Proxy Error');
        }
    };
}

const builder = new addonBuilder(manifest);
builder.defineStreamHandler((args) => {
    requestCount++;
    lastUsed = new Date();
    console.log(`🔍 Stream request #${requestCount}: ${args.type} ${args.id}`);
    return Promise.resolve(handleStream(args));
});

// ✅ KLÍČOVÁ OPRAVA: Bind na 0.0.0.0 místo localhost
async function startAddonServer() {
    console.log(`🚀 Starting STEALTH addon server on port ${PORT_ADDON}...`);
    serveHTTP(builder.getInterface(), { 
        port: PORT_ADDON,
        host: '0.0.0.0'  // ✅ DŮLEŽITÉ pro Render
    });
    console.log(`✅ Addon running at: http://0.0.0.0:${PORT_ADDON}/manifest.json`);
}

async function startProxyServer() {
    console.log(`🔧 Starting proxy server on port ${PORT_PROXY}...`);
    
    const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        
        // 🩺 HEALTH CHECK ENDPOINT s kompletními statistikami
        if (parsedUrl.pathname === '/health') {
            try {
                // Test dostupnosti cache utility
                let cacheStatus = 'healthy';
                let cacheSize = 0;
                try {
                    const cache = require('./utils/cache');
                    cacheSize = cache.size();
                } catch (e) {
                    cacheStatus = 'error';
                    console.warn('Cache test failed:', e.message);
                }

                // Memory usage v MB
                const mem = process.memoryUsage();
                const memoryMB = {
                    rss: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
                    heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
                    heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
                    external: Math.round(mem.external / 1024 / 1024 * 100) / 100,
                    arrayBuffers: mem.arrayBuffers ? Math.round(mem.arrayBuffers / 1024 / 1024 * 100) / 100 : 0
                };

                // CPU usage
                const cpuUsage = process.cpuUsage();
                
                // Uptime calculations
                const uptimeSeconds = Math.floor(process.uptime());
                const uptimeFormatted = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;
                
                // Posledni aktivita
                const lastUsedAgo = Math.floor((Date.now() - lastUsed) / 1000);
                const lastUsedFormatted = lastUsedAgo < 60 ? `${lastUsedAgo}s ago` : 
                                         lastUsedAgo < 3600 ? `${Math.floor(lastUsedAgo / 60)}m ago` :
                                         `${Math.floor(lastUsedAgo / 3600)}h ago`;

                // Status determination
                const isHealthy = cacheStatus === 'healthy' && memoryMB.heapUsed < 400;
                
                const healthData = {
                    status: isHealthy ? 'OK' : 'WARNING',
                    timestamp: new Date().toISOString(),
                    mode: 'STEALTH',
                    uptime: {
                        seconds: uptimeSeconds,
                        formatted: uptimeFormatted,
                        since: startTime.toISOString()
                    },
                    version: '2.5.0',
                    ports: {
                        addon: PORT_ADDON,
                        proxy: PORT_PROXY
                    },
                    components: {
                        addon: 'healthy',
                        proxy: 'healthy',
                        cache: cacheStatus,
                        stealth: 'enabled',
                        antibot: 'active'
                    },
                    memory: {
                        rss_mb: memoryMB.rss,
                        heap_total_mb: memoryMB.heapTotal,
                        heap_used_mb: memoryMB.heapUsed,
                        external_mb: memoryMB.external,
                        array_buffers_mb: memoryMB.arrayBuffers,
                        usage_percentage: Math.round((memoryMB.heapUsed / memoryMB.heapTotal) * 100)
                    },
                    cpu: {
                        user_microseconds: cpuUsage.user,
                        system_microseconds: cpuUsage.system
                    },
                    activity: {
                        total_requests: requestCount,
                        last_request: lastUsed.toISOString(),
                        last_request_ago: lastUsedFormatted,
                        cache_entries: cacheSize
                    },
                    environment: {
                        node_version: process.version,
                        platform: process.platform,
                        arch: process.arch,
                        env: process.env.NODE_ENV || 'development'
                    }
                };

                res.statusCode = isHealthy ? 200 : 503;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'no-cache');
                res.end(JSON.stringify(healthData, null, 2));
                return;
                
            } catch (e) {
                console.error('Health check error:', e.message);
                res.statusCode = 503;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    status: 'ERROR',
                    message: e.message,
                    timestamp: new Date().toISOString(),
                    uptime_seconds: Math.floor(process.uptime())
                }, null, 2));
                return;
            }
        }
        
        // HLS Proxy
        if (parsedUrl.pathname === '/hls-proxy') {
            const targetUrl = parsedUrl.query.url;
            if (targetUrl) {
                createHlsProxy(targetUrl)(req, res);
            } else {
                res.statusCode = 400;
                res.end('Missing URL parameter');
            }
        } 
        // MP4 Proxy
        else if (parsedUrl.pathname === '/mp4-proxy') {
            const targetUrl = parsedUrl.query.url;
            if (targetUrl) {
                createMp4Proxy(targetUrl)(req, res);
            } else {
                res.statusCode = 400;
                res.end('Missing URL parameter');
            }
        } 
        // 404 Not Found
        else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                error: 'Not Found',
                available_endpoints: [
                    '/health',
                    '/hls-proxy?url=<encoded_url>',
                    '/mp4-proxy?url=<encoded_url>'
                ]
            }, null, 2));
        }
    });

    // ✅ KLÍČOVÁ OPRAVA: Bind na 0.0.0.0
    server.listen(PORT_PROXY, '0.0.0.0', () => {
        console.log(`✅ Proxy server running on 0.0.0.0:${PORT_PROXY}`);
        console.log(`🩺 Health check: http://0.0.0.0:${PORT_PROXY}/health`);
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 Received SIGTERM, shutting down gracefully...');
    const { closeBrowser } = require('./scraper/stealth');
    closeBrowser().then(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('📴 Received SIGINT, shutting down gracefully...');
    const { closeBrowser } = require('./scraper/stealth');
    closeBrowser().then(() => {
        process.exit(0);
    });
});

// Periodické logování memory usage (každých 10 minut)
setInterval(() => {
    const mem = process.memoryUsage();
    const memMB = Math.round(mem.heapUsed / 1024 / 1024);
    const hoursInactive = Math.floor((Date.now() - lastUsed) / (1000 * 60 * 60));
    
    console.log(`📊 Stats: ${requestCount} requests, ${memMB}MB heap, last used ${hoursInactive}h ago`);
}, 600000); // 10 minut

// Startup
(async () => {
    try {
        await startAddonServer();
        await startProxyServer();
        
        console.log('\n🥷 STEALTH MODE addon ready - ANTI-BOT PROTECTION ACTIVE!');
        console.log(`📺 Addon URL: http://0.0.0.0:${PORT_ADDON}/manifest.json`);
        console.log(`🔧 Proxy URL: http://0.0.0.0:${PORT_PROXY}/`);
        console.log(`🩺 Health check: http://0.0.0.0:${PORT_PROXY}/health`);
        console.log(`\n🌐 Public URLs will be:`);
        console.log(`📺 https://your-app.onrender.com/manifest.json`);
        console.log(`🩺 https://your-app.onrender.com/health`);
        console.log('\n🥷 STEALTH FEATURES:');
        console.log('- ✅ Anti-bot detection bypass');
        console.log('- ✅ Stealth browser fingerprinting');
        console.log('- ✅ Human-like behavior simulation');
        console.log('- ✅ Advanced login protection');
        console.log('- ✅ Smart search evasion');
        
    } catch (e) {
        console.error('❌ Startup error:', e.message);
        process.exit(1);
    }
})();
