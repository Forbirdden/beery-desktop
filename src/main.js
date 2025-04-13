const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile('index.html')
}

ipcMain.handle('get-platform', () => {
  const platform = os.platform()
  const arch = os.arch()
  return `${platform}-${arch}`
})

ipcMain.handle('fetch-repos', async () => {
  try {
    const response = await fetch('https://github.com/Forbirdden/beery/repos.json')
    return await response.json()
  } catch (error) {
    return JSON.parse(fs.readFileSync('repos.json'))
  }
})

app.whenReady().then(createWindow)
