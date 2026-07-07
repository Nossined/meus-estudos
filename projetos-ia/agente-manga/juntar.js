const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ╔══════════════════════════════════════════════════════════════╗
// ║        🧩 JUNTADOR DE MANGA — Merge Vertical Inteligente   ║
// ║   Junta as imagens capturadas em blocos verticais para      ║
// ║   alimentar IAs de visão com máximo contexto e qualidade.   ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Configurações ──────────────────────────────────────────────
const CONFIG = {
  // Altura máxima por imagem final (em pixels).
  // Modelos de visão como GPT-4o, Claude, Gemini processam melhor
  // imagens até ~16k px de altura. 12000px é um bom equilíbrio
  // entre contexto máximo e compatibilidade.
  alturaMaximaPorBloco: 12000,

  // Número máximo de páginas por bloco (fallback caso todas sejam baixinhas)
  maximoPaginasPorBloco: 15,

  // Qualidade de saída (PNG = lossless, ideal para IA)
  formato: 'png',

  // Nível de compressão PNG (0-9, onde 6 é bom equilíbrio tamanho/velocidade)
  compressaoPNG: 6,

  // Extensões aceitas
  extensoesAceitas: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tiff'],
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

function mostrarProgresso(atual, total, texto = '') {
  const largura = 30;
  const pct = Math.round((atual / total) * 100);
  const preenchido = Math.round((atual / total) * largura);
  const barra = '█'.repeat(preenchido) + '░'.repeat(largura - preenchido);
  process.stdout.write(`\r  [${barra}] ${pct}% (${atual}/${total}) ${texto}  `);
  if (atual === total) process.stdout.write('\n');
}

/**
 * Lista pastas dentro de ./downloads
 */
function listarPastasDownloads() {
  const downloadsDir = path.resolve('.', 'downloads');
  if (!fs.existsSync(downloadsDir)) return [];

  return fs.readdirSync(downloadsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.endsWith('_corrigido'))
    .map(d => d.name);
}

/**
 * Busca e ordena imagens em uma pasta por nome numérico crescente
 */
function buscarImagensOrdenadas(pasta) {
  const arquivos = fs.readdirSync(pasta)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return CONFIG.extensoesAceitas.includes(ext);
    })
    .sort((a, b) => {
      // Extrai números do nome do arquivo para ordenação natural
      const numA = parseInt(a.match(/(\d+)/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/(\d+)/)?.[1] || '0', 10);
      return numA - numB;
    });

  return arquivos.map(f => path.join(pasta, f));
}

/**
 * Obtém metadados de uma imagem (largura, altura)
 */
async function obterMetadados(caminhoImagem) {
  try {
    const meta = await sharp(caminhoImagem).metadata();
    return {
      caminho: caminhoImagem,
      largura: meta.width || 0,
      altura: meta.height || 0,
      formato: meta.format || 'unknown',
    };
  } catch (err) {
    console.log(`  ⚠️  Não foi possível ler: ${path.basename(caminhoImagem)} — ${err.message}`);
    return null;
  }
}

/**
 * Formata bytes para exibição legível
 */
function formatarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


// ═══════════════════════════════════════════════════════════════
//  MOTOR DE AGRUPAMENTO
// ═══════════════════════════════════════════════════════════════

/**
 * Divide as imagens em blocos respeitando o limite de altura.
 * Cada bloco terá no máximo `alturaMaximaPorBloco` pixels de altura
 * e no máximo `maximoPaginasPorBloco` imagens.
 *
 * Isso garante que cada imagem final tenha contexto suficiente
 * para a IA processar sem perder qualidade ou atingir limites.
 */
function criarBlocos(metadados) {
  const blocos = [];
  let blocoAtual = [];
  let alturaAcumulada = 0;

  for (const meta of metadados) {
    const adicionarAoBlocoAtual =
      blocoAtual.length < CONFIG.maximoPaginasPorBloco &&
      (alturaAcumulada + meta.altura) <= CONFIG.alturaMaximaPorBloco;

    if (adicionarAoBlocoAtual || blocoAtual.length === 0) {
      // Adiciona ao bloco atual
      blocoAtual.push(meta);
      alturaAcumulada += meta.altura;
    } else {
      // Bloco cheio — salva e começa novo
      blocos.push([...blocoAtual]);
      blocoAtual = [meta];
      alturaAcumulada = meta.altura;
    }
  }

  // Último bloco
  if (blocoAtual.length > 0) {
    blocos.push(blocoAtual);
  }

  return blocos;
}


// ═══════════════════════════════════════════════════════════════
//  MOTOR DE MERGE
// ═══════════════════════════════════════════════════════════════

/**
 * Junta um bloco de imagens verticalmente.
 *
 * Todas as imagens são redimensionadas para a mesma largura
 * (a maior do bloco) para alinhamento perfeito.
 * Usa PNG sem perdas para máxima qualidade para IA.
 */
async function juntarBloco(bloco, caminhoSaida, indice, totalBlocos) {
  // Determina a largura final (usa a maior para não perder detalhes)
  const larguraFinal = Math.max(...bloco.map(m => m.largura));

  // Prepara cada imagem: redimensiona para largura uniforme
  const imagensProcessadas = [];
  let alturaTotal = 0;

  for (const meta of bloco) {
    // Redimensiona mantendo proporção se necessário
    let imgBuffer;
    if (meta.largura !== larguraFinal) {
      imgBuffer = await sharp(meta.caminho)
        .resize({ width: larguraFinal, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .toBuffer();
    } else {
      imgBuffer = await sharp(meta.caminho).toBuffer();
    }

    const metaProcessada = await sharp(imgBuffer).metadata();
    imagensProcessadas.push({
      input: imgBuffer,
      top: alturaTotal,
      left: 0,
    });
    alturaTotal += metaProcessada.height;
  }

  // Cria a imagem final composta
  await sharp({
    create: {
      width: larguraFinal,
      height: alturaTotal,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(imagensProcessadas)
    .png({
      compressionLevel: CONFIG.compressaoPNG,
      adaptiveFiltering: true,
    })
    .toFile(caminhoSaida);

  const stats = fs.statSync(caminhoSaida);
  const nomes = bloco.map(m => path.basename(m.caminho));
  const primeiro = nomes[0];
  const ultimo = nomes[nomes.length - 1];

  mostrarProgresso(indice + 1, totalBlocos,
    `bloco_${String(indice + 1).padStart(2, '0')}.png (${primeiro} → ${ultimo}) [${formatarBytes(stats.size)}]`
  );
}


// ═══════════════════════════════════════════════════════════════
//  EXECUÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function iniciar() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   🧩 JUNTADOR DE MANGA — Merge Inteligente  ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // ── Selecionar pasta ───────────────────────────────────
  let pastaAlvo = process.argv[2];

  if (!pastaAlvo) {
    const pastas = listarPastasDownloads();

    if (pastas.length === 0) {
      console.log('  ❌ Nenhuma pasta encontrada em ./downloads/');
      console.log('  💡 Execute primeiro: node agente.js <URL>');
      process.exit(1);
    }

    console.log('  📂 Pastas disponíveis em ./downloads/:');
    console.log('');
    pastas.forEach((p, i) => {
      const qtd = buscarImagensOrdenadas(path.resolve('.', 'downloads', p)).length;
      console.log(`     ${i + 1}. ${p}  (${qtd} imagens)`);
    });
    console.log('');

    const escolha = await perguntar('  🔢 Escolha o número da pasta (ou caminho completo): ');

    const idx = parseInt(escolha, 10);
    if (idx >= 1 && idx <= pastas.length) {
      pastaAlvo = path.resolve('.', 'downloads', pastas[idx - 1]);
    } else if (fs.existsSync(escolha)) {
      pastaAlvo = path.resolve(escolha);
    } else {
      console.log('  ❌ Opção inválida');
      process.exit(1);
    }
  } else {
    // Se passaram um nome simples, resolve dentro de downloads
    if (!path.isAbsolute(pastaAlvo) && !fs.existsSync(pastaAlvo)) {
      const tentativa = path.resolve('.', 'downloads', pastaAlvo);
      if (fs.existsSync(tentativa)) pastaAlvo = tentativa;
    }
    pastaAlvo = path.resolve(pastaAlvo);
  }

  if (!fs.existsSync(pastaAlvo)) {
    console.log(`  ❌ Pasta não encontrada: ${pastaAlvo}`);
    process.exit(1);
  }

  // ── Buscar imagens ─────────────────────────────────────
  const imagens = buscarImagensOrdenadas(pastaAlvo);
  console.log(`  📊 Imagens encontradas: ${imagens.length}`);

  if (imagens.length === 0) {
    console.log('  ❌ Nenhuma imagem encontrada na pasta');
    process.exit(1);
  }

  // ── Obter metadados de cada imagem ─────────────────────
  console.log('  🔍 Analisando dimensões...');
  const metadados = [];
  for (let i = 0; i < imagens.length; i++) {
    const meta = await obterMetadados(imagens[i]);
    if (meta) metadados.push(meta);
    mostrarProgresso(i + 1, imagens.length, path.basename(imagens[i]));
  }

  if (metadados.length === 0) {
    console.log('  ❌ Nenhuma imagem válida encontrada');
    process.exit(1);
  }

  // ── Estatísticas ───────────────────────────────────────
  const alturaTotal = metadados.reduce((s, m) => s + m.altura, 0);
  const larguraMedia = Math.round(metadados.reduce((s, m) => s + m.largura, 0) / metadados.length);
  const alturaMedia = Math.round(alturaTotal / metadados.length);

  console.log('');
  console.log('  📐 Estatísticas das imagens:');
  console.log(`     • Total de imagens válidas: ${metadados.length}`);
  console.log(`     • Largura média: ${larguraMedia}px`);
  console.log(`     • Altura média: ${alturaMedia}px`);
  console.log(`     • Altura total empilhada: ${alturaTotal.toLocaleString()}px`);

  // ── Criar blocos ───────────────────────────────────────
  const blocos = criarBlocos(metadados);
  console.log(`     • Blocos a gerar: ${blocos.length}`);
  console.log(`     • Limite por bloco: ${CONFIG.alturaMaximaPorBloco.toLocaleString()}px / ${CONFIG.maximoPaginasPorBloco} páginas`);

  // Mostra composição dos blocos
  console.log('');
  console.log('  📋 Composição dos blocos:');
  blocos.forEach((bloco, i) => {
    const altBloco = bloco.reduce((s, m) => s + m.altura, 0);
    const primeiro = path.basename(bloco[0].caminho);
    const ultimo = path.basename(bloco[bloco.length - 1].caminho);
    console.log(`     Bloco ${String(i + 1).padStart(2, '0')}: ${bloco.length} págs (${primeiro} → ${ultimo}) — ${altBloco.toLocaleString()}px alt.`);
  });

  // ── Criar pasta de saída ───────────────────────────────
  const nomeOriginal = path.basename(pastaAlvo);
  const pastaSaida = path.join(path.dirname(pastaAlvo), `${nomeOriginal}_corrigido`);

  if (!fs.existsSync(pastaSaida)) {
    fs.mkdirSync(pastaSaida, { recursive: true });
  }

  console.log('');
  console.log(`  📂 Salvando em: ${pastaSaida}`);
  console.log('');
  console.log('  ═══════════════════════════════════════════');
  console.log('  🔨 INICIANDO MERGE DOS BLOCOS');
  console.log('  ═══════════════════════════════════════════');
  console.log('');

  // ── Processar cada bloco ───────────────────────────────
  const inicio = Date.now();

  for (let i = 0; i < blocos.length; i++) {
    const numero = String(i + 1).padStart(2, '0');
    const caminhoSaida = path.join(pastaSaida, `bloco_${numero}.png`);

    await juntarBloco(blocos[i], caminhoSaida, i, blocos.length);
  }

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);

  // ── Relatório final ────────────────────────────────────
  const arquivosSaida = fs.readdirSync(pastaSaida).filter(f => f.endsWith('.png'));
  let tamanhoTotal = 0;
  for (const arq of arquivosSaida) {
    tamanhoTotal += fs.statSync(path.join(pastaSaida, arq)).size;
  }

  console.log('');
  console.log('  ═══════════════════════════════════════════');
  console.log('  ✅ MERGE CONCLUÍDO!');
  console.log('  ═══════════════════════════════════════════');
  console.log('');
  console.log(`  📊 Resultado:`);
  console.log(`     • ${metadados.length} imagens → ${blocos.length} blocos`);
  console.log(`     • Tamanho total: ${formatarBytes(tamanhoTotal)}`);
  console.log(`     • Tempo: ${duracao}s`);
  console.log(`     • Formato: PNG (lossless — qualidade máxima para IA)`);
  console.log(`     • Saída: ${pastaSaida}`);
  console.log('');
  console.log('  💡 Agora você pode alimentar os blocos a uma IA de visão.');
  console.log('     Cada bloco tem contexto contínuo do manga em alta qualidade.');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
//  PONTO DE ENTRADA
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
  iniciar().catch(err => {
    console.error(`  💀 Erro fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { iniciarJuntar: iniciar };
