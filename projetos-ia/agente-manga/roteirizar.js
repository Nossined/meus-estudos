require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ╔══════════════════════════════════════════════════════════════╗
// ║     🎬 ROTEIRIZADOR — Copywriting para YouTube / TTS       ║
// ║   Transforma o recap bruto em roteiro narrado com carisma,  ║
// ║   ritmo e tensão narrativa. Pronto pro ElevenLabs.          ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Tons de narração disponíveis ───────────────────────────────
const TONS = {
  epico: {
    nome: '⚔️  Épico',
    descricao: 'Narrador sério, intenso, focado no impacto da ação sem poesia barata.',
    instrucao: `Você é um narrador SÉRIO e INTENSO. Sua voz transmite o peso das consequências.
    REGRAS DE ESTILO (CRÍTICO):
    1. PROIBIDO usar vocabulário melodramático ou poético. Use palavras cruas, viscerais e diretas.
    2. Construa a tensão usando frases curtas e pontos finais absolutos. 
    3. Fale como um veterano de guerra narrando um evento real e brutal.
    4. USO DE TAGS DE ÁUDIO OBRIGATÓRIO: Inicie frases épicas e violentas com [shouting] ou [excitedly], e momentos de tensão extrema com [whisper].
    Exemplo: "[whisper] Ele não hesitou. [shouting] O corte foi limpo, seco e destruiu a fundação da torre."`,
  },

  ironico: {
    nome: '😏 Irônico',
    descricao: 'Narrador sarcástico, debochado, porém inteligente e com limite no humor.',
    instrucao: `Você é um narrador IRÔNICO e ÁCIDO. Você narra a história com sarcasmo e inteligência, apontando os clichês e o absurdo da situação.
    REGRAS CRÍTICAS DE BALANCEAMENTO:
    1. Limite-se a 2 ou 3 piadas/analogias "gamer/nerd" curtas por roteiro para não quebrar a imersão do drama. 
    2. Aja com cinismo focado nas atitudes dos personagens e não forçando paralelos longos e aleatórios com a vida real.
    3. USO DE TAGS DE ÁUDIO OBRIGATÓRIO: Use [bored] e [reluctantly] para expressar cinismo ou cansaço com os clichês. Use [excitedly] apenas para a zoeira ou quando a ação for genuinamente surpreendente.
    Exemplo: "[bored] Claro, porque socar um dragão é uma excelente ideia. [excitedly] Mas por algum motivo absurdo... DEU CERTO!"`,
  },

  misterioso: {
    nome: '🌑 Misterioso',
    descricao: 'Narrador sussurrado, tenso, cheio de suspense',
    instrucao: `Você é um narrador MISTERIOSO. Cada frase carrega peso, cada pausa é intencional.
Você fala como se soubesse de um segredo que o ouvinte ainda não descobriu.
Tom sussurrado, tenso, que faz a pessoa inclinar pra frente e prestar atenção.
USO DE TAGS DE ÁUDIO OBRIGATÓRIO: Espalhe a tag [whisper] em parágrafos de suspense e revelação. Use [reluctantly] para mostrar hesitação diante do terror.
Exemplo: "[whisper] Tinha algo errado naquele sorriso. Algo que ninguém percebeu... [reluctantly] até ser tarde demais."`,
  },

  hype: {
    nome: '🔥 Hype',
    descricao: 'Narrador energético, gritando de empolgação, tipo react',
    instrucao: `Você é um narrador HYPE. Pura energia, empolgação a mil, sem freio.
Você fala como se estivesse fazendo uma react ao vivo e acabou de ver a cena mais insana da história.
Use CAPS LOCK estratégico, exclamações, onomatopeias, expressões de choque.
USO DE TAGS DE ÁUDIO OBRIGATÓRIO: A base da sua narração é em [excitedly]. Nos clímaxes insanos, troque para [shouting].
Exemplo: "[excitedly] MANO. MANO. Vocês NÃO estão preparados pro que esse cara acabou de fazer. [shouting] Ele LITERALMENTE olhou pro vilão e disse 'é isso?'"`,
  },

  analitico: {
    nome: '🧠 Analítico',
    descricao: 'Narrador intelectual, profundo, tipo vídeo-ensaio',
    instrucao: `Você é um narrador ANALÍTICO e INTELECTUAL. Você não só conta a história — você DISSECA ela.
Conecte temas, simbolismos, paralelos com outras obras e com a vida real.
USO DE TAGS DE ÁUDIO OBRIGATÓRIO: Mantenha um tom neutro por padrão, mas use [whisper] para descobertas profundas e [excitedly] quando estiver conectando um simbolismo "mind-blowing".
Exemplo: "O que torna essa cena devastadora não é a traição em si... [whisper] é o fato de que o autor passou 40 capítulos nos fazendo confiar nele."`,
  },
};

// ── Configurações ──────────────────────────────────────────────
const CONFIG = {
  modelo: 'gemini-3-flash-preview',

  // Tom padrão: aleatório entre os disponíveis
  tomPadrao: 'random',

  // Duração alvo do roteiro em minutos (para TTS ~150 palavras/min)
  duracaoAlvoMinutos: 17, // meio termo de 15-20

  // Palavras por minuto médio de TTS
  palavrasPorMinuto: 150,
};

// ── Prompt do Roteirizador ─────────────────────────────────────
function gerarPromptRoteirizador(tomEscolhido, nomeObra, duracaoMinutos) {
  const palavrasAlvo = duracaoMinutos * CONFIG.palavrasPorMinuto;

  return `${tomEscolhido.instrucao}

═══════════════════════════════════════════════════════
MISSÃO: ROTEIRO DE YOUTUBE SOBRE MANGA/MANHWA
═══════════════════════════════════════════════════════

O NOME REAL DA OBRA É: "${nomeObra}"
(Use SOMENTE este nome. Corrija qualquer variação ou erro que apareça no recap bruto.)

Você vai receber um recap estruturado de um capítulo de manga/manhwa. Sua missão é TRANSFORMAR esse recap em um roteiro de narração para YouTube de ${duracaoMinutos} minutos (~${palavrasAlvo} palavras).

REGRAS ABSOLUTAS DO ROTEIRO E ÁUDIO GEMINI TTS:

1. NUNCA use formatação markdown. NUNCA use asteriscos (* ou **). NUNCA use emojis. O texto será lido por uma IA de voz, então qualquer caractere especial pode ser lido em voz alta erroneamente.
   
2. TAGS DE ÁUDIO OBRIGATÓRIAS: O sistema que vai narrar isso suporta as tags nativas do Gemini TTS.
   Você DEVE inserir estas tags EXATAMENTE DESSA FORMA e SEMPRE NO INÍCIO DAS FRASES:
   [excitedly] -> Para empolgação, animação, tom para cima.
   [bored] -> Para tédio, cinismo, narração desinteressada ou sarcástica.
   [reluctantly] -> Para relutância, medo, hesitação, tensão.
   [whisper] -> Para segredos, terror, suspense, sussurros tensos.
   [shouting] -> Para berros, golpes finais, pânico, surtos absolutos.
   (Espalhe essas tags ao longo do texto de acordo com as instruções da sua personalidade.)

3. O texto deve FLUIR como uma narrativa oral contínua.
   Sem listas, sem bullets, sem tabelas. Apenas parágrafos de narração em prosa contínua.

4. Separe os parágrafos com UMA linha em branco (isso gera pausas naturais no TTS).

5. Use "..." para pausas dramáticas curtas e vírgulas para respiros.

6. DURAÇÃO: O roteiro deve ter aproximadamente ${palavrasAlvo} palavras.

7. ESTRUTURA NARRATIVA (sem rótulos visíveis, apenas o fluxo):
   - GANCHO (0:00-0:30): Frase de impacto ou pergunta provocativa
   - CONTEXTO (0:30-2:00): Situe o espectador na história (sem spoiler do clímax)
   - DESENVOLVIMENTO (2:00-12:00): Narre os eventos com ritmo, tensão e emoção
   - CLÍMAX (12:00-15:00): O momento mais intenso, com toda a carga dramática
   - REFLEXÃO (15:00-17:00): Amarre pontas, reflita sobre o significado
   - CTA (17:00-17:30): Peça like/inscrição rapidamente (lembre-se: sem emojis)

8. DIÁLOGOS: Quando citar falas dos personagens, use aspas e atribua ao personagem, possivelmente adicionando uma tag como [shouting] "Eu não vou recuar!".

9. ENRIQUECIMENTO: Você pode (e deve) deduzir emoções, motivações e subtexto.

10. IDIOMA: Todo o roteiro deve ser em PORTUGUÊS BRASILEIRO.

11. PROIBIDO: Emojis, marcações Markdown (como #, *, _, ~), hashtags, timestamps visíveis, "SPOILER ALERT". Apenas TEXTO PURO.

RECAP BRUTO PARA TRANSFORMAR:
═══════════════════════════════════════════════════════`;
}


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

/**
 * Lista arquivos .txt de roteiro dentro de ./downloads e na raiz
 */
function listarRoteiros() {
  const resultados = [];

  // Busca na raiz do projeto
  const raiz = path.resolve('.');
  const arquivosRaiz = fs.readdirSync(raiz)
    .filter(f => f.startsWith('roteiro_') && f.endsWith('.txt'));
  for (const arq of arquivosRaiz) {
    resultados.push(path.join(raiz, arq));
  }

  // Busca dentro de ./downloads (e subpastas)
  const downloadsDir = path.resolve('.', 'downloads');
  if (fs.existsSync(downloadsDir)) {
    const pastas = fs.readdirSync(downloadsDir, { withFileTypes: true });
    for (const pasta of pastas) {
      if (pasta.isDirectory()) {
        const pastaPath = path.join(downloadsDir, pasta.name);
        const txts = fs.readdirSync(pastaPath)
          .filter(f => f.startsWith('roteiro_') && f.endsWith('.txt'));
        for (const txt of txts) {
          const full = path.join(pastaPath, txt);
          if (!resultados.includes(full)) resultados.push(full);
        }
      }
    }
  }

  // Remove duplicatas (mesmo arquivo raiz e downloads)
  const unicos = [...new Map(resultados.map(r => [path.basename(r), r])).values()];
  return unicos;
}

/**
 * Sorteia um tom aleatório
 */
function tomAleatorio() {
  const chaves = Object.keys(TONS);
  return chaves[Math.floor(Math.random() * chaves.length)];
}

/**
 * Valida a chave API
 */
function validarChaveAPI() {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave || chave === 'sua_chave_aqui' || chave.length < 10) {
    console.log('  ❌ Chave API do Gemini não encontrada!');
    console.log('  💡 Configure no arquivo .env: GEMINI_API_KEY="sua_chave"');
    process.exit(1);
  }
  const mascarada = chave.substring(0, 6) + '...' + chave.substring(chave.length - 4);
  console.log(`  🔑 Chave API: ${mascarada}`);
  return chave;
}

/**
 * Conta palavras e estima duração TTS
 */
function estimarDuracao(texto) {
  const palavras = texto.split(/\s+/).filter(w => w.length > 0).length;
  const minutos = (palavras / CONFIG.palavrasPorMinuto).toFixed(1);
  return { palavras, minutos };
}


// ═══════════════════════════════════════════════════════════════
//  MOTOR DE ROTEIRIZAÇÃO
// ═══════════════════════════════════════════════════════════════

async function roteirizar(ai, recapBruto, nomeObra, tom) {
  const prompt = gerarPromptRoteirizador(tom, nomeObra, CONFIG.duracaoAlvoMinutos);
  const conteudoCompleto = `${prompt}\n\n${recapBruto}`;

  console.log('');
  console.log(`  🧠 Enviando para ${CONFIG.modelo}...`);
  console.log(`  🎭 Tom: ${tom.nome}`);
  console.log(`  📏 Alvo: ~${CONFIG.duracaoAlvoMinutos} minutos (~${CONFIG.duracaoAlvoMinutos * CONFIG.palavrasPorMinuto} palavras)`);
  console.log('  ⏳ Processando (pode levar 30-90 segundos)...');

  try {
    const response = await ai.models.generateContent({
      model: CONFIG.modelo,
      contents: conteudoCompleto,
      config: {
        temperature: 0.75,       // Mais criativo que o analisador
        maxOutputTokens: 65536,
        topP: 0.9,
        topK: 50,
      },
    });

    if (!response.text) {
      console.log('  ⚠️  Resposta vazia. Possível bloqueio de filtro de segurança.');
      return null;
    }

    return response.text;
  } catch (err) {
    console.error(`  ❌ Erro na API: ${err.message}`);

    if (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('429')) {
      console.log('  ⏳ Rate limit. Aguardando 30s para retry...');
      await esperar(30000);
      try {
        const response = await ai.models.generateContent({
          model: CONFIG.modelo,
          contents: conteudoCompleto,
          config: { temperature: 0.75, maxOutputTokens: 65536 },
        });
        return response.text || null;
      } catch (retryErr) {
        console.error(`  ❌ Retry falhou: ${retryErr.message}`);
        return null;
      }
    }
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════
//  EXECUÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function iniciar() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  🎬 ROTEIRIZADOR — Copywriting para YouTube ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // ── Validar chave ──────────────────────────────────────
  const chaveAPI = validarChaveAPI();
  const ai = new GoogleGenAI({ apiKey: chaveAPI });

  // ── Selecionar recap ───────────────────────────────────
  let arquivoRecap = process.argv[2];

  if (!arquivoRecap) {
    const roteiros = listarRoteiros();

    if (roteiros.length === 0) {
      console.log('  ❌ Nenhum roteiro encontrado!');
      console.log('  💡 Execute primeiro: node analisar.js');
      process.exit(1);
    }

    console.log('  📄 Recaps disponíveis:');
    console.log('');
    roteiros.forEach((r, i) => {
      const stat = fs.statSync(r);
      const tamanho = formatarBytes(stat.size);
      const nome = path.basename(r);
      console.log(`     ${i + 1}. ${nome}  (${tamanho})`);
    });
    console.log('');

    const escolha = await perguntar('  🔢 Escolha o número do recap: ');
    const idx = parseInt(escolha, 10);
    if (idx >= 1 && idx <= roteiros.length) {
      arquivoRecap = roteiros[idx - 1];
    } else {
      console.log('  ❌ Opção inválida');
      process.exit(1);
    }
  } else {
    arquivoRecap = path.resolve(arquivoRecap);
  }

  if (!fs.existsSync(arquivoRecap)) {
    console.log(`  ❌ Arquivo não encontrado: ${arquivoRecap}`);
    process.exit(1);
  }

  // ── Ler recap bruto ────────────────────────────────────
  const recapBruto = fs.readFileSync(arquivoRecap, 'utf-8');
  const statsRecap = estimarDuracao(recapBruto);
  console.log(`  📖 Recap carregado: ${path.basename(arquivoRecap)}`);
  console.log(`     • ${statsRecap.palavras} palavras (leitura ~${statsRecap.minutos} min)`);

  // ── Perguntar nome real da obra ────────────────────────
  console.log('');
  const nomeObra = await perguntar('  📛 Qual é o nome REAL da obra? (para corrigir alucinações): ');

  if (!nomeObra) {
    console.log('  ❌ Nome da obra é obrigatório para garantir precisão');
    process.exit(1);
  }

  // ── Escolher tom ───────────────────────────────────────
  console.log('');
  console.log('  🎭 Tons de narração disponíveis:');
  console.log('');
  const chaves = Object.keys(TONS);
  chaves.forEach((chave, i) => {
    console.log(`     ${i + 1}. ${TONS[chave].nome} — ${TONS[chave].descricao}`);
  });
  console.log(`     0. 🎲 Aleatório (surpresa!)`);
  console.log('');

  const escolhaTom = await perguntar('  🔢 Escolha o tom (0 para aleatório): ');
  let tomEscolhido;

  const idxTom = parseInt(escolhaTom, 10);
  if (idxTom === 0 || escolhaTom === '' || isNaN(idxTom)) {
    const chaveAleatoria = tomAleatorio();
    tomEscolhido = TONS[chaveAleatoria];
    console.log(`  🎲 Tom sorteado: ${tomEscolhido.nome}`);
  } else if (idxTom >= 1 && idxTom <= chaves.length) {
    tomEscolhido = TONS[chaves[idxTom - 1]];
  } else {
    console.log('  ⚠️  Opção inválida, usando aleatório...');
    tomEscolhido = TONS[tomAleatorio()];
    console.log(`  🎲 Tom sorteado: ${tomEscolhido.nome}`);
  }

  // ── Processar ──────────────────────────────────────────
  console.log('');
  console.log('  ═══════════════════════════════════════════');
  console.log('  🎬 ROTEIRIZANDO...');
  console.log('  ═══════════════════════════════════════════');

  const inicio = Date.now();
  const resultado = await roteirizar(ai, recapBruto, nomeObra, tomEscolhido);
  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);

  if (!resultado) {
    console.log('  ❌ Falha ao gerar roteiro. Tente novamente.');
    process.exit(1);
  }

  // ── Montar documento final ─────────────────────────────
  const statsRoteiro = estimarDuracao(resultado);

  // Header informativo (não será narrado, é referência)
  let documentoFinal = '';
  documentoFinal += `[METADADOS — NÃO NARRAR]\n`;
  documentoFinal += `Obra: ${nomeObra}\n`;
  documentoFinal += `Tom: ${tomEscolhido.nome}\n`;
  documentoFinal += `Palavras: ~${statsRoteiro.palavras}\n`;
  documentoFinal += `Duração estimada (TTS): ~${statsRoteiro.minutos} minutos\n`;
  documentoFinal += `Modelo: ${CONFIG.modelo}\n`;
  documentoFinal += `Data: ${new Date().toLocaleString('pt-BR')}\n`;
  documentoFinal += `Recap base: ${path.basename(arquivoRecap)}\n`;
  documentoFinal += `${'─'.repeat(50)}\n\n`;
  documentoFinal += resultado;

  // ── Salvar ─────────────────────────────────────────────
  // Nome: roteiro_<nome-da-obra>_postavel_<timestamp>.txt
  const nomeLimpo = nomeObra
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 40);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const nomeArquivo = `roteiro_${nomeLimpo}_postavel_${timestamp}.txt`;

  // Salva na mesma pasta do recap original
  const pastaRecap = path.dirname(arquivoRecap);
  const caminhoSaida = path.join(pastaRecap, nomeArquivo);
  fs.writeFileSync(caminhoSaida, documentoFinal, 'utf-8');

  // Cópia na raiz do projeto
  const copiaRaiz = path.resolve('.', nomeArquivo);
  fs.writeFileSync(copiaRaiz, documentoFinal, 'utf-8');

  // ── Relatório ──────────────────────────────────────────
  console.log('');
  console.log('  ═══════════════════════════════════════════');
  console.log('  ✅ ROTEIRO POSTÁVEL GERADO!');
  console.log('  ═══════════════════════════════════════════');
  console.log('');
  console.log('  📊 Resultado:');
  console.log(`     • Obra: ${nomeObra}`);
  console.log(`     • Tom: ${tomEscolhido.nome}`);
  console.log(`     • Palavras: ~${statsRoteiro.palavras}`);
  console.log(`     • Duração TTS: ~${statsRoteiro.minutos} min`);
  console.log(`     • Tempo de geração: ${duracao}s`);
  console.log('');
  console.log('  📂 Salvo em:');
  console.log(`     • ${caminhoSaida}`);
  console.log(`     • ${copiaRaiz}`);
  console.log('');
  console.log('  💡 Próximo passo: cole o texto num TTS (ElevenLabs, etc.)');
  console.log('     O header [METADADOS] é só referência — o TTS pode ignorar.');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════
//  PONTO DE ENTRADA
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
  iniciar().catch(err => {
    console.error(`  💀 Erro fatal: ${err.message}`);
    if (err.stack && !err.stack.includes(process.env.GEMINI_API_KEY || '')) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}

module.exports = { iniciarRoteirizador: iniciar, TONS };
