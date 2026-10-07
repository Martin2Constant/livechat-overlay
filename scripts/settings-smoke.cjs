const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const profile = path.join(__dirname, '../node_modules/.settings-smoke-profile');
app.setPath('userData', profile);
app.on('browser-window-created', (_event, window) => {
    window.show = () => {};
    window.showInactive = () => {};
    window.hide();
});
app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['wss://livechat-bot-0m01.onrender.com/*'] }, (_details, callback) => callback({ cancel: true }));
});
require('../main');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(callback) {
    for (let i = 0; i < 150; i++) { const value = await callback(); if (value) return value; await sleep(100); }
    throw new Error('Timed out');
}
(async () => {
    await app.whenReady();
    const overlay = await waitFor(() => BrowserWindow.getAllWindows().find(window => /:\d+\/$/.test(window.webContents.getURL()) && !window.webContents.isLoading()));
    await overlay.webContents.executeJavaScript('window.electronAPI.openSettings()');
    const config = await waitFor(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/settings') && !window.webContents.isLoading()));
    await waitFor(() => config.webContents.executeJavaScript('!document.getElementById("controls").disabled'));
    await config.webContents.executeJavaScript(`(async () => {
        await window.electronAPI.settingsAction('reset');
        volume.value = 37; volume.dispatchEvent(new Event('input'));
        scale.value = 95; scale.dispatchEvent(new Event('input'));
        document.querySelector('[data-position="2"]').click();
        await pending;
    })()`);
    const settings = await overlay.webContents.executeJavaScript('({ volume: currentVolume, scale: currentScale, positionIndex: currentPosIndex })');
    assert.deepEqual(settings, { volume: .37, scale: .95, positionIndex: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')), { ...settings, youtubeFormat: 'auto' });
    await config.webContents.executeJavaScript(`youtubeFormat.value = 'portrait'; youtubeFormat.dispatchEvent(new Event('change')); pending`);
    assert.equal(await overlay.webContents.executeJavaScript('currentYoutubeFormat'), 'portrait');
    await overlay.webContents.executeJavaScript('changeVolume(.1)');
    await waitFor(() => config.webContents.executeJavaScript('volume.value === "47"'));
    await config.webContents.executeJavaScript('window.electronAPI.settingsAction("preview")');
    assert.equal(await overlay.webContents.executeJavaScript('widget.style.display'), 'flex');
    await config.webContents.executeJavaScript('window.electronAPI.settingsAction("stop")');
    assert.equal(await overlay.webContents.executeJavaScript('widget.style.display'), 'none');
    await config.webContents.executeJavaScript('window.electronAPI.settingsAction("reset")');
    assert.equal(await overlay.webContents.executeJavaScript('currentScale'), .7);
    BrowserWindow.prototype.showInactive.call(config);
    await sleep(600);
    const bounds = await config.webContents.executeJavaScript('({ scroll: document.documentElement.scrollHeight, viewport: innerHeight, width:innerWidth, boxes: [...document.querySelectorAll("header, main, .shortcuts, footer")].map(x=>({tag:x.tagName,height:x.getBoundingClientRect().height})) })');
    assert.ok(bounds.scroll <= bounds.viewport, JSON.stringify(bounds));
    fs.writeFileSync(path.join(profile, 'configuration.png'), (await config.webContents.capturePage()).toPNG());
    config.close();
    await overlay.webContents.executeJavaScript('window.electronAPI.openSettings()');
    await waitFor(() => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/settings') && !window.webContents.isLoading()));
    console.log('Settings native checks passed: controls, persistence, shortcut sync, YouTube format, preview, stop, reset, layout, reopen. Testing quit button.');
    const close = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/close'));
    assert.ok(close);
    await close.webContents.executeJavaScript('document.getElementById("quit").click()').catch(() => {});
})().catch(error => { console.error(error); app.exit(1); });
