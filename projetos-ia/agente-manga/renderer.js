// Lógica da Interface do Usuário

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const navLinks = document.querySelectorAll('.nav-links li');
  const panels = document.querySelectorAll('.panel');
  const terminalOutput = document.getElementById('terminal-output');
  
  // Tabs Navigation
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      // Remove active from all
      navLinks.forEach(l => l.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      
      // Add active to clicked
      link.classList.add('active');
      document.getElementById(link.getAttribute('data-target')).classList.add('active');
    });
  });

  // Terminal Logic
  function logToTerminal(text, isError = false) {
    const span = document.createElement('span');
    span.textContent = text + '\n';
    if (isError) span.classList.add('error');
    
    // Se for uma barra de progresso (começa com colchetes e tem %), tentamos substituir a última linha
    if (text.trim().startsWith('[') && text.includes('%')) {
      const lastChild = terminalOutput.lastElementChild;
      if (lastChild && lastChild.textContent.trim().startsWith('[')) {
        lastChild.textContent = text + '\n';
        return;
      }
    }
    
    terminalOutput.appendChild(span);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    terminalOutput.innerHTML = '';
  });

  // Escuta logs do backend (IPC)
  window.api.onLogOutput((data) => {
    const txt = data.text;
    logToTerminal(txt, data.isError);

    // Lógica para interceptar % do Renderizador e atualizar a barra
    if (txt.includes('Renderizando:') && txt.includes('%')) {
      const match = txt.match(/([0-9.]+)\s*%/);
      if (match) {
        const pct = parseFloat(match[1]);
        document.getElementById('render-progress-fill').style.width = pct + '%';
        document.getElementById('render-percent-text').textContent = pct.toFixed(1) + '%';
        document.getElementById('render-status-text').textContent = 'Processando vídeo e áudio...';
      }
    }
    
    if (txt.includes('VÍDEO PROFISSIONAL FINALIZADO')) {
      document.getElementById('render-progress-fill').style.width = '100%';
      document.getElementById('render-percent-text').textContent = '100%';
      document.getElementById('render-status-text').textContent = 'Concluído!';
      document.getElementById('render-progress-fill').style.background = '#4CAF50'; // verde sucesso
    }
  });

  window.api.onProcessFinished(() => {
    logToTerminal('--- Fim do Processo ---\n');
    document.getElementById('btn-run-renderizar').disabled = false;
  });

  // --- API Check ---
  async function checkApiStatus() {
    const hasGemini = await window.api.checkApiKey();
    const dotG = document.getElementById('api-status-dot');
    const textG = document.getElementById('api-status-text');
    if (hasGemini) { dotG.className = 'dot ok'; textG.textContent = 'Gemini: OK'; }
    else { dotG.className = 'dot missing'; textG.textContent = 'Gemini: ✖'; }
  }
  
  checkApiStatus();

  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const key = document.getElementById('apikey-input').value.trim();
    if (!key) {
      alert("Digite uma chave válida.");
      return;
    }
    const result = await window.api.saveApiKey(key);
    if (result.success) {
      alert("Chave Gemini salva com sucesso!");
      document.getElementById('apikey-input').value = '';
      checkApiStatus();
    } else {
      alert("Erro ao salvar: " + result.error);
    }
  });

  // --- PANEL 1: Capturar ---
  document.getElementById('btn-run-capturar').addEventListener('click', async () => {
    const url = document.getElementById('url-input').value.trim();
    if (!url) {
      alert("Insira a URL do mangá!");
      return;
    }
    logToTerminal(`Iniciando captura para: ${url}\n`);
    await window.api.runAgente(url);
    
    // Auto-preencher a próxima etapa (Juntar)
    // Infelizmente não temos o nome exato da pasta retornado facilmente, 
    // mas o usuário pode usar o botão Selecionar.
  });

  // --- PANEL 2: Juntar ---
  document.getElementById('btn-select-juntar').addEventListener('click', async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      document.getElementById('juntar-folder-path').value = folder;
      // Auto-preencher a próxima etapa
      document.getElementById('analisar-folder-path').value = folder + '_corrigido';
    }
  });

  document.getElementById('btn-run-juntar').addEventListener('click', async () => {
    const folder = document.getElementById('juntar-folder-path').value;
    if (!folder) {
      alert("Selecione a pasta primeiro!");
      return;
    }
    logToTerminal(`Iniciando junção de blocos em: ${folder}\n`);
    await window.api.runJuntar(folder);
  });

  // --- PANEL 3: Analisar ---
  document.getElementById('btn-select-analisar').addEventListener('click', async () => {
    const folder = await window.api.selectFolder();
    if (folder) document.getElementById('analisar-folder-path').value = folder;
  });

  document.getElementById('btn-run-analisar').addEventListener('click', async () => {
    const folder = document.getElementById('analisar-folder-path').value;
    if (!folder) {
      alert("Selecione a pasta _corrigido primeiro!");
      return;
    }
    
    const hasKey = await window.api.checkApiKey();
    if (!hasKey) {
      alert("Configure a chave da API do Gemini primeiro na aba Configurações!");
      return;
    }

    logToTerminal(`Iniciando análise com IA em: ${folder}\n`);
    await window.api.runAnalisar(folder);
    refreshRoteirosSelects();
  });

  // --- PANEL 4: Roteirizar ---
  async function refreshRoteirosSelects() {
    const list = await window.api.listRoteiros();
    const selectRot = document.getElementById('roteirizar-file-select');
    const selectLeitor = document.getElementById('leitor-file-select');
    
    selectRot.innerHTML = '<option value="">Selecione um recap gerado...</option>';
    selectLeitor.innerHTML = '<option value="">Selecione um roteiro para ler...</option>';
    
    list.forEach(item => {
      const optionRot = document.createElement('option');
      optionRot.value = item.path;
      optionRot.textContent = item.name;
      selectRot.appendChild(optionRot);
      
      const optionLeitor = document.createElement('option');
      optionLeitor.value = item.path;
      optionLeitor.textContent = item.name;
      selectLeitor.appendChild(optionLeitor);
    });
  }

  async function carregarTons() {
    const tons = await window.api.getTons();
    const select = document.getElementById('roteirizar-tom-select');
    tons.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.nome} - ${t.descricao}`;
      select.appendChild(opt);
    });
  }

  document.getElementById('btn-refresh-recap').addEventListener('click', refreshRoteirosSelects);
  
  document.getElementById('btn-run-roteirizar').addEventListener('click', async () => {
    const recapPath = document.getElementById('roteirizar-file-select').value;
    const nomeObra = document.getElementById('roteirizar-nome-obra').value.trim();
    const tomId = document.getElementById('roteirizar-tom-select').value;
    
    if (!recapPath) {
      alert("Selecione o arquivo Recap (.txt)!"); return;
    }
    if (!nomeObra) {
      alert("Digite o nome real da obra!"); return;
    }

    logToTerminal(`Iniciando Roteirizador para: ${nomeObra}\n`);
    await window.api.runRoteirizar({ recapPath, nomeObra, tomId });
    refreshRoteirosSelects();
  });

  // --- PANEL 5: Leitor ---
  document.getElementById('btn-refresh-leitor').addEventListener('click', refreshRoteirosSelects);

  document.getElementById('leitor-file-select').addEventListener('change', async (e) => {
    const filePath = e.target.value;
    const contentDiv = document.getElementById('reader-content');
    if (!filePath) {
      contentDiv.textContent = 'Selecione um arquivo acima para ler.';
      return;
    }
    
    const result = await window.api.readTextFile(filePath);
    if (result.success) {
      contentDiv.textContent = result.content;
    } else {
      contentDiv.textContent = `Erro ao carregar arquivo: ${result.error}`;
    }
  });

  document.getElementById('btn-copy-leitor').addEventListener('click', () => {
    const text = document.getElementById('reader-content').textContent;
    if (text && text !== 'Selecione um arquivo acima para ler.') {
      navigator.clipboard.writeText(text);
      alert('Texto copiado para a área de transferência!');
    }
  });

  let fontSize = 16;
  document.getElementById('btn-font-plus').addEventListener('click', () => {
    fontSize = Math.min(fontSize + 2, 32);
    document.getElementById('reader-content').style.fontSize = `${fontSize}px`;
  });
  document.getElementById('btn-font-minus').addEventListener('click', () => {
    fontSize = Math.max(fontSize - 2, 12);
    document.getElementById('reader-content').style.fontSize = `${fontSize}px`;
  });

  // --- PANEL 5: Narrar ---
  async function refreshNarrarSelects() {
    const list = await window.api.listRoteiros();
    const selectNarrar = document.getElementById('narrar-file-select');
    selectNarrar.innerHTML = '<option value="">Selecione um roteiro postável...</option>';
    
    list.forEach(item => {
      if (item.name.includes('postavel')) {
        const opt = document.createElement('option');
        opt.value = item.path;
        opt.textContent = item.name;
        selectNarrar.appendChild(opt);
      }
    });
    // If no postaveis, add all roteiros as fallback
    if (selectNarrar.options.length <= 1) {
      list.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.path;
        opt.textContent = item.name;
        selectNarrar.appendChild(opt);
      });
    }
  }

  async function carregarVoicePresets() {
    const presets = await window.api.getVoicePresets();
    const select = document.getElementById('narrar-voice-select');
    select.innerHTML = '';
    presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.nome} — ${p.descricao}`;
      select.appendChild(opt);
    });
  }

  document.getElementById('btn-refresh-narrar').addEventListener('click', refreshNarrarSelects);

  document.getElementById('btn-browse-narrar').addEventListener('click', async () => {
    const file = await window.api.selectFile();
    if (file) {
      const select = document.getElementById('narrar-file-select');
      // Add as custom option
      const opt = document.createElement('option');
      opt.value = file;
      opt.textContent = file.split(/[\\/]/).pop();
      opt.selected = true;
      select.appendChild(opt);
    }
  });

  document.getElementById('btn-run-narrar').addEventListener('click', async () => {
    const roteiroPath = document.getElementById('narrar-file-select').value;
    const presetId = document.getElementById('narrar-voice-select').value;
    
    if (!roteiroPath) { alert("Selecione o roteiro postável!"); return; }
    
    const hasKey = await window.api.checkApiKey();
    if (!hasKey) {
      alert("Configure a chave da API do Gemini primeiro na aba Configurações!");
      return;
    }

    logToTerminal(`Iniciando narração com a voz: ${presetId}\n`);
    await window.api.runNarrador({ roteiroPath, presetId });
  });

  // --- PANEL 6: Renderizar ---
  async function refreshRenderizarSelects() {
    const list = await window.api.listAudios();
    const select = document.getElementById('renderizar-file-select');
    select.innerHTML = '<option value="">Selecione um áudio gerado (.wav/.mp3)...</option>';
    
    list.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.path;
      opt.textContent = item.name;
      select.appendChild(opt);
    });
  }

  document.getElementById('btn-refresh-renderizar').addEventListener('click', refreshRenderizarSelects);

  document.getElementById('btn-run-renderizar').addEventListener('click', async () => {
    const audioPath = document.getElementById('renderizar-file-select').value;
    const format = document.getElementById('renderizar-format-select').value;
    
    if (!audioPath) { alert("Selecione um arquivo de áudio!"); return; }

    // Reseta e mostra a barra
    document.getElementById('render-progress-container').style.display = 'block';
    document.getElementById('render-progress-fill').style.width = '0%';
    document.getElementById('render-progress-fill').style.background = 'var(--accent)';
    document.getElementById('render-percent-text').textContent = '0%';
    document.getElementById('render-status-text').textContent = 'Preparando arquivos...';
    document.getElementById('btn-run-renderizar').disabled = true;

    logToTerminal(`Iniciando renderização de vídeo (${format})...\n`);
    await window.api.runRenderizar({ audioPath, format });
  });

  // Inicializa selects
  refreshRoteirosSelects();
  refreshNarrarSelects();
  refreshRenderizarSelects();
  carregarTons();
  carregarVoicePresets();
});
