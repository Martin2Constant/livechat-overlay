const { app, BrowserWindow, session, screen, globalShortcut, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');

// On désactive le check de mise à jour de la lib (elle tente sinon de joindre
// api.github.com à chaque appel, ce qui ralentit inutilement et échoue si le
// réseau est restreint).
process.env.YTDL_NO_UPDATE = '1';
const ytdl = require('@distube/ytdl-core');

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
  return new Promise((resolve) => {
    const scraperWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // On renvoie les console.log/warn/error de la fenêtre de scraping vers ce
    // terminal : sans ça, impossible de savoir pourquoi l'extraction échoue.
    scraperWindow.webContents.on('console-message', (event, level, message) => {
      const levels = ['LOG', 'WARN', 'ERROR', 'DEBUG'];
      console.log(`[Instagram Scraper - ${levels[level] || level}] ${message}`);
    });

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
      if (!scraperWindow.isDestroyed()) {
        scraperWindow.destroy();
      }
    };

    // Sécurité : si jamais ça bloque, on abandonne après 20 secondes
    const timeout = setTimeout(() => finish(null), 20000);

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

    scraperWindow.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
      clearTimeout(timeout);
      console.error(`[Instagram] Échec du chargement de la page (${errorCode}: ${errorDescription})`);
      finish(null);
    });

    scraperWindow.webContents.setUserAgent(FAKE_USER_AGENT);
    scraperWindow.loadURL(embedUrl, { userAgent: FAKE_USER_AGENT });
  });
}

ipcMain.handle('resolve-instagram-video', async (event, url) => {
  return await scrapeInstagramVideo(url);
});

// --- RÉSOLUTION DES VIDÉOS YOUTUBE (Y COMPRIS SHORTS), SANS PUB ---
//
// On ne passe volontairement pas par le lecteur officiel YouTube (webview /
// iframe embed) : celui-ci peut toujours insérer des pubs pré-roll selon la
// monétisation de la vidéo. En récupérant directement le flux mp4 brut via
// ytdl-core, on lit juste le fichier média — il n'y a plus de lecteur YouTube
// du tout, donc plus aucun système de pub.
//
// Limite connue : YouTube modifie régulièrement le chiffrement de ses flux,
// ce qui peut casser ytdl-core de temps en temps (comme pour l'extraction
// Instagram/TikTok). Il faudra alors mettre à jour la dépendance
// "@distube/ytdl-core" (fork activement maintenu, contrairement à l'original
// "ytdl-core").
async function resolveYoutubeVideo(url) {
  try {
    if (!ytdl.validateURL(url)) {
      console.warn(`[YouTube] URL non reconnue par ytdl-core : ${url}`);
      return null;
    }

    const info = await ytdl.getInfo(url);

    // Il faut un format qui contient à la fois la vidéo ET l'audio dans un
    // seul flux : les formats adaptatifs haute qualité séparent vidéo et
    // audio en deux flux distincts, ce qu'une simple balise <video> ne sait
    // pas recombiner.
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: 'videoandaudio'
    });

    if (!format) {
      console.error(`[YouTube] Aucun format vidéo+audio combiné trouvé pour : ${url}`);
      return null;
    }

    console.log(`[YouTube] Résolu "${info.videoDetails.title}" -> itag ${format.itag} (${format.qualityLabel || 'qualité inconnue'})`);
    return format.url;
  } catch (e) {
    console.error(`[YouTube] Échec de résolution pour ${url} :`, e.message || e);
    return null;
  }
}

ipcMain.handle('resolve-youtube-video', async (event, url) => {
  return await resolveYoutubeVideo(url);
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
  const { width, height } = screen.getPrimaryDisplay().bounds;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.setIgnoreMouseEvents(true);
  session.defaultSession.clearStorageData();

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
    (details, callback) => {
      details.requestHeaders['Origin'] = 'https://www.youtube.com';
      details.requestHeaders['Referer'] = 'https://www.youtube.com/';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

mainWindow.loadFile('index.html');

  // NOUVEAU : on renvoie les logs de la fenêtre (console.log/warn/error du HTML)
  // directement dans ce terminal, pour pouvoir diagnostiquer les soucis d'extraction
  // de vidéos (Twitter/TikTok/Instagram) sans avoir à ouvrir les DevTools.
  mainWindow.webContents.on('console-message', (event, level, message) => {
    const levels = ['LOG', 'WARN', 'ERROR', 'DEBUG'];
    console.log(`[Overlay - ${levels[level] || level}] ${message}`);
  });


  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 5000);
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe')
  });

  // Raccourci pour changer de position (Déjà existant)
  globalShortcut.register('CommandOrControl+Alt+P', () => {
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript('cyclePosition()');
    }
  });

  // NOUVEAU : Raccourci pour Agrandir (Flèche Haut)
  globalShortcut.register('CommandOrControl+Alt+Up', () => {
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript('changeSize(0.1)'); // +10%
    }
  });

  // NOUVEAU : Raccourci pour Réduire (Flèche Bas)
  globalShortcut.register('CommandOrControl+Alt+Down', () => {
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript('changeSize(-0.1)'); // -10%
    }
  });
});

app.on('before-quit', () => {
  if (tray) {
    tray.destroy();
  }
});