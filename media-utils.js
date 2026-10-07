(function (root) {
    function safeUrl(value) {
        if (typeof value !== 'string' || value.length > 8192) return null;
        try {
            const url = new URL(value);
            return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
        } catch { return null; }
    }

    function hostMatches(url, domains) {
        return domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
    }

    function youtubeVideo(value) {
        const url = safeUrl(value);
        if (!url) return null;
        let id;
        if (hostMatches(url, ['youtu.be'])) id = url.pathname.split('/')[1];
        else if (hostMatches(url, ['youtube.com', 'youtube-nocookie.com'])) {
            if (url.pathname === '/watch') id = url.searchParams.get('v');
            else id = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1];
        }
        if (!/^[\w-]{11}$/.test(id || '')) return null;
        const time = url.searchParams.get('start') || url.searchParams.get('t') || new URLSearchParams(url.hash.slice(1)).get('t') || '';
        const match = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
        const seconds = /^\d+$/.test(time) ? Number(time) : match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
        return { id, start: Number.isSafeInteger(seconds) ? seconds : 0, ...(/^\/shorts\//.test(url.pathname) ? { portrait: true } : {}) };
    }

    const api = { safeUrl, hostMatches, youtubeVideo };
    if (typeof module !== 'undefined') module.exports = api;
    else root.MediaUtils = api;
})(globalThis);
