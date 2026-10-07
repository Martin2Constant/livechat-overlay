document.getElementById('quit').addEventListener('click', () => {
    window.electronAPI.quitOverlay().catch(error => console.error('Impossible de quitter :', error));
});
