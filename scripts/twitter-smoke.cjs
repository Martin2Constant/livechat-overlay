const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startOverlayServer } = require('../overlay-server');
const { configureMediaRequests } = require('../media-network');
app.setPath('userData', path.join(__dirname, '../node_modules/.twitter-smoke-profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let server;
const deadline = setTimeout(() => app.exit(1), 55000);
app.whenReady().then(async () => {
    const local = await startOverlayServer(path.join(__dirname, '..'));
    server = local.server;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['wss://livechat-bot-0m01.onrender.com/*'] }, (_details, callback) => callback({ cancel: true }));
    session.defaultSession.webRequest.onCompleted({ urls: ['https://api.vxtwitter.com/*', 'https://api.fxtwitter.com/*', 'https://video.twimg.com/*'] }, details => {
        console.log('Twitter HTTP:', details.statusCode, details.url);
    });
    configureMediaRequests(session.defaultSession);
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    window.webContents.on('console-message', ({ level, message }) => { if (level !== 'info') console.log(level, message); });
    await window.loadURL(local.origin + '/');
    const url = process.env.TWITTER_URL || 'https://x.com/LucAuffret/status/2107547212154626398';
    const result = await window.webContents.executeJavaScript(`(async () => {
        await handleMessage({data: JSON.stringify({type:'play_media', url: ${JSON.stringify(url)}})});
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            const video = container.querySelector('video');
            if (video && video.currentTime > 0.2 && !video.paused) {
                const result = { playing:true, time:video.currentTime, width:video.videoWidth, height:video.videoHeight };
                hideWidget();
                return result;
            }
            if (!video) return {playing:false, text:textContainer.textContent};
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return {playing:false, text:textContainer.textContent};
    })()`);
    console.log('Twitter playback:', JSON.stringify(result));
    assert.equal(result.playing, true);
    window.destroy();
    server.close();
    clearTimeout(deadline);
    app.exit(0);
}).catch(error => { console.error(error); server?.close(); clearTimeout(deadline); app.exit(1); });
