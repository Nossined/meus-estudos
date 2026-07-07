const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// ╔══════════════════════════════════════════════════════════════╗
// ║    🎥 RENDERIZADOR V2 — Motor FFmpeg (AMS Módulo 5 Alto Nível)║
// ║   Orquestra Áudio, Imagens (ZoomPan), Legendas ASS, Ducking  ║
// ╚══════════════════════════════════════════════════════════════╝

const CONFIG = {
  RESOLUTION: {
    NORMAL: { width: 1920, height: 1080 },
    SHORTS: { width: 1080, height: 1920 }
  },
  FPS: 30
};

// --- UTILITÁRIOS ---
function formatarTempoASS(segundos) {
  const date = new Date(Math.max(0, segundos) * 1000);
  const h = String(date.getUTCHours()); // ASS format H:MM:SS.cs
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  const cs = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, '0');
  return `${h}:${m}:${s}.${cs}`;
}

function extrairPalavrasChunk(texto) {
  const textoPuro = texto.replace(/\[.*?\]/g, '').trim();
  return textoPuro.split(/\s+/).filter(w => w.length > 0);
}

// 1. GERADOR DE LEGENDAS AVANÇADAS (.ass)
function gerarSubtitlesASS(chunksTempo, caminhoSaidaAss, format) {
  // Configuração estilo TikTok/MrBeast
  const isShorts = format.height > format.width;
  const fontSize = isShorts ? 65 : 85;
  const marginV = isShorts ? 400 : 100; // Levanta a legenda nos shorts para não ficar no UI do TikTok

  let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${format.width}
PlayResY: ${format.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const chunk of chunksTempo) {
    const startChunk = chunk.startTime;
    const durChunk = chunk.duration;
    
    const palavras = extrairPalavrasChunk(chunk.texto);
    if (palavras.length === 0) continue;

    const tamanhoFrase = isShorts ? 4 : 7; // Menos palavras por linha nos shorts
    const duracaoPorPalavra = durChunk / palavras.length;

    for (let i = 0; i < palavras.length; i += tamanhoFrase) {
      const pedaco = palavras.slice(i, i + tamanhoFrase).join(' ');
      const tStart = startChunk + (i * duracaoPorPalavra);
      const tEnd = startChunk + (Math.min(i + tamanhoFrase, palavras.length) * duracaoPorPalavra);

      // Usando tags ASS para pop in (\fad(50,50)) e highlight básico
      assContent += `Dialogue: 0,${formatarTempoASS(tStart)},${formatarTempoASS(tEnd)},Default,,0,0,0,,{\\fad(50,50)}${pedaco}\n`;
    }
  }

  fs.writeFileSync(caminhoSaidaAss, assContent, 'utf8');
  return caminhoSaidaAss;
}

// 2. PARSER E CALCULADORA DE TEMPO COM SFX E MEMES
async function calcularTimestamps(roteiroLimpo, duracaoTotalAudio) {
  console.log("  ⏳ Calculando timeline (SFX, Memes, Sincronia)...");
  
  const chunks = roteiroLimpo.split(/\n\n+/).filter(c => c.trim().length > 0);
  const totalPalavras = chunks.reduce((acc, chunk) => acc + extrairPalavrasChunk(chunk).length, 0);
  
  const totalPausas = 0.5 + ((chunks.length - 1) * 0.5) + 1.0;
  const tempoLiquidoFala = Math.max(0, duracaoTotalAudio - totalPausas);

  const blocosTempo = [];
  const sfxEvents = [];
  const memeEvents = [];
  
  let currentTime = 0.5;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const words = extrairPalavrasChunk(chunk).length;
    
    // Proporção
    const proporcao = words / (totalPalavras || 1);
    const duracaoFala = proporcao * tempoLiquidoFala;
    const duracaoBlocoInteiro = duracaoFala + (i < chunks.length - 1 ? 0.5 : 1.0);

    // Extrair SFX
    const sfxMatches = chunk.match(/\[SFX_(.*?)\]/g);
    if (sfxMatches) {
      sfxMatches.forEach(match => {
        const sfxName = match.replace('[SFX_', '').replace(']', '').toLowerCase() + '.mp3';
        sfxEvents.push({ name: sfxName, time: currentTime + 0.2 });
      });
    }

    // Extrair MEMES
    const memeMatches = chunk.match(/\[MEME_(.*?)\]/g);
    if (memeMatches) {
      memeMatches.forEach(match => {
        const memeName = match.replace('[MEME_', '').replace(']', '').toLowerCase() + '.mp4';
        memeEvents.push({ name: memeName, time: currentTime + (duracaoBlocoInteiro / 2) });
      });
    }

    blocosTempo.push({
      texto: chunk,
      startTime: currentTime,
      duration: duracaoBlocoInteiro,
      palavras: words
    });
    
    currentTime += duracaoBlocoInteiro;
  }

  return { blocosTempo, sfxEvents, memeEvents };
}

// 3. ESTRUTURAÇÃO DO FILTER_COMPLEX (ZOOMPAN OU CROP)
function construirFiltroBloco(inPad, outPad, duration, vWidth, vHeight, isShorts, index) {
  // Para variar um pouco a dinâmica, podemos fazer alguns blocos terem zoom e outros scroll
  const useZoom = (index % 3 === 0); 
  
  let filterChain = '';
  
  if (useZoom && !isShorts) {
    // Zoom in muito sutil no centro
    // Extrai o topo 16:9 primeiro para evitar processamento massivo de memória
    const cropTopH = `(iw*${vHeight}/${vWidth})`;
    const cropTopFilter = `crop=iw:${cropTopH}:0:0`;
    const zoomFilter = `zoompan=z='min(zoom+0.001,1.1)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${vWidth}x${vHeight}`;
    filterChain = `${cropTopFilter},${zoomFilter}`;
  } else {
    // Scroll vertical da imagem
    // Cropamos a "janela" 16:9 viajando para baixo, depois escalamos
    // Isso economiza até 98% de memória RAM em imagens gigantes (evita ENOMEM erro 4294967284)
    const cropH = `(iw*${vHeight}/${vWidth})`;
    const scrollDistanceExp = `(ih-${cropH})`;
    const progressoExp = `(t/${duration})`;
    const yExp = `max(0,min(${scrollDistanceExp},${progressoExp}*${scrollDistanceExp}))`;
    const cropFilter = `crop=iw:${cropH}:0:'${yExp}'`;
    const scaleFilter = `scale=${vWidth}:${vHeight}`;
    filterChain = `${cropFilter},${scaleFilter}`;
  }

  // Blindagem Anti-Copyright
  const hflipFilter = `hflip`;
  const eqFilter = `eq=brightness=-0.04:contrast=1.02`;
  
  // Transição de quebra (glitch) nos últimos 0.3s
  const glitchStartExp = `max(0, ${duration} - 0.3)`;
  const transitionFilter = `colorchannelmixer=rr=1:gg=1:bb=1:ra=1.2:gb=0.8:enable='gte(t,${glitchStartExp})'`;
  
  // Normalize SAR before concatenating
  const normalizeSar = `setsar=1`;

  return `${inPad}${filterChain},${hflipFilter},${eqFilter},${transitionFilter},${normalizeSar}${outPad}`;
}

// ═══════════════════════════════════════════════════════════════
//  EXECUÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function renderVideo(audioPath, imagesPath, isShortsFormat = false) {
  const dirBase = path.dirname(audioPath);
  const audioName = path.basename(audioPath);
  
  // Extrai o termo de busca limpo (ex: roteiro_ep-0_viewer_postavel_... -> ep-0_viewer)
  const term = audioName.replace(/^roteiro_/, '').split('_postavel')[0].split('_audio')[0];

  // 1. RESOLVER PASTA DE IMAGENS
  let pastaImagens = imagesPath || dirBase;
  if (!fs.existsSync(pastaImagens) || fs.statSync(pastaImagens).isFile()) pastaImagens = dirBase;
  let imagensEncontradas = fs.readdirSync(pastaImagens).filter(f => f.includes('bloco_') && f.endsWith('.png'));
  
  // FALLBACK DE IMAGENS: Se o áudio estiver na raiz e as imagens não estiverem lá, busca na pasta downloads/ correspondente
  if (imagensEncontradas.length === 0) {
    console.log(`  🔍 Imagens não encontradas na pasta local. Buscando na pasta 'downloads'...`);
    const downloadsDir = path.join(__dirname, 'downloads');
    if (fs.existsSync(downloadsDir) && term) {
      const caminhosPossiveis = [
        path.join(downloadsDir, `${term}_corrigido`),
        path.join(downloadsDir, term),
        path.join(downloadsDir, `${term.replace(/_/g, '-')}_corrigido`),
        path.join(downloadsDir, term.replace(/_/g, '-'))
      ];
      
      for (const p of caminhosPossiveis) {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          const imgs = fs.readdirSync(p).filter(f => f.includes('bloco_') && f.endsWith('.png'));
          if (imgs.length > 0) {
            pastaImagens = p;
            imagensEncontradas = imgs;
            console.log(`  ✨ Pasta de imagens encontrada automaticamente: downloads/${path.basename(p)}/`);
            break;
          }
        }
      }
    }
  }

  imagensEncontradas.sort((a, b) => parseInt(a.match(/bloco_(\d+)/)?.[1] || 0) - parseInt(b.match(/bloco_(\d+)/)?.[1] || 0));
  if (imagensEncontradas.length === 0) throw new Error(`Nenhuma imagem bloco_XX.png encontrada.`);
  console.log(`  🖼️  Imagens detectadas: ${imagensEncontradas.length}`);

  // 2. RESOLVER ROTEIRO .TXT
  let roteiroTxtPath = null;
  const baseNameNoDate = audioName.replace(/_audio_.*\.wav$/, '');
  
  const findInDir = (dir, nameMatcher, fallbackMatcher) => {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    let match = files.find(f => f.startsWith(nameMatcher) && f.endsWith('.txt'));
    if (!match && fallbackMatcher) {
      match = files.find(f => f.includes(fallbackMatcher) && f.endsWith('.txt'));
    }
    return match ? path.join(dir, match) : null;
  };

  // Tenta achar na pasta do áudio (dirBase) ou na pasta de imagens resolvida
  roteiroTxtPath = findInDir(dirBase, baseNameNoDate, 'postavel') || 
                   findInDir(pastaImagens, baseNameNoDate, 'postavel');

  // Fallback do Roteiro: busca ampla pelo termo em ambos os locais
  if (!roteiroTxtPath && term) {
    const foldersToSearch = [dirBase, pastaImagens];
    for (const folder of foldersToSearch) {
      if (fs.existsSync(folder)) {
        const files = fs.readdirSync(folder);
        const match = files.find(f => f.toLowerCase().includes(term.toLowerCase()) && f.endsWith('.txt') && f.includes('postavel')) ||
                      files.find(f => f.toLowerCase().includes(term.toLowerCase()) && f.endsWith('.txt'));
        if (match) {
          roteiroTxtPath = path.join(folder, match);
          break;
        }
      }
    }
  }

  if (!roteiroTxtPath) {
    throw new Error(`Não encontrei nenhum roteiro .txt correspondente ao termo "${term}" na pasta do áudio ou na pasta de imagens.`);
  }
  
  console.log(`  📝 Roteiro detectado: ${path.basename(roteiroTxtPath)}`);
  const roteiroOriginal = fs.readFileSync(roteiroTxtPath, 'utf8');
  
  const linhas = roteiroOriginal.split('\n');
  const inicioMeta = linhas.findIndex(l => l.includes('[META'));
  const fimMeta = linhas.findIndex((l, i) => i > inicioMeta && (l.includes('─') || l.includes('===')));
  if (inicioMeta >= 0 && fimMeta >= 0) linhas.splice(inicioMeta, fimMeta - inicioMeta + 1);
  const roteiroLimpo = linhas.join('\n').trim();

  
  // Obter duracao do audio com ffprobe
  const getAudioDuration = (audioPath) => new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
  const duracaoAudio = await getAudioDuration(audioPath);
  
  // Timeline
  const { blocosTempo, sfxEvents, memeEvents } = await calcularTimestamps(roteiroLimpo, duracaoAudio);
  
  const format = isShortsFormat ? CONFIG.RESOLUTION.SHORTS : CONFIG.RESOLUTION.NORMAL;
  
  // Gerar .ASS Subtitles
  const assFileName = path.basename(audioPath).replace('.wav', '.ass');
  const assPath = path.join(dirBase, assFileName);
  gerarSubtitlesASS(blocosTempo, assPath, format);
  console.log(`  📝 Legendas ASS geradas (Karaoke Style): ${assFileName}`);
  console.log(`  🖼️  Imagens detectadas: ${imagensEncontradas.length}`);

  const duracaoPorImagem = duracaoAudio / imagensEncontradas.length;
  
  const cmd = ffmpeg();
  const inputsQueue = []; // rastrear o index de cada input
  
  // Input 0: Áudio Principal
  cmd.input(audioPath);
  inputsQueue.push({ type: 'audio', role: 'voice', path: audioPath });

  // Inputs 1..N: Imagens
  for (const img of imagensEncontradas) {
    const imgP = path.join(pastaImagens, img);
    cmd.input(imgP).inputOptions(['-loop', '1', '-t', duracaoPorImagem.toString()]);
    inputsQueue.push({ type: 'video', role: 'image', path: imgP });
  }

  // Inputs Memes (Overlays)
  // Como simplificação, injetaremos overlays no tempo específico
  const validMemes = [];
  for (const m of memeEvents) {
    const p = path.join('assets', 'memes', m.name);
    if (fs.existsSync(p)) {
      cmd.input(p);
      const idx = inputsQueue.length;
      inputsQueue.push({ type: 'video', role: 'meme', path: p, event: m, idx });
      validMemes.push({ ...m, idx });
      console.log(`  🤡 Meme encontrado: ${m.name} no tempo ${m.time.toFixed(1)}s`);
    } else {
      console.log(`  ⚠️ Aviso: Meme [${m.name}] não encontrado na pasta assets/memes/`);
    }
  }

  // Inputs SFX
  const validSfx = [];
  for (const s of sfxEvents) {
    const p = path.join('assets', 'sfx', s.name);
    if (fs.existsSync(p)) {
      cmd.input(p);
      const idx = inputsQueue.length;
      inputsQueue.push({ type: 'audio', role: 'sfx', path: p, event: s, idx });
      validSfx.push({ ...s, idx });
      console.log(`  🔊 SFX encontrado: ${s.name} no tempo ${s.time.toFixed(1)}s`);
    } else {
      console.log(`  ⚠️ Aviso: SFX [${s.name}] não encontrado na pasta assets/sfx/`);
    }
  }

  // Input BGM (Background Music)
  let hasBgm = false;
  let bgmIdx = -1;
  if (fs.existsSync('assets/bgm')) {
    const bgmFiles = fs.readdirSync('assets/bgm').filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
    if (bgmFiles.length > 0) {
      const p = path.join('assets', 'bgm', bgmFiles[0]); // Pega a primeira
      cmd.input(p).inputOptions(['-stream_loop', '-1']); // Loop infinito caso o vídeo seja longo
      bgmIdx = inputsQueue.length;
      inputsQueue.push({ type: 'audio', role: 'bgm', path: p, idx: bgmIdx });
      hasBgm = true;
      console.log(`  🎶 BGM carregado: ${bgmFiles[0]} (Com Audio Ducking ativado)`);
    }
  }

  // BUILD FILTER COMPLEX
  const filterStrings = [];
  const vConcatPads = [];

  // VÍDEO PRINCIPAL (Imagens)
  for (let i = 0; i < imagensEncontradas.length; i++) {
    const inPad = `[${i + 1}:v]`; // Porque 0 é o áudio da voz
    const outPad = `[v_bloco_${i}]`;
    filterStrings.push(construirFiltroBloco(inPad, outPad, duracaoPorImagem, format.width, format.height, isShortsFormat, i));
    vConcatPads.push(outPad);
  }
  filterStrings.push(`${vConcatPads.join('')}concat=n=${imagensEncontradas.length}:v=1:a=0[v_base_concat]`);

  let currentVideoPad = `[v_base_concat]`;

  // OVERLAY DE MEMES
  // O filtro overlay `enable='between(t,START,END)'` nos permite colocar o meme no meio do vídeo
  // Mas precisamos escalar o meme.
  for (const m of validMemes) {
    const scaledMeme = `[meme_scaled_${m.idx}]`;
    // Scale meme to fit width, maintaining aspect ratio
    filterStrings.push(`[${m.idx}:v]scale=${format.width}:-1[meme_sc_${m.idx}]`);
    // Duração do meme aproximada (vamos sobrepor por 3s por padrão pra não precisar de ffprobe async intenso)
    // Uma solução 100% perfeita usaria ffprobe para pegar a duração exata de cada meme
    const duration = 3.0; 
    const nextVideoPad = `[v_after_meme_${m.idx}]`;
    
    filterStrings.push(`${currentVideoPad}[meme_sc_${m.idx}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:enable='between(t,${m.time},${m.time + duration})'${nextVideoPad}`);
    currentVideoPad = nextVideoPad;
  }

  // LEGENDA (ASS)
  // O ffmpeg tem problemas parseando 'C:' no filtro ass por causa dos ':'. Usar path relativo é mais seguro.
  const relAssPath = path.relative(process.cwd(), assPath).replace(/\\/g, '/');
  filterStrings.push(`${currentVideoPad}ass='${relAssPath}'[v_out]`);

  // ÁUDIO
  const audioOutputs = [];
  
  // Voz principal
  filterStrings.push(`[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.0[a_voz_fmt]`);
  audioOutputs.push(`[a_voz_fmt]`);

  // Memes Áudio (adelay)
  for (const m of validMemes) {
    const ms = Math.floor(m.time * 1000);
    filterStrings.push(`[${m.idx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms}[a_meme_${m.idx}]`);
    audioOutputs.push(`[a_meme_${m.idx}]`);
  }

  // SFX Áudio (adelay)
  for (const s of validSfx) {
    const ms = Math.floor(s.time * 1000);
    filterStrings.push(`[${s.idx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms}[a_sfx_${s.idx}]`);
    audioOutputs.push(`[a_sfx_${s.idx}]`);
  }

  // Mixar Voz, Memes e SFX em uma faixa única (Foreground)
  const fgMixInput = audioOutputs.join('');
  const numFg = audioOutputs.length;
  filterStrings.push(`${fgMixInput}amix=inputs=${numFg}:duration=first:dropout_transition=2[a_fg_mixed]`);

  // BGM e Ducking
  if (hasBgm) {
    // Ducking (Sidechain Compress): a música de fundo abaixa quando o Foreground toca
    // BGM é o canal principal da compressão. O Foreground entra como sidechain (canal 2)
    filterStrings.push(`[${bgmIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.3[a_bgm_fmt]`);
    // Criamos uma cópia do FG para sidechain
    filterStrings.push(`[a_fg_mixed]asplit[a_fg_out][a_fg_sc]`);
    
    const sidechainFilter = `[a_bgm_fmt][a_fg_sc]sidechaincompress=threshold=0.08:ratio=5:attack=5:release=300[a_bgm_ducked]`;
    filterStrings.push(sidechainFilter);

    // Mix final entre BGM ducked e o Foreground preservado
    filterStrings.push(`[a_fg_out][a_bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[a_out]`);
  } else {
    // Sem BGM, o output final de áudio é apenas o foreground
    filterStrings.push(`[a_fg_mixed]volume=1.0[a_out]`);
  }

  console.log('  ⚙️  Configurando Filter Complex (Ducking, SFX e ASS)');
  
  const outFilename = path.basename(audioPath).replace('.wav', '_FINAL_RENDER_V2.mp4');
  const outPath = path.join(dirBase, outFilename);

  return new Promise((resolve, reject) => {
    cmd
      .complexFilter(filterStrings.join(';'), ['v_out', 'a_out'])
      .outputOptions([
        `-c:v libx264`,
        `-preset ultrafast`,
        `-pix_fmt yuv420p`,
        `-c:a aac`,
        `-b:a 192k`,
        `-shortest` // corta o infinito do stream_loop do BGM
      ])
      .save(outPath)
      .on('start', function(commandLine) {
        console.log('  🚀 Renderização Profissional iniciada...');
        console.log('  🛠️  Comando FFmpeg: ' + commandLine);
      })
      .on('progress', function(progress) {
        const timemark = progress.timemark || '00:00:00.00';
        process.stdout.write(`\\r  🔄 Renderizando: Tempo processado: ${timemark} (Frames: ${progress.frames})`);
      })
      .on('end', function() {
        console.log('\\n');
        console.log('  ═══════════════════════════════════════════');
        console.log('  ✅ VÍDEO PROFISSIONAL FINALIZADO!');
        console.log('  ═══════════════════════════════════════════');
        console.log(`  📂 Salvo em: ${outPath}`);
        resolve(outPath);
      })
      .on('error', function(err) {
        console.error('\\n  ❌ Erro no FFmpeg: ' + err.message);
        reject(err);
      });
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const audioParam = args[0];
  const imagesParam = args[1];
  const format = args[2] === 'shorts';

  if (!audioParam) {
    console.error("Uso: node renderizar.js <caminho_do_wav_ou_mp3> [pasta_dos_blocos] [shorts|normal]");
    process.exit(1);
  }

  renderVideo(audioParam, imagesParam, format)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { renderVideo };
