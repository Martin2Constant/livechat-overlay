const { contextBridge, ipcRenderer } = require('electron');

// On expose uniquement cette fonction précise à la fenêtre (index.html),
// rien d'autre de Node/Electron n'est accessible depuis le HTML (sécurité).
contextBridge.exposeInMainWorld('electronAPI', {
    resolveInstagramVideo: (url) => ipcRenderer.invoke('resolve-instagram-video', url),
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    openSettings: () => ipcRenderer.invoke('open-settings'),
    quitOverlay: () => ipcRenderer.invoke('quit-overlay'),
    settingsAction: (action) => ipcRenderer.invoke('settings-action', action),
    onSettingsChanged: (callback) => {
        const listener = (_event, settings) => callback(settings);
        ipcRenderer.on('settings-changed', listener);
        return () => ipcRenderer.removeListener('settings-changed', listener);
    }
});

