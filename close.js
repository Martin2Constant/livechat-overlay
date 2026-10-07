document.getElementById('stop').addEventListener('click', () => {
    window.electronAPI.stopMedia().catch(error => console.error('Impossible d’arrêter le média :', error));
});
