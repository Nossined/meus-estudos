const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Utils
  checkApiKey: () => ipcRenderer.invoke('check-api-key'),
  checkElevenlabsKey: () => ipcRenderer.invoke('check-elevenlabs-key'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  saveEnvKey: (keyName, keyValue) => ipcRenderer.invoke('save-env-key', { keyName, keyValue }),
  
  // Dialogs
  selectFolder: (defaultPath) => ipcRenderer.invoke('dialog-select-folder', defaultPath),
  selectFile: (defaultPath) => ipcRenderer.invoke('dialog-select-file', defaultPath),
  
  // File operations
  readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
  listRoteiros: () => ipcRenderer.invoke('list-roteiros'),
  listAudios: () => ipcRenderer.invoke('list-audios'),
  getTons: () => ipcRenderer.invoke('get-tons'),
  getVoicePresets: () => ipcRenderer.invoke('get-voice-presets'),
  
  // Runners
  runAgente: (url) => ipcRenderer.invoke('run-agente', url),
  runJuntar: (folderPath) => ipcRenderer.invoke('run-juntar', folderPath),
  runAnalisar: (folderPath) => ipcRenderer.invoke('run-analisar', folderPath),
  runRoteirizar: (data) => ipcRenderer.invoke('run-roteirizar', data),
  runNarrador: (data) => ipcRenderer.invoke('run-narrador', data),
  runRenderizar: (data) => ipcRenderer.invoke('run-renderizar', data),
  
  // Log Listeners
  onLogOutput: (callback) => {
    ipcRenderer.on('log-output', (event, data) => callback(data));
  },
  onProcessFinished: (callback) => {
    ipcRenderer.on('process-finished', () => callback());
  },
  
  // Clean up listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('log-output');
    ipcRenderer.removeAllListeners('process-finished');
  }
});
