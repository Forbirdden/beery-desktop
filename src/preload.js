const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    fetchRepos: () => ipcRenderer.invoke('fetch-repos'),
    openDialog: (options) => ipcRenderer.invoke('dialog:open', options),
    downloadAsset: (url, filename) => ipcRenderer.send('download-asset', { url, filename }),
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download-progress', (event, progress) => callback(progress));
    },
    onDownloadComplete: (callback) => {
        ipcRenderer.on('download-complete', (event, path) => callback(path));
    },
    onDownloadError: (callback) => {
        ipcRenderer.on('download-error', (event, error) => callback(error));
    },
    getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
    uninstallApp: (installPath) => ipcRenderer.send('uninstall-app', installPath)
});
