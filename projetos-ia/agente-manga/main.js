const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Importa os scripts como módulos
const { iniciarAgente } = require('./agente.js');
const { iniciarJuntar } = require('./juntar.js');
const { iniciarAnalisador } = require('./analisar.js');
const { iniciarRoteirizador, TONS } = require('./roteirizar.js');
const { iniciarNarrador, PRESETS_VOZ } = require('./narrar.js');
const { renderVideo } = require('./renderizar.js');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Agente Manga Studio",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#1e1e2e',
    show: false // Mostra só quando estiver pronto
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ═══════════════════════════════════════════════════════════════
//  IPC HANDLERS - INTEGRAÇÃO UI E SISTEMA
// ═══════════════════════════════════════════════════════════════

// Salvar Chave da API no .env (genérica — funciona para qualquer chave)
ipcMain.handle('save-env-key', async (event, { keyName, keyValue }) => {
  try {
    const envPath = path.resolve('.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    const regex = new RegExp(`${keyName}=.*`, 'g');
    if (envContent.match(regex)) {
      envContent = envContent.replace(regex, `${keyName}="${keyValue}"`);
    } else {
      envContent += `\n${keyName}="${keyValue}"`;
    }

    fs.writeFileSync(envPath, envContent.trim(), 'utf8');
    process.env[keyName] = keyValue;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Compat: manter handler antigo para não quebrar nada
ipcMain.handle('save-api-key', async (event, key) => {
  try {
    const envPath = path.resolve('.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    if (envContent.includes('GEMINI_API_KEY=')) {
      envContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY="${key}"`);
    } else {
      envContent += `\nGEMINI_API_KEY="${key}"`;
    }
    fs.writeFileSync(envPath, envContent.trim(), 'utf8');
    process.env.GEMINI_API_KEY = key;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Checar Chave API Gemini
ipcMain.handle('check-api-key', () => {
  require('dotenv').config();
  const k = process.env.GEMINI_API_KEY;
  return !!k && k !== 'sua_chave_aqui' && k.length > 10;
});

// Obter presets de voz do narrador
ipcMain.handle('get-voice-presets', async () => {
  const lista = [];
  for (const [id, config] of Object.entries(PRESETS_VOZ)) {
    lista.push({ id, nome: config.nome, descricao: config.descricao });
  }
  return lista;
});

// Selecionar Pasta
ipcMain.handle('dialog-select-folder', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: defaultPath || path.resolve('./downloads')
  });
  if (!result.canceled) return result.filePaths[0];
  return null;
});

// Selecionar Arquivo (Recap .txt)
ipcMain.handle('dialog-select-file', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
    defaultPath: defaultPath || path.resolve('./downloads')
  });
  if (!result.canceled) return result.filePaths[0];
  return null;
});

// Ler conteúdo de arquivo txt
ipcMain.handle('read-text-file', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Listar Roteiros disponíveis (para popular o leitor/roteirizador)
ipcMain.handle('list-roteiros', async () => {
  const resultados = [];
  const raiz = path.resolve('.');
  
  if (fs.existsSync(raiz)) {
    fs.readdirSync(raiz)
      .filter(f => f.startsWith('roteiro_') && f.endsWith('.txt'))
      .forEach(f => resultados.push({ path: path.join(raiz, f), name: f }));
  }

  const downloadsDir = path.resolve('.', 'downloads');
  if (fs.existsSync(downloadsDir)) {
    const pastas = fs.readdirSync(downloadsDir, { withFileTypes: true });
    for (const pasta of pastas) {
      if (pasta.isDirectory()) {
        const pastaPath = path.join(downloadsDir, pasta.name);
        fs.readdirSync(pastaPath)
          .filter(f => f.startsWith('roteiro_') && f.endsWith('.txt'))
          .forEach(f => resultados.push({ path: path.join(pastaPath, f), name: f }));
      }
    }
  }

  // Desduplicar por caminho
  const unicos = [...new Map(resultados.map(r => [r.path, r])).values()];
  return unicos;
});

// Listar Áudios disponíveis (para o Renderizador)
ipcMain.handle('list-audios', async () => {
  const resultados = [];
  const raiz = path.resolve('.');
  
  if (fs.existsSync(raiz)) {
    fs.readdirSync(raiz)
      .filter(f => f.endsWith('.wav') || f.endsWith('.mp3'))
      .forEach(f => resultados.push({ path: path.join(raiz, f), name: f }));
  }

  const downloadsDir = path.resolve('.', 'downloads');
  if (fs.existsSync(downloadsDir)) {
    const pastas = fs.readdirSync(downloadsDir, { withFileTypes: true });
    for (const pasta of pastas) {
      if (pasta.isDirectory()) {
        const pastaPath = path.join(downloadsDir, pasta.name);
        fs.readdirSync(pastaPath)
          .filter(f => f.endsWith('.wav') || f.endsWith('.mp3'))
          .forEach(f => resultados.push({ path: path.join(pastaPath, f), name: f }));
      }
    }
  }

  const unicos = [...new Map(resultados.map(r => [r.path, r])).values()];
  return unicos;
});

// Obter os tons disponíveis do roteirizador
ipcMain.handle('get-tons', async () => {
  const lista = [];
  for (const [id, config] of Object.entries(TONS)) {
    lista.push({ id, nome: config.nome, descricao: config.descricao });
  }
  return lista;
});

// ═══════════════════════════════════════════════════════════════
//  RUNNERS DE SCRIPTS (Monkey Patch do Console Log)
// ═══════════════════════════════════════════════════════════════

// Função para interceptar os logs
function runWithInterceptedLogs(event, runFunction, argsArray) {
  return new Promise(async (resolve) => {
    // Salva o log original
    const originalLog = console.log;
    const originalWrite = process.stdout.write;
    const originalError = console.error;

    // Flag para evitar o Maximum call stack size exceeded (recursão infinita)
    let isEmitting = false;

    // Função de interceptação e envio pro UI
    const emitLog = (msg, isError = false, fromWrite = false) => {
      if (isEmitting) return;
      isEmitting = true;
      try {
        // Remove códigos de cor ANSI que possam sujar a UI e formata retornos de carro
        let cleanMsg = msg ? msg.toString().replace(/\x1b\[[0-9;]*m/g, '') : '';
        if (cleanMsg.includes('\r')) {
          cleanMsg = cleanMsg.split('\r').pop(); // Pega só a parte após o último \r (útil pra progress bar)
        }
        
        event.sender.send('log-output', { text: cleanMsg, isError });
        
        // Mantém log no terminal real por precaução, se não veio direto do write
        if (!fromWrite) {
          if (isError) originalError.apply(console, [msg]);
          else originalLog.apply(console, [msg]);
        }
      } finally {
        isEmitting = false;
      }
    };

    console.log = (...args) => emitLog(args.join(' '));
    console.error = (...args) => emitLog(args.join(' '), true);
    
    // Intercepta process.stdout.write para capturar a barra de progresso
    process.stdout.write = (chunk, encoding, callback) => {
      if (!isEmitting) emitLog(chunk, false, true);
      return originalWrite.call(process.stdout, chunk, encoding, callback);
    };

    try {
      // Mock do process.exit para não fechar o app
      const originalExit = process.exit;
      let exitCode = 0;
      process.exit = (code) => { exitCode = code; throw new Error(`Process.exit(${code})`); };
      
      // Injeta argumentos temporariamente (scripts dependem de process.argv[2] e [3])
      const originalArgv = [...process.argv];
      process.argv = [process.argv[0], process.argv[1], ...argsArray];

      // Executa a função do script
      await runFunction();
      
      // Restaura mocks
      process.argv = originalArgv;
      process.exit = originalExit;

      resolve({ success: exitCode === 0 });
    } catch (err) {
      if (err.message.includes('Process.exit')) {
        resolve({ success: false, error: "Ação cancelada ou falhou (exit called)." });
      } else {
        emitLog(`❌ Erro Fatal: ${err.message}`, true);
        resolve({ success: false, error: err.message });
      }
    } finally {
      // Restaura logs
      console.log = originalLog;
      console.error = originalError;
      process.stdout.write = originalWrite;
      event.sender.send('process-finished');
    }
  });
}

// 1. Executar Captura
ipcMain.handle('run-agente', async (event, url) => {
  return runWithInterceptedLogs(event, async () => {
    // Passa a URL como argumento de linha de comando para evitar o readline
    await iniciarAgente(url);
  }, [url]);
});

// 2. Executar Juntar
ipcMain.handle('run-juntar', async (event, folderPath) => {
  return runWithInterceptedLogs(event, async () => {
    await iniciarJuntar();
  }, [folderPath]);
});

// 3. Executar Analisar
ipcMain.handle('run-analisar', async (event, folderPath) => {
  return runWithInterceptedLogs(event, async () => {
    await iniciarAnalisador();
  }, [folderPath]);
});

// 4. Executar Roteirizar
ipcMain.handle('run-roteirizar', async (event, data) => {
  // roteirizar usa process.argv[2] para o recap file. 
  // O nome e tom ele pede por readline, então pra evitar refatorar completamente o roteirizar.js:
  // Ops, precisamos mockar o readline.question lá, ou injetar no stdin?
  // O roteirizar.js exporta a API, mas ainda chama readline se não modificar a função...
  return runWithInterceptedLogs(event, async () => {
    // Nós podemos injetar os comandos no stdin temporariamente
    const origStdin = process.stdin;
    const { PassThrough } = require('stream');
    const mockStdin = new PassThrough();
    
    // Substitui a propriedade stdin (que é readonly mas podemos tentar fazer mock do createInterface)
    const readline = require('readline');
    const originalCreateInterface = readline.createInterface;
    
    readline.createInterface = function(options) {
      // Cria uma fila de respostas pré-programadas
      const respostas = [data.nomeObra, data.tomId]; 
      let resCount = 0;
      
      return {
        question: (query, cb) => {
          const resp = respostas[resCount++];
          cb(resp !== undefined ? resp.toString() : '');
        },
        close: () => {}
      };
    };

    try {
      await iniciarRoteirizador();
    } finally {
      readline.createInterface = originalCreateInterface;
    }
  }, [data.recapPath]);
});

// 5. Executar Narrador
ipcMain.handle('run-narrador', async (event, data) => {
  return runWithInterceptedLogs(event, async () => {
    const readline = require('readline');
    const originalCreateInterface = readline.createInterface;
    
    readline.createInterface = function(options) {
      const respostas = [data.presetId];
      let resCount = 0;
      return {
        question: (query, cb) => {
          const resp = respostas[resCount++];
          cb(resp !== undefined ? resp.toString() : '1');
        },
        close: () => {}
      };
    };

    try {
      await iniciarNarrador();
    } finally {
      readline.createInterface = originalCreateInterface;
    }
  }, [data.roteiroPath, data.presetId || 'padrao']);
});

// 6. Executar Renderizador
ipcMain.handle('run-renderizar', async (event, data) => {
  return runWithInterceptedLogs(event, async () => {
    // Nós apenas chamamos o renderVideo diretamente.
    // Opcionalmente podemos injetar os args falsos e rodar se ele tiver um iniciar.
    await renderVideo(data.audioPath, null, data.format === 'shorts');
  }, []);
});
