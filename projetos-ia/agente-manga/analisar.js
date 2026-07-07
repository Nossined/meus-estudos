require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ╔══════════════════════════════════════════════════════════════╗
// ║      📖 ANALISADOR DE MANGA — Roteiro via IA de Visão      ║
// ║   Lê os blocos costurados, envia para Gemini com prompt     ║
// ║   milimetricamente calculado e gera um roteiro completo.    ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Configurações ──────────────────────────────────────────────
const CONFIG = {
  // Modelo: gemini-3-flash-preview — 1M tokens, rápido, multimodal, custo baixo
  // Melhor custo-benefício para análise de imagem com alta qualidade
  modelo: 'gemini-3-flash-preview',

  // Extensões de imagem aceitas
  extensoesAceitas: ['.png', '.jpg', '.jpeg', '.webp'],

  // Mapa de mime types
  mimeTypes: {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  },

  // Máximo de blocos por requisição (para não estourar limite de 20MB inline)
  // Se houver mais, faz múltiplas requisições e concatena
  maxBlocosPorRequisicao: 8,

  // Delay entre requisições (ms) para respeitar rate limit
  delayEntreRequisicoes: 2000,
};

// ── Prompt de Análise de Manga/Manhwa ──────────────────────────
// Milimetricamente calculado para extrair o máximo de contexto narrativo
const PROMPT_SISTEMA = `Você é um analista especialista em mangás e manhwas (webtoons coreanos).

Sua missão é analisar as páginas do capítulo fornecidas nas imagens e produzir um roteiro/recap detalhado e enriquecido.

REGRAS ABSOLUTAS:
1. Leia TODAS as imagens na ordem em que foram fornecidas (são páginas sequenciais do capítulo)
2. Transcreva TODOS os diálogos exatamente como aparecem nos balões de fala
3. Descreva TODAS as cenas visuais relevantes (expressões, ações, cenários, efeitos)
4. Identifique e nomeie os personagens (use aparência se o nome não aparecer)
5. Capture onomatopeias e efeitos sonoros importantes
6. Note mudanças de cena, flashbacks e transições narrativas

FORMATO DE SAÍDA:
Gere o roteiro seguindo esta estrutura:

---
# 📖 [Título/Nome do manga se visível]
## Capítulo [Número se visível]

### 🎭 Personagens Identificados
- [Nome/Apelido]: [Breve descrição visual]

### 📜 Roteiro Cena a Cena

#### Cena 1 — [Título curto da cena]
**[Cenário/Ambiente]**

> [Diálogo do Personagem 1]: "texto exato do balão"
> [Diálogo do Personagem 2]: "texto exato do balão"

*[Descrição de ação/expressão/efeito visual]*

[Continue com todas as cenas...]

### 🔍 Análise Narrativa
- **Eventos-chave**: [lista dos acontecimentos mais importantes]
- **Desenvolvimento de personagens**: [mudanças notáveis]
- **Pistas/Foreshadowing**: [elementos que podem ser importantes depois]
- **Cliffhanger/Gancho**: [como o capítulo termina]

### 📝 Resumo Executivo
[Parágrafo de 3-5 linhas com o resumo completo do capítulo]
---

NOTAS IMPORTANTES:
- Se o manga estiver em coreano, japonês ou chinês, traduza os diálogos para português
- Se estiver em inglês, transcreva em inglês E adicione tradução em português entre parênteses
- Seja rico em detalhes visuais — sua análise será usada por pessoas que não verão as imagens
- Deduza e enriqueça o contexto quando possível (motivações, emoções, subtexto)
- Marque claramente quando estiver deduzindo vs transcrevendo literalmente`;


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

function formatarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Lista pastas _corrigido dentro de ./downloads
 */
function listarPastasCorrigidas() {
  const downloadsDir = path.resolve('.', 'downloads');
  if (!fs.existsSync(downloadsDir)) return [];

  return fs.readdirSync(downloadsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.endsWith('_corrigido'))
    .map(d => d.name);
}

/**
 * Busca e ordena imagens de blocos
 */
function buscarBlocosOrdenados(pasta) {
  return fs.readdirSync(pasta)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return CONFIG.extensoesAceitas.includes(ext);
    })
    .sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/(\d+)/)?.[1] || '0', 10);
      return numA - numB;
    })
    .map(f => path.join(pasta, f));
}

/**
 * Valida a chave API
 */
function validarChaveAPI() {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave || chave === 'sua_chave_aqui' || chave.length < 10) {
    console.log('  ❌ Chave API do Gemini não encontrada ou inválida!');
    console.log('');
    console.log('  💡 Configure sua chave no arquivo .env:');
    console.log('     GEMINI_API_KEY="sua_chave_aqui"');
    console.log('');
    console.log('  🔗 Obtenha uma chave em: https://aistudio.google.com/apikey');
    process.exit(1);
  }

  // Protege a chave no log (mostra só início e fim)
  const mascarada = chave.substring(0, 6) + '...' + chave.substring(chave.length - 4);
  console.log(`  🔑 Chave API detectada: ${mascarada}`);
  return chave;
}


// ═══════════════════════════════════════════════════════════════
//  MOTOR DE ANÁLISE VIA GEMINI
// ═══════════════════════════════════════════════════════════════

/**
 * Converte uma imagem para o formato inline do Gemini (base64)
 */
function imagemParaInlineData(caminhoImagem) {
  const ext = path.extname(caminhoImagem).toLowerCase();
  const mimeType = CONFIG.mimeTypes[ext] || 'image/png';
  const base64Data = fs.readFileSync(caminhoImagem, { encoding: 'base64' });

  return {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };
}

/**
 * Calcula o tamanho total em bytes dos blocos (para verificar limite de 20MB)
 */
function calcularTamanhoTotal(blocos) {
  let total = 0;
  for (const bloco of blocos) {
    total += fs.statSync(bloco).size;
  }
  return total;
}

/**
 * Divide blocos em lotes respeitando o limite de 20MB por requisição
 */
function dividirEmLotes(blocos) {
  const lotes = [];
  let loteAtual = [];
  let tamanhoAtual = 0;
  const LIMITE_BYTES = 18 * 1024 * 1024; // 18MB (margem de segurança)

  for (const bloco of blocos) {
    const tamanho = fs.statSync(bloco).size;

    if (loteAtual.length >= CONFIG.maxBlocosPorRequisicao ||
        (tamanhoAtual + tamanho) > LIMITE_BYTES) {
      if (loteAtual.length > 0) lotes.push([...loteAtual]);
      loteAtual = [bloco];
      tamanhoAtual = tamanho;
    } else {
      loteAtual.push(bloco);
      tamanhoAtual += tamanho;
    }
  }

  if (loteAtual.length > 0) lotes.push(loteAtual);
  return lotes;
}

/**
 * Envia um lote de imagens para o Gemini e retorna a análise
 */
async function analisarLote(ai, blocos, indiceLote, totalLotes) {
  // Monta o conteúdo: imagens + prompt
  const contents = [];

  // Instrução de contexto para lotes parciais
  if (totalLotes > 1) {
    contents.push({
      text: `[CONTEXTO: Esta é a parte ${indiceLote + 1} de ${totalLotes} do capítulo. Analise estas páginas continuando de onde a parte anterior parou. Mantenha a mesma estrutura e formato.]`,
    });
  }

  // Adiciona cada bloco como imagem inline
  for (let i = 0; i < blocos.length; i++) {
    const nomeBloco = path.basename(blocos[i]);
    const tamanho = formatarBytes(fs.statSync(blocos[i]).size);
    console.log(`     📸 Codificando ${nomeBloco} (${tamanho})...`);

    contents.push(imagemParaInlineData(blocos[i]));
    contents.push({
      text: `[Bloco ${i + 1} de ${blocos.length} — páginas sequenciais do manga]`,
    });
  }

  // Prompt principal
  contents.push({ text: PROMPT_SISTEMA });

  console.log(`     🧠 Enviando para Gemini (${CONFIG.modelo})...`);
  console.log('     ⏳ Aguardando resposta (pode levar 30-90 segundos)...');
  console.log('');

  try {
    const response = await ai.models.generateContent({
      model: CONFIG.modelo,
      contents: contents,
      config: {
        temperature: 0.3,       // Baixo para fidelidade ao conteúdo
        maxOutputTokens: 65536,  // Máximo de tokens na resposta
        topP: 0.8,
        topK: 40,
      },
    });

    if (!response.text) {
      console.log('  ⚠️  Resposta vazia do modelo. Possíveis causas:');
      console.log('     • Conteúdo bloqueado por filtro de segurança');
      console.log('     • Imagens muito grandes');
      return '[Resposta vazia — conteúdo possivelmente bloqueado por filtro de segurança]';
    }

    return response.text;
  } catch (err) {
    console.error(`  ❌ Erro na API: ${err.message}`);

    if (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('429')) {
      console.log('  ⏳ Rate limit atingido. Aguardando 30 segundos...');
      await esperar(30000);
      // Retry uma vez
      try {
        const response = await ai.models.generateContent({
          model: CONFIG.modelo,
          contents: contents,
          config: { temperature: 0.3, maxOutputTokens: 65536 },
        });
        return response.text || '[Resposta vazia no retry]';
      } catch (retryErr) {
        return `[ERRO no retry: ${retryErr.message}]`;
      }
    }

    return `[ERRO: ${err.message}]`;
  }
}


// ═══════════════════════════════════════════════════════════════
//  EXECUÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function iniciar() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   📖 ANALISADOR DE MANGA — Roteiro via IA   ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // ── Validar chave API ──────────────────────────────────
  const chaveAPI = validarChaveAPI();
  const ai = new GoogleGenAI({ apiKey: chaveAPI });

  // ── Selecionar pasta corrigida ─────────────────────────
  let pastaAlvo = process.argv[2];

  if (!pastaAlvo) {
    const pastas = listarPastasCorrigidas();

    if (pastas.length === 0) {
      console.log('  ❌ Nenhuma pasta _corrigido encontrada em ./downloads/');
      console.log('  💡 Execute primeiro:');
      console.log('     1. node agente.js <URL>    (capturar)');
      console.log('     2. node juntar.js           (costurar blocos)');
      process.exit(1);
    }

    console.log('  📂 Pastas corrigidas disponíveis:');
    console.log('');
    pastas.forEach((p, i) => {
      const qtd = buscarBlocosOrdenados(path.resolve('.', 'downloads', p)).length;
      const tamanho = formatarBytes(
        calcularTamanhoTotal(buscarBlocosOrdenados(path.resolve('.', 'downloads', p)))
      );
      console.log(`     ${i + 1}. ${p}  (${qtd} blocos, ${tamanho})`);
    });
    console.log('');

    const escolha = await perguntar('  🔢 Escolha o número da pasta: ');
    const idx = parseInt(escolha, 10);
    if (idx >= 1 && idx <= pastas.length) {
      pastaAlvo = path.resolve('.', 'downloads', pastas[idx - 1]);
    } else {
      console.log('  ❌ Opção inválida');
      process.exit(1);
    }
  } else {
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

  // ── Buscar blocos ──────────────────────────────────────
  const blocos = buscarBlocosOrdenados(pastaAlvo);
  const tamanhoTotal = calcularTamanhoTotal(blocos);

  console.log('');
  console.log(`  📊 Blocos encontrados: ${blocos.length}`);
  console.log(`  📦 Tamanho total: ${formatarBytes(tamanhoTotal)}`);

  if (blocos.length === 0) {
    console.log('  ❌ Nenhuma imagem encontrada na pasta');
    process.exit(1);
  }

  // ── Dividir em lotes se necessário ─────────────────────
  const lotes = dividirEmLotes(blocos);

  if (lotes.length > 1) {
    console.log(`  📋 Dividido em ${lotes.length} lotes (limite de 18MB por requisição)`);
    lotes.forEach((lote, i) => {
      const tam = formatarBytes(calcularTamanhoTotal(lote));
      console.log(`     Lote ${i + 1}: ${lote.length} blocos (${tam})`);
    });
  }

  console.log(`  🤖 Modelo: ${CONFIG.modelo}`);
  console.log('');
  console.log('  ═══════════════════════════════════════════');
  console.log('  🧠 INICIANDO ANÁLISE COM IA');
  console.log('  ═══════════════════════════════════════════');
  console.log('');

  // ── Processar cada lote ────────────────────────────────
  const inicio = Date.now();
  const resultados = [];

  for (let i = 0; i < lotes.length; i++) {
    if (lotes.length > 1) {
      console.log(`  ── Lote ${i + 1}/${lotes.length} ──────────────────────────`);
    }

    const resultado = await analisarLote(ai, lotes[i], i, lotes.length);
    resultados.push(resultado);

    mostrarProgresso(i + 1, lotes.length, `Lote ${i + 1} concluído`);

    // Delay entre lotes
    if (i < lotes.length - 1) {
      console.log(`  ⏳ Aguardando ${CONFIG.delayEntreRequisicoes / 1000}s antes do próximo lote...`);
      await esperar(CONFIG.delayEntreRequisicoes);
    }
  }

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);

  // ── Montar documento final ─────────────────────────────
  const nomeOriginal = path.basename(pastaAlvo).replace('_corrigido', '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  let documentoFinal = '';
  documentoFinal += `═══════════════════════════════════════════════════════\n`;
  documentoFinal += `  📖 ROTEIRO/RECAP GERADO POR IA\n`;
  documentoFinal += `  Manga: ${nomeOriginal}\n`;
  documentoFinal += `  Modelo: ${CONFIG.modelo}\n`;
  documentoFinal += `  Data: ${new Date().toLocaleString('pt-BR')}\n`;
  documentoFinal += `  Blocos analisados: ${blocos.length}\n`;
  documentoFinal += `  Lotes processados: ${lotes.length}\n`;
  documentoFinal += `  Tempo de processamento: ${duracao}s\n`;
  documentoFinal += `═══════════════════════════════════════════════════════\n\n`;

  for (let i = 0; i < resultados.length; i++) {
    if (lotes.length > 1) {
      documentoFinal += `\n${'─'.repeat(50)}\n`;
      documentoFinal += `  PARTE ${i + 1} DE ${lotes.length}\n`;
      documentoFinal += `${'─'.repeat(50)}\n\n`;
    }
    documentoFinal += resultados[i];
    documentoFinal += '\n\n';
  }

  // ── Salvar arquivo ─────────────────────────────────────
  const nomeArquivo = `roteiro_${nomeOriginal}_${timestamp}.txt`;
  const caminhoSaida = path.join(path.dirname(pastaAlvo), nomeArquivo);

  fs.writeFileSync(caminhoSaida, documentoFinal, 'utf-8');

  // Também salva uma cópia na raiz do projeto para fácil acesso
  const copiaRaiz = path.resolve('.', nomeArquivo);
  fs.writeFileSync(copiaRaiz, documentoFinal, 'utf-8');

  // ── Relatório final ────────────────────────────────────
  const tamanhoArquivo = formatarBytes(fs.statSync(caminhoSaida).size);
  const linhas = documentoFinal.split('\n').length;
  const palavras = documentoFinal.split(/\s+/).length;

  console.log('');
  console.log('  ═══════════════════════════════════════════');
  console.log('  ✅ ROTEIRO GERADO COM SUCESSO!');
  console.log('  ═══════════════════════════════════════════');
  console.log('');
  console.log(`  📊 Resultado:`);
  console.log(`     • Arquivo: ${nomeArquivo}`);
  console.log(`     • Tamanho: ${tamanhoArquivo}`);
  console.log(`     • Linhas: ${linhas}`);
  console.log(`     • Palavras: ~${palavras}`);
  console.log(`     • Tempo: ${duracao}s`);
  console.log('');
  console.log(`  📂 Salvo em:`);
  console.log(`     • ${caminhoSaida}`);
  console.log(`     • ${copiaRaiz}`);
  console.log('');
  console.log('  💡 Abra o arquivo .txt para ler o roteiro completo!');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
//  PONTO DE ENTRADA
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
  iniciar().catch(err => {
    console.error(`  💀 Erro fatal: ${err.message}`);

    // Proteção: nunca logue a chave API
    if (err.stack && !err.stack.includes(process.env.GEMINI_API_KEY || '')) {
      console.error(err.stack);
    }

    process.exit(1);
  });
}

module.exports = { iniciarAnalisador: iniciar };
