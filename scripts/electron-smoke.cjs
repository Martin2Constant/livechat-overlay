// Native Chromium checks, isolated from the production WebSocket server.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startOverlayServer } = require('../overlay-server');
app.setPath('userData', path.join(__dirname, '../node_modules/.smoke-profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
ipcMain.handle('load-settings', () => null);
ipcMain.handle('save-settings', () => {});
let server;
const deadline = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 55000);
app.whenReady().then(async () => {
    const local = await startOverlayServer(path.join(__dirname, '..'));
    server = local.server;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['wss://livechat-bot-0m01.onrender.com/*'] }, (_details, callback) => callback({ cancel: true }));
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, '../preload.js') } });
    const errors = [];
    window.webContents.on('console-message', details => {
        if (details?.level === 'error') errors.push(details.message);
    });
    await window.loadURL(local.origin + '/');
    const result = await window.webContents.executeJavaScript(`(async () => {
        await handleMessage({ data: JSON.stringify({ type: 'play_media', text: '<b>test</b>', author: 'Smoke' }) });
        changeSize(0.1);
        cyclePosition();
        const result = { text: textContainer.textContent, author: authorName.textContent, visible: widget.style.display, bridge: typeof window.electronAPI.loadSettings };
        await handleMessage({ data: JSON.stringify({ type: 'play_media', url: 'javascript:alert(1)' }) });
        result.invalid = textContainer.textContent;
        hideWidget();
        return result;
    })()`);
    assert.equal(result.text, '<b>test</b>');
    assert.equal(result.author, 'Smoke');
    assert.equal(result.visible, 'flex');
    assert.equal(result.bridge, 'function');
    assert.match(result.invalid, /impossible/);
    console.log('Native Electron DOM/preload/CSP smoke checks passed');
    if (process.env.LIVE_YOUTUBE === '1') {
        const youtube = await window.webContents.executeJavaScript(`(async () => {
            await handleMessage({ data: JSON.stringify({ type: 'play_media', url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE' }) });
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                if (youtubeReady && youtubePlayer?.getPlayerState() === 1) {
                    const result = { state: 'playing', time: youtubePlayer.getCurrentTime(), volume: youtubePlayer.getVolume() };
                    changeVolume(-0.2);
                    await new Promise(resolve => setTimeout(resolve, 700));
                    result.adjustedVolume = youtubePlayer.getVolume();
                    result.laterTime = youtubePlayer.getCurrentTime();
                    hideWidget();
                    return result;
                }
                if (!youtubePlayer) return { state: 'failed', message: textContainer.innerText };
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            return { state: 'timeout', ready: youtubeReady, message: textContainer.innerText };
        })()`);
        console.log('Live YouTube result:', JSON.stringify(youtube));
        assert.equal(youtube.state, 'playing');
        assert.equal(youtube.adjustedVolume, 80);
        assert.ok(youtube.laterTime > youtube.time);
    }
    console.log('Renderer error logs:', JSON.stringify(errors));
    window.destroy();
    server.close();
    clearTimeout(deadline);
    app.exit(0);
}).catch(error => { console.error(error); server?.close(); clearTimeout(deadline); app.exit(1); });
