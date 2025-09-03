// utils/auth.js - KOMPLETNÍ verze se všemi funkcemi

const fetchBase = require('node-fetch');
const ToughCookie = require('tough-cookie');
const { JSDOM } = require('jsdom');

const SV_BASE = process.env.SVETSERIALU_BASE || 'https://svetserialu.io';
const SV_EMAIL = process.env.SVETSERIALU_LOGIN_EMAIL || '';
const SV_PASS = process.env.SVETSERIALU_LOGIN_PASSWORD || '';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

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
            'Accept-Language': 'cs,en;q=0.9',
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

async function svLogin() {
    if (!SV_EMAIL || !SV_PASS) {
        console.warn('SV login: chybí přihlašovací údaje (.env)');
        return false;
    }
    try {
        const fragUrl = `${SV_BASE}/user/login#calloutthis`;
        const fragHtml = await fetchHtml(fragUrl, SV_BASE);
        const doc = new JSDOM(fragHtml).window.document;
        const form = doc.querySelector('form');
        if (!form) {
            console.warn('LOGIN: ve fragmentu není <form>');
            return false;
        }
        const actionUrl = new URL(form.getAttribute('action') || '/user/login', SV_BASE).toString();
        const inputs = Array.from(form.querySelectorAll('input'));
        const params = new URLSearchParams();
        let emailKey = null;
        let passKey = null;
        for (const inp of inputs) {
            const name = inp.getAttribute('name');
            if (!name) continue;
            const type = (inp.getAttribute('type') || '').toLowerCase();
            const lname = name.toLowerCase();
            let val = inp.getAttribute('value') || '';
            if (!emailKey && (lname.includes('mail') || lname === 'login' || lname === 'email' || lname.includes('user'))) {
                emailKey = name; val = SV_EMAIL;
            } else if (!passKey && (lname.includes('pass') || type === 'password')) {
                passKey = name; val = SV_PASS;
            }
            params.set(name, val);
        }
        if (!emailKey) params.set('email', SV_EMAIL);
        if (!passKey) params.set('password', SV_PASS);
        const res = await withCookies(actionUrl, {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': fragUrl
            },
            body: params.toString(),
            redirect: 'manual'
        });
        if (![200, 302, 303].includes(res.status)) {
            console.warn('LOGIN unexpected status:', res.status);
            return false;
        }
        const afterHtml = await fetchHtml(SV_BASE, SV_BASE);
        const hasUser = !!new JSDOM(afterHtml).window.document.querySelector('.user_actions, .user-actions, a[href*="logout"], a[href*="odhl"]');
        console.log('LOGIN verify:', hasUser ? 'OK' : 'NEJISTÉ');
        return true;
    } catch (e) {
        console.error('LOGIN error:', e.message);
        return false;
    }
}

async function getTitleFromImdb(imdbId) {
    try {
        const html = await fetchHtml(`https://www.imdb.com/title/${imdbId}/`, 'https://www.imdb.com/');
        const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
        if (ld) {
            try {
                const j = JSON.parse(ld[1]);
                if (j && j.name) return String(j.name).trim();
            } catch {}
        }
        const m = html.match(/<title>([^<]+)<\/title>/i);
        if (m) return m[1].replace(/\s*\(\d{4}\)\s*-.*$/, '').trim();
    } catch (e) {
        console.warn('IMDb title fetch error:', e.message);
    }
    return null;
}

async function findSlugOnSvetserialu(title) {
    try {
        const html = await fetchHtml(`${SV_BASE}/?searchfor=${encodeURIComponent(title)}`, SV_BASE);
        const doc = new JSDOM(html).window.document;
        const anchors = Array.from(doc.querySelectorAll('a[href*="/serial/"]'));
        let best = null;
        for (const a of anchors) {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/serial\/([^\/?#]+)/i);
            if (!m) continue;
            const slug = m[1];
            const txt = (a.textContent || '').trim();
            if (txt && txt.toLowerCase() === title.toLowerCase()) return slug;
            if (!best) best = slug;
        }
        return best;
    } catch (e) {
        console.warn('findSlug error:', e.message);
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
