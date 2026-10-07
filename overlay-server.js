const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// A real parent origin supplies YouTube's required Referer. Only these assets
// are served, on loopback, never the project directory or user settings.
function startOverlayServer(directory) {
    const files = new Map([
        ['/', ['index.html', 'text/html; charset=utf-8']],
        ['/renderer.js', ['renderer.js', 'text/javascript; charset=utf-8']],
        ['/media-utils.js', ['media-utils.js', 'text/javascript; charset=utf-8']]
    ]);
    const server = http.createServer((req, res) => {
        const host = `127.0.0.1:${server.address().port}`;
        const asset = files.get(req.url);
        if (req.headers.host !== host || !asset || !['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(404).end();
            return;
        }
        res.setHeader('Content-Type', asset[1]);
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline'; img-src http: https:; media-src http: https:; connect-src https: wss:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        fs.readFile(path.join(directory, asset[0]), (error, data) => {
            if (error) res.writeHead(500).end();
            else res.end(req.method === 'HEAD' ? undefined : data);
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
    });
}
module.exports = { startOverlayServer };
