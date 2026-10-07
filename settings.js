const api = window.electronAPI;
const volume = document.getElementById('volume');
const scale = document.getElementById('scale');
const status = document.getElementById('status');
const sample = document.getElementById('sample');
const youtubeFormat = document.getElementById('youtube-format');
let state;
let pending = Promise.resolve();
let revision = 0;
let writes = 0;

function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
}

function render(settings) {
    state = settings;
    youtubeFormat.value = settings.youtubeFormat;
    volume.value = Math.round(settings.volume * 100);
    scale.value = Math.round(settings.scale * 100);
    document.getElementById('volume-value').textContent = `${volume.value} %`;
    document.getElementById('scale-value').textContent = `${scale.value} %`;
    document.querySelectorAll('[data-position]').forEach(button => {
        button.setAttribute('aria-pressed', String(Number(button.dataset.position) === settings.positionIndex));
    });
    const left = settings.positionIndex >= 2;
    const bottom = settings.positionIndex === 1 || settings.positionIndex === 2;
    Object.assign(sample.style, {
        top: bottom ? 'auto' : '12px', bottom: bottom ? '12px' : 'auto',
        left: left ? '12px' : 'auto', right: left ? 'auto' : '12px',
        transformOrigin: `${bottom ? 'bottom' : 'top'} ${left ? 'left' : 'right'}`,
        transform: `scale(${settings.scale})`
    });
}

function update(patch) {
    render({ ...state, ...patch });
    const request = ++revision;
    writes++;
    message('Enregistrement…');
    pending = pending.then(() => api.saveSettings(patch)).then(saved => {
        if (request === revision) {
            render(saved);
            message('Tous les réglages sont enregistrés.');
        }
    }).catch(error => {
        if (request === revision) message('Échec de l’enregistrement. Réessayez en modifiant le réglage.', true);
        console.error(error);
    }).finally(() => { writes--; });
}

volume.addEventListener('input', () => update({ volume: Number(volume.value) / 100 }));
scale.addEventListener('input', () => update({ scale: Number(scale.value) / 100 }));
youtubeFormat.addEventListener('change', () => update({ youtubeFormat: youtubeFormat.value }));
document.querySelectorAll('[data-position]').forEach(button => {
    button.addEventListener('click', () => update({ positionIndex: Number(button.dataset.position) }));
});
for (const action of ['preview', 'stop', 'reset']) {
    document.getElementById(action).addEventListener('click', async () => {
        try {
            await pending;
            const result = await api.settingsAction(action);
            if (action === 'reset') render(result);
            message(action === 'preview' ? 'Message de test affiché pendant 10 secondes.' : action === 'stop' ? 'Média arrêté.' : 'Valeurs par défaut rétablies et enregistrées.');
        } catch { message('L’action a échoué. Réessayez.', true); }
    });
}

api.onSettingsChanged(settings => { if (!writes) render(settings); });
api.loadSettings().then(settings => {
    render(settings);
    document.getElementById('controls').disabled = false;
    for (const action of ['preview', 'stop', 'reset']) document.getElementById(action).disabled = false;
    message('Tous les réglages sont enregistrés.');
}).catch(() => message('Impossible de charger les réglages. Fermez puis rouvrez la configuration.', true));
