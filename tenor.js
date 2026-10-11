const { tenorPage, safeUrl } = require('./media-utils');

function extractTenorGif(html) {
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
        const attributes = {};
        for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attributes[match[1].toLowerCase()] = match[3];
        if (attributes.property !== 'og:image') continue;
        const url = safeUrl(attributes.content?.replace(/&amp;/g, '&'));
        if (url && url.protocol === 'https:' && !url.port &&
            /^media\d*\.tenor\.com$/.test(url.hostname) && /\.gif$/i.test(url.pathname)) return url.href;
    }
    throw new Error('GIF Tenor introuvable');
}

async function resolveTenorGif(value, fetchPage, signal) {
    if (!tenorPage(value)) throw new Error('Lien Tenor invalide');
    const url = new URL(value);
    url.search = ''; url.hash = '';
    const response = await fetchPage(url.href, {
        redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)])
    });
    if (!response.ok) throw new Error(`Tenor HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Réponse Tenor invalide');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1024 * 1024) throw new Error('Page Tenor trop volumineuse');
            chunks.push(Buffer.from(value));
        }
    } finally { await reader.cancel(); }
    return extractTenorGif(Buffer.concat(chunks).toString('utf8'));
}
module.exports = { extractTenorGif, resolveTenorGif };
