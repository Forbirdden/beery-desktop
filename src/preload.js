const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),

  getGitHubToken: () => ipcRenderer.invoke('get-github-token'),
  setGitHubToken: (token) => ipcRenderer.invoke('set-github-token', token),
  deleteGitHubToken: () => ipcRenderer.invoke('delete-github-token'),

  getReposData: () => ipcRenderer.invoke('get-repos-data'),
  
  installApp: (appData) => ipcRenderer.invoke('install-app', appData),
  uninstallApp: (appId) => ipcRenderer.invoke('uninstall-app', appId),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getInstallPath: () => ipcRenderer.invoke('get-install-path'),
  setInstallPath: (newPath) => ipcRenderer.invoke('set-install-path', newPath),

  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),

  logEvent: (level, message) => ipcRenderer.invoke('log-event', level, message),

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  onInstallProgress: (callback) => ipcRenderer.on('install-progress', callback),
  onAppsUpdated: (callback) => ipcRenderer.on('apps-updated', callback)
});

contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isARM: process.arch.includes('arm'),
  isX64: process.arch === 'x64'
});
