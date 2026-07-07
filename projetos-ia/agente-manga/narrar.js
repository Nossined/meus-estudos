require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { GoogleGenAI } = require('@google/genai');

// ╔══════════════════════════════════════════════════════════════╗
// ║    🎙️ NARRADOR — Gerador de Áudio via Gemini Native TTS       ║
// ║   Pega o roteiro postável e transforma em áudio narrado     ║
// ║   pronto para edição de vídeo. Qualidade YouTube-ready.     ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Presets de Voz do Gemini ───────────────────────────────────
// As vozes nativas do Gemini TTS usam nomes específicos (Puck, Charon, Kore, etc.)
const PRESETS_VOZ = {
  padrao: {
    nome: '🎙️ Puck (Energético & Hype)',
    descricao: 'Voz otimista e animada (Upbeat). Ideal para reacts.',
    voiceName: 'Puck',
  },
  documentario: {
    nome: '🎬 Charon (Informativo)',
    descricao: 'Voz calma e professoral. Perfeita para vídeo-ensaio e análises.',
    voiceName: 'Charon',
  },
  firme: {
    nome: '⚔️ Kore (Firme)',
    descricao: 'Voz direta e séria. Ideal para cenas épicas e combate brutal.',
    voiceName: 'Kore',
  },
  profundo: {
    nome: '🌑 Fenrir (Excitável/Profundo)',
    descricao: 'Voz intensa. Boa para suspense e narrações dramáticas.',
    voiceName: 'Fenrir',
  },
  jovem: {
    nome: '💜 Leda (Jovem)',
    descricao: 'Voz jovial e dinâmica. Boa para conteúdo ágil e irônico.',
    voiceName: 'Leda',
  },
  brilhante: {
    nome: '🌟 Zephyr (Brilhante)',
    descricao: 'Voz brilhante e clara.',
    voiceName: 'Zephyr',
  }
};

// ── Configurações ──────────────────────────────────────────────
const CONFIG = {
  modelo: 'gemini-3.1-flash-tts-preview',
  // Limite recomendado pela documentação do TTS para evitar degradação de qualidade/drifting
  charsPorChunk: 2000, 
  delayEntreChunks: 2000, // Previne bater no rate limit do modelo preview
};

// ═══════════════════════════════════════════════════════════════
//  UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(texto, (resposta) => {
      rl.close();
      resolve(resposta.trim());
    });
  });
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function limparMetadados(texto) {
  // Remove tudo entre [METADADOS e a linha de separadores ─
  const linhas = texto.split('\n');
  let inicio = -1;
  let fim = -1;

  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i].includes('[METADADOS') || linhas[i].includes('[META')) {
      inicio = i;
    }
    if (inicio >= 0 && (linhas[i].includes('─') || linhas[i].includes('===')) && i > inicio) {
      fim = i;
      break;
    }
  }

  if (inicio >= 0 && fim >= 0) {
    linhas.splice(inicio, fim - inicio + 1);
  }

  let textoLimpo = linhas.join('\n').replace(/^\n+/, '');

  // Limpeza extra para o TTS: Remove markdown (*, _, #) e Emojis que o modelo possa tentar "ler"
  textoLimpo = textoLimpo.replace(/[*#_~`]/g, '');
  textoLimpo = textoLimpo.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}]/gu, '');

  return textoLimpo;
}

function criarCabecalhoWav(tamanhoPcm, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + tamanhoPcm, 4);
  buffer.write('WAVE', 8);
  
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  
  buffer.write('data', 36);
  buffer.writeUInt32LE(tamanhoPcm, 40);
  
  return buffer;
}

function gerarSilencio(segundos, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(sampleRate * segundos);
  const buffer = Buffer.alloc(numSamples * numChannels * bytesPerSample);
  return buffer;
}

function dividirEmChunks(texto, maxChars) {
  const paragrafos = texto.split(/\n\n+/);
  const chunks = [];
  let chunkAtual = '';

  for (const paragrafo of paragrafos) {
    // Se o parágrafo atual + o novo ultrapassam o limite (e já temos algo no chunk)
    if ((chunkAtual.length + paragrafo.length + 2) > maxChars && chunkAtual.length > 0) {
      chunks.push(chunkAtual.trim());
      chunkAtual = paragrafo;
    } else {
      // Caso o parágrafo SOZINHO seja gigantesco, fazemos um split por frases como fallback
      if (paragrafo.length > maxChars) {
        if (chunkAtual.length > 0) {
          chunks.push(chunkAtual.trim());
          chunkAtual = '';
        }
        const sentencas = paragrafo.match(/[^.!?]+[.!?]+\s*/g) || [paragrafo];
        for (const sentenca of sentencas) {
          if ((chunkAtual.length + sentenca.length) > maxChars && chunkAtual.length > 0) {
            chunks.push(chunkAtual.trim());
            chunkAtual = sentenca;
          } else {
            chunkAtual += sentenca;
          }
        }
      } else {
        chunkAtual += (chunkAtual.length > 0 ? '\n\n' : '') + paragrafo;
      }
    }
  }

  if (chunkAtual.trim().length > 0) chunks.push(chunkAtual.trim());
  return chunks;
}

function validarChaveAPI() {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave || chave === 'sua_chave_aqui' || chave.length < 10) {
    console.log('  ❌ Chave API do Gemini não encontrada!');
    console.log('  💡 Configure no arquivo .env: GEMINI_API_KEY="sua_chave"');
    process.exit(1);
  }
  const mascarada = chave.substring(0, 6) + '...' + chave.substring(chave.length - 4);
  console.log(`  🔑 Gemini API: ${mascarada}`);
  return chave;
}

function listarRoteiroPostaveis() {
  const resultados = [];
  const raiz = path.resolve('.');
  const arquivosRaiz = fs.readdirSync(raiz).filter(f => f.includes('postavel') && f.endsWith('.txt'));
  for (const arq of arquivosRaiz) resultados.push(path.join(raiz, arq));

  const downloadsDir = path.resolve('.', 'downloads');
  if (fs.existsSync(downloadsDir)) {
    const pastas = fs.readdirSync(downloadsDir, { withFileTypes: true });
    for (const pasta of pastas) {
      if (pasta.isDirectory()) {
        const pastaPath = path.join(downloadsDir, pasta.name);
        const txts = fs.readdirSync(pastaPath).filter(f => f.includes('postavel') && f.endsWith('.txt'));
        for (const txt of txts) {
          const full = path.join(pastaPath, txt);
          if (!resultados.includes(full)) resultados.push(full);
        }
      }
    }
  }

  if (resultados.length === 0) {
    const todosTxt = fs.readdirSync(raiz).filter(f => f.startsWith('roteiro_') && f.endsWith('.txt'));
    for (const arq of todosTxt) resultados.push(path.join(raiz, arq));
  }

  return [...new Map(resultados.map(r => [path.basename(r), r])).values()];
}

// ═══════════════════════════════════════════════════════════════
//  MOTOR DE ÁUDIO — Google Gemini GenAI
// ═══════════════════════════════════════════════════════════════

async function gerarAudioChunk(ai, chunkText, voiceName) {
  // A doc do modelo TTS do Gemini pede para garantir que a intenção de speech seja clara
  // Para ajudar o classificador de síntese, adicionamos um preâmbulo.
  const contents = "Sintetize a fala a seguir:\n\n" + chunkText;

  const response = await ai.models.generateContent({
    model: CONFIG.modelo,
    contents: contents,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voiceName
          }
        }
      }
    }
  });

  if (!response || !response.candidates || response.candidates.length === 0) {
    throw new Error('Sem resposta da API');
  }

  const parts = response.candidates[0].content.parts;
  const audioPart = parts.find(p => p.inlineData);

  if (audioPart && audioPart.inlineData) {
    // Retorna o buffer decodificando o base64
    return Buffer.from(audioPart.inlineData.data, 'base64');
  } else {
    throw new Error('O modelo não retornou tokens de áudio (falha ou bloqueio).');
  }
}

// ═══════════════════════════════════════════════════════════════
//  EXECUÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function iniciar() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  🎙️ NARRADOR — Gerador de Áudio (Gemini TTS) ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  const apiKey = validarChaveAPI();
  const ai = new GoogleGenAI({ apiKey });

  let arquivoRoteiro = process.argv[2];

  if (!arquivoRoteiro) {
    const roteiros = listarRoteiroPostaveis();

    if (roteiros.length === 0) {
      console.log('  ❌ Nenhum roteiro postável encontrado!');
      console.log('  💡 Execute primeiro: node roteirizar.js');
      process.exit(1);
    }

    console.log('');
    console.log('  📄 Roteiros postáveis disponíveis:');
    console.log('');
    roteiros.forEach((r, i) => {
      const stat = fs.statSync(r);
      const tamanho = formatarBytes(stat.size);
      console.log(`     ${i + 1}. ${path.basename(r)}  (${tamanho})`);
    });
    console.log('');

    const escolha = await perguntar('  🔢 Escolha o número do roteiro: ');
    const idx = parseInt(escolha, 10);
    if (idx >= 1 && idx <= roteiros.length) {
      arquivoRoteiro = roteiros[idx - 1];
    } else {
      console.log('  ❌ Opção inválida');
      process.exit(1);
    }
  } else {
    arquivoRoteiro = path.resolve(arquivoRoteiro);
  }

  if (!fs.existsSync(arquivoRoteiro)) {
    console.log(`  ❌ Arquivo não encontrado: ${arquivoRoteiro}`);
    process.exit(1);
  }

  let textoOriginal = fs.readFileSync(arquivoRoteiro, 'utf-8');
  const textoLimpo = limparMetadados(textoOriginal);
  const totalChars = textoLimpo.length;
  const totalPalavras = textoLimpo.split(/\s+/).filter(w => w.length > 0).length;

  console.log(`  📖 Roteiro carregado: ${path.basename(arquivoRoteiro)}`);
  console.log(`     • ${totalChars.toLocaleString()} caracteres`);
  console.log(`     • ${totalPalavras.toLocaleString()} palavras`);

  const presetArg = process.argv[3];
  let presetEscolhido;

  if (presetArg && PRESETS_VOZ[presetArg]) {
    presetEscolhido = PRESETS_VOZ[presetArg];
  } else if (!presetArg) {
    console.log('');
    console.log('  🎭 Presets de voz do Gemini disponíveis:');
    console.log('');
    const chaves = Object.keys(PRESETS_VOZ);
    chaves.forEach((chave, i) => {
      console.log(`     ${i + 1}. ${PRESETS_VOZ[chave].nome} — ${PRESETS_VOZ[chave].descricao}`);
    });
    console.log('');

    const escolhaVoz = await perguntar('  🔢 Escolha a voz: ');
    const idxVoz = parseInt(escolhaVoz, 10);
    if (idxVoz >= 1 && idxVoz <= chaves.length) {
      presetEscolhido = PRESETS_VOZ[chaves[idxVoz - 1]];
    } else {
      console.log('  ⚠️  Opção inválida, usando Padrao (Puck)...');
      presetEscolhido = PRESETS_VOZ.padrao;
    }
  } else {
    presetEscolhido = PRESETS_VOZ.padrao;
  }

  const chunks = dividirEmChunks(textoLimpo, CONFIG.charsPorChunk);

  console.log('');
  console.log('  ═══════════════════════════════════════════');
  console.log('  🎙️ GERANDO ÁUDIO...');
  console.log('  ═══════════════════════════════════════════');
  console.log('');
  console.log(`  🎭 Voz selecionada: ${presetEscolhido.nome}`);
  console.log(`  🧩 Chunks processados: ${chunks.length} segmentos`);
  console.log(`  🔧 Modelo de áudio: ${CONFIG.modelo}`);
  console.log('');

  const buffers = [];
  const inicio = Date.now();
  let charsProcessados = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const progresso = Math.round(((i + 1) / chunks.length) * 100);
    process.stdout.write(`\r  [${i + 1}/${chunks.length}] ${progresso}% — Gerando áudio (${chunk.length} chars)...    `);

    let sucesso = false;
    let tentativas = 0;
    const MAX_TENTATIVAS = 3;

    while (!sucesso && tentativas < MAX_TENTATIVAS) {
      try {
        const audioBuffer = await gerarAudioChunk(ai, chunk, presetEscolhido.voiceName);
        buffers.push(audioBuffer);
        charsProcessados += chunk.length;
        sucesso = true;
      } catch (err) {
        tentativas++;
        console.log('');
        console.log(`  ❌ Erro no chunk ${i + 1} (Tentativa ${tentativas}/${MAX_TENTATIVAS}): ${err.message}`);

        if (tentativas < MAX_TENTATIVAS) {
          console.log(`  ⏳ Aguardando 10 segundos antes do retry...`);
          await esperar(10000);
        } else {
          console.log(`  ⚠️  Máximo de tentativas atingido. Pulando este trecho do áudio.`);
        }
      }
    }

    if (i < chunks.length - 1) {
      await esperar(CONFIG.delayEntreChunks);
    }
  }

  console.log('');

  if (buffers.length === 0) {
    console.log('  ❌ Nenhum áudio foi gerado. Verifique os logs e tente novamente.');
    process.exit(1);
  }

  // A API Native TTS do Gemini retorna Raw PCM (1 canal, 24000Hz, 16-bit)
  // Intercalamos os buffers com pausas de silêncio para a transição ficar suave!
  const silêncioEntreChunks = gerarSilencio(0.5); // 0.5s de pausa natural entre cenas
  const silêncioInicio = gerarSilencio(0.5);      // 0.5s de respiro no começo
  const silêncioFim = gerarSilencio(1.0);         // 1s de pausa no final do vídeo

  const pcmComPausas = [silêncioInicio];
  for (let i = 0; i < buffers.length; i++) {
    pcmComPausas.push(buffers[i]);
    if (i < buffers.length - 1) {
      pcmComPausas.push(silêncioEntreChunks);
    }
  }
  pcmComPausas.push(silêncioFim);

  const pcmFinal = Buffer.concat(pcmComPausas);
  const wavHeader = criarCabecalhoWav(pcmFinal.length, 24000);
  const audioFinal = Buffer.concat([wavHeader, pcmFinal]);

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);

  const nomeBase = path.basename(arquivoRoteiro, '.txt');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const nomeAudio = `${nomeBase}_audio_${timestamp}.wav`;

  const pastaRoteiro = path.dirname(arquivoRoteiro);
  const caminhoSaida = path.join(pastaRoteiro, nomeAudio);
  fs.writeFileSync(caminhoSaida, audioFinal);

  const copiaRaiz = path.resolve('.', nomeAudio);
  fs.writeFileSync(copiaRaiz, audioFinal);

  const tamanhoArquivo = formatarBytes(audioFinal.length);

  console.log('  ═══════════════════════════════════════════');
  console.log('  ✅ ÁUDIO GERADO COM SUCESSO (GEMINI TTS)!');
  console.log('  ═══════════════════════════════════════════');
  console.log('');
  console.log('  📊 Resultado:');
  console.log(`     • Voz: ${presetEscolhido.nome}`);
  console.log(`     • Chunks processados: ${buffers.length}/${chunks.length}`);
  console.log(`     • Caracteres narrados: ${charsProcessados.toLocaleString()}`);
  console.log(`     • Tamanho do arquivo: ${tamanhoArquivo}`);
  console.log(`     • Tempo de geração: ${duracao}s`);
  console.log('');
  console.log('  📂 Salvo em:');
  console.log(`     • ${caminhoSaida}`);
  console.log(`     • ${copiaRaiz}`);
  console.log('');
}

if (require.main === module) {
  iniciar().catch(err => {
    console.error(`  💀 Erro fatal: ${err.message}`);
    if (err.stack && !err.stack.includes(process.env.GEMINI_API_KEY || '')) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}

module.exports = { iniciarNarrador: iniciar, PRESETS_VOZ };
