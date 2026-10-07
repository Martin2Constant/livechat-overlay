const { app, BrowserWindow, session, screen, globalShortcut, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { startOverlayServer } = require('./overlay-server');
const { safeUrl } = require('./media-utils');
let overlayServer;
let overlayOrigin;
let topmostInterval;
let cancelInstagramScrape = null;

function trustedSender(event) {
  return mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && event.senderFrame.url === overlayOrigin + '/';
}

// --- PERSISTANCE DES RÉGLAGES (volume, taille, position) ---
// Stocké dans le dossier de données utilisateur de l'app (pas dans le dossier
// du projet), pour survivre aux mises à jour et être au bon endroit une fois
// l'app packagée.
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettingsFromDisk() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    // Pas de fichier encore (premier lancement) ou fichier corrompu : le
    // renderer utilisera ses valeurs par défaut.
    return null;
  }
}

function saveSettingsToDisk(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporaryPath = settingsPath + '.tmp';
    fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(temporaryPath, settingsPath);
  } catch (e) {
    console.error('[Réglages] Impossible de sauvegarder les réglages :', e.message || e);
  }
}

ipcMain.handle('load-settings', (event) => {
  if (!trustedSender(event)) return null;
  return loadSettingsFromDisk();
});

ipcMain.handle('save-settings', (event, settings) => {
  if (!trustedSender(event) || !settings || !Number.isFinite(settings.volume) || !Number.isFinite(settings.scale) || !Number.isInteger(settings.positionIndex)) return;
  saveSettingsToDisk({ volume: Math.max(0, Math.min(1, settings.volume)), scale: Math.max(0.3, Math.min(1.5, settings.scale)), positionIndex: Math.max(0, Math.min(3, settings.positionIndex)) });
});

// Désactivation de l'accélération matérielle pour réparer les écrans noirs
app.disableHardwareAcceleration();

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow;
let tray = null;

// NOUVEAU : résolution des vidéos Instagram via une fenêtre Electron invisible.
// Instagram injecte la balise <video> via JavaScript après le chargement de la page ;
// un simple fetch() ne suffit pas. On ouvre donc la page dans une vraie fenêtre Chromium
// cachée (Electron EST un navigateur), on la laisse s'exécuter, puis on récupère le
// résultat, exactement comme si un humain avait ouvert le lien manuellement.
// User-Agent "normal" (Chrome desktop) : par défaut Electron ajoute sa propre
// signature ("Electron/42.x") à la fin du User-Agent, ce qui permet à Instagram
// de repérer instantanément qu'il ne s'agit pas d'un vrai navigateur et de
// répondre par un mur de connexion ("Log in to see this content") au lieu de
// la page normale. On usurpe donc un User-Agent Chrome classique.
const FAKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function scrapeInstagramVideo(embedUrl) {
  cancelInstagramScrape?.();
  return new Promise((resolve) => {
    const scraperWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: 'instagram-scraper'
      }
    });

    scraperWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    scraperWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

    // On renvoie les console.log/warn/error de la fenêtre de scraping vers ce
    // terminal : sans ça, impossible de savoir pourquoi l'extraction échoue.
    scraperWindow.webContents.on('console-message', ({ level, message }) => {
      console.log(`[Instagram Scraper - ${level}] ${message}`);
    });

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      cancelInstagramScrape = null;
      clearTimeout(timeout);
      resolve(result);
      if (!scraperWindow.isDestroyed()) {
        scraperWindow.destroy();
      }
    };

    // Sécurité : si jamais ça bloque, on abandonne après 20 secondes
    const timeout = setTimeout(() => finish(null), 20000);
    cancelInstagramScrape = () => finish(null);

    scraperWindow.webContents.once('did-finish-load', async () => {
      try {
        // On sonde la page plusieurs fois (au lieu d'un unique délai fixe de 1.5s)
        // car le temps d'hydratation de la page Instagram peut varier.
        const result = await scraperWindow.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            for (let i = 0; i < 10; i++) {
              const video = document.querySelector('video');
              const src = video ? (video.currentSrc || video.src) : null;

              if (src && !src.startsWith('blob:')) {
                return { status: 'ok', url: src };
              }

              // Solution de repli : la balise meta og:video contient parfois
              // l'URL directe même quand <video> n'est pas encore rempli.
              const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"]');
              if (ogVideo && ogVideo.content) {
                return { status: 'ok', url: ogVideo.content };
              }

              if (src && src.startsWith('blob:')) {
                // Une src en blob: existe mais n'est pas exploitable telle quelle
                // (elle n'a de sens que dans cette fenêtre cachée). On continue
                // à sonder au cas où une vraie URL apparaisse.
                console.warn('Balise <video> trouvée mais avec une src blob: (non utilisable telle quelle), nouvelle tentative...');
              }

              await sleep(500);
            }

            const bodyText = document.body ? document.body.innerText.slice(0, 300) : '';
            if (/log in|connexion|connecte-toi|se connecter/i.test(bodyText)) {
              return { status: 'login_wall', text: bodyText };
            }

            return { status: 'not_found', text: bodyText };
          })()
        `);

        clearTimeout(timeout);

        if (result.status === 'ok') {
          finish(result.url);
        } else if (result.status === 'login_wall') {
          console.error('[Instagram] Mur de connexion détecté : Instagram demande de se connecter pour voir ce contenu.');
          finish(null);
        } else {
          console.error('[Instagram] Aucune vidéo trouvée après 5s de sondage. Extrait de la page :', result.text);
          finish(null);
        }
      } catch (e) {
        clearTimeout(timeout);
        console.error('[Instagram] Erreur JS pendant le scraping :', e.message || e);
        finish(null);
      }
    });

    scraperWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      clearTimeout(timeout);
      console.error(`[Instagram] Échec du chargement de la page (${errorCode}: ${errorDescription})`);
      finish(null);
    });

    scraperWindow.webContents.setUserAgent(FAKE_USER_AGENT);
    scraperWindow.loadURL(embedUrl, { userAgent: FAKE_USER_AGENT }).catch(() => finish(null));
  });
}

ipcMain.handle('resolve-instagram-video', async (event, url) => {
  if (!trustedSender(event)) return null;
  const parsed = safeUrl(url);
  if (!parsed || parsed.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(parsed.hostname) || parsed.port || !/^\/(reel|p|tv)\/[\w-]+\/embed\/captioned\/$/.test(parsed.pathname)) return null;
  return await scrapeInstagramVideo(parsed.href);
});

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('Livechat Overlay');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Livechat Overlay', enabled: false },
    { type: 'separator' },
    {
      label: 'Changer de position',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('cyclePosition()');
        }
      }
    },
    {
      label: 'Agrandir (+10%)',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('changeSize(0.1)');
        }
      }
    },
    {
      label: 'Réduire (-10%)',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('changeSize(-0.1)');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Volume +10%',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('changeVolume(0.1)');
        }
      }
    },
    {
      label: 'Volume -10%',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('changeVolume(-0.1)');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Arrêter le média (Ctrl+Alt+X)',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.executeJavaScript('hideWidget()');
      }
    },
    {
      label: 'Quitter',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Double-clic sur l'icône = raccourci pratique pour changer de position
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('cyclePosition()');
    }
  });
}

function createWindow () {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.setIgnoreMouseEvents(true);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.loadURL(overlayOrigin + '/').catch(error => { console.error(error); app.quit(); });

  // NOUVEAU : on renvoie les logs de la fenêtre (console.log/warn/error du HTML)
  // directement dans ce terminal, pour pouvoir diagnostiquer les soucis d'extraction
  // de vidéos (Twitter/TikTok/Instagram) sans avoir à ouvrir les DevTools.
  mainWindow.webContents.on('console-message', ({ level, message }) => {
    console.log(`[Overlay - ${level}] ${message}`);
  });


  topmostInterval = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 5000);
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  const local = await startOverlayServer(__dirname);
  overlayServer = local.server;
  overlayOrigin = local.origin;
  createWindow();
  screen.on('display-metrics-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
  });
  createTray();

  if (app.isPackaged) app.setLoginItemSettings({
    openAtLogin: true,
    path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')
  });

  // Raccourci pour changer de position (Déjà existant)
  globalShortcut.register('CommandOrControl+Alt+X', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.executeJavaScript('hideWidget()');
  });

  globalShortcut.register('CommandOrControl+Alt+P', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('cyclePosition()');
    }
  });

  // NOUVEAU : Raccourci pour Agrandir (Flèche Haut)
  globalShortcut.register('CommandOrControl+Alt+Up', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('changeSize(0.1)'); // +10%
    }
  });

  // NOUVEAU : Raccourci pour Réduire (Flèche Bas)
  globalShortcut.register('CommandOrControl+Alt+Down', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('changeSize(-0.1)'); // -10%
    }
  });

  // NOUVEAU : Raccourci pour Volume + (Flèche Droite)
  globalShortcut.register('CommandOrControl+Alt+Right', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('changeVolume(0.1)'); // +10%
    }
  });

  // NOUVEAU : Raccourci pour Volume - (Flèche Gauche)
  globalShortcut.register('CommandOrControl+Alt+Left', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('changeVolume(-0.1)'); // -10%
    }
  });
}).catch(error => { console.error('[Démarrage]', error); app.quit(); });

app.on('before-quit', () => {
  clearInterval(topmostInterval);
  globalShortcut.unregisterAll();
  overlayServer?.close();
  if (tray) {
    tray.destroy();
  }
});
