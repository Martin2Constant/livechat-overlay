# Livechat Overlay

Overlay transparent, sans bordure et toujours au premier plan, qui permet d'afficher du contenu (texte, images, vidéos, GIFs) par-dessus n'importe quelle application ouverte sur l'écran. Pensé pour un usage entre amis, à but humoristique — pas pour du stream OBS.

Le contenu à afficher est envoyé en temps réel via un serveur WebSocket (bot de chat), et s'affiche automatiquement à l'écran pendant quelques secondes avant de disparaître.

## Fonctionnalités

- Fenêtre transparente, sans bordure, toujours au premier plan, invisible aux clics de souris et absente de la barre des tâches.
- Réception des médias en temps réel via WebSocket, avec reconnexion automatique en cas de coupure.
- Affichage de l'auteur du message (nom + avatar), d'un texte et d'un média.
- Extraction automatique de la vidéo directe depuis des liens Twitter/X, TikTok et Instagram (lecture du flux brut, sans passer par le lecteur/l'interface d'origine de ces plateformes).
- Repositionnement à l'écran (4 coins) et zoom (de 30 % à 150 %) à la volée, sans redémarrer l'app.
- Contrôle via l'icône dans la zone de notification (tray) ou via des raccourcis clavier globaux.

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Ctrl+Alt+P` | Changer de position à l'écran (cycle entre les 4 coins) |
| `Ctrl+Alt+↑` | Agrandir l'overlay (+10 %) |
| `Ctrl+Alt+↓` | Réduire l'overlay (-10 %) |

Ces mêmes actions sont aussi disponibles depuis le menu de l'icône dans la zone de notification (clic droit), et un double-clic sur l'icône change directement de position.

## Prérequis

- [Node.js](https://nodejs.org/)
- Windows (l'application n'est packagée que pour Windows pour l'instant)

## Installation / lancement en développement

```bash
npm install
npm start
```

## Générer l'exécutable Windows

```bash
npm run build
```

L'exécutable portable est généré dans le dossier `dist/`.

> ⚠️ L'exécutable n'est pas signé numériquement. Windows Defender / SmartScreen peut donc afficher un avertissement au premier lancement. Il suffit de cliquer sur **Plus d'infos** puis **Exécuter quand même**.

## Limites connues

L'extraction des vidéos Twitter/X, TikTok et Instagram dépend de la structure interne de ces plateformes (et, pour Twitter, de services tiers comme vxtwitter/fxtwitter). Ces plateformes changent régulièrement leur fonctionnement, ce qui peut casser l'extraction sans préavis. En cas d'échec, l'overlay affiche simplement l'image ou n'affiche rien pour ce média.
