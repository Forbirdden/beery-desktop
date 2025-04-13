const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const Store = require('electron-store');

const store = new Store();
let mainWindow;

async function updateRepos() {
  try {
    const response = await fetch('https://raw.githubusercontent.com/Forbirdden/beery/main/repos.json');
    const data = await response.json();
    fs.writeFileSync(path.join(app.getPath('userData'), 'repos.json'), JSON.stringify(data));
    mainWindow.webContents.send('repos-updated');
  } catch (error) {
    console.error('Failed to update repos:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, '../assets/logot.png'),
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  setInterval(updateRepos, 60 * 60 * 1000);
  updateRepos(); 

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

ipcMain.handle('get-repos', () => {
  return fs.readFileSync(path.join(app.getPath('userData'), 'repos.json'), 'utf-8');
});

ipcMain.handle('get-token', () => store.get('github_token'));
ipcMain.handle('set-token', (_, token) => store.set('github_token', token));
ipcMain.handle('delete-token', () => store.delete('github_token'));
