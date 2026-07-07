const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ╔══════════════════════════════════════════════════════════════╗
// ║              🐉 AGENTE MANGA — Capturador Visual            ║
// ║   Fornece um link de qualquer site de manga e ele captura   ║
// ║   todas as páginas em imagem de alta qualidade.             ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Configurações de sites suportados ──────────────────────────
// Cada site tem seletores específicos para encontrar as imagens do manga
const SITE_CONFIGS = {
  // ── Webtoons ────────────────────────────────────────────
  'webtoons.com': {
    nome: 'Webtoons',
    seletorImagens: '#_imageList img, .viewer_img img, img._images',
    seletorConteudo: '#_imageList, .viewer_lst, #content',
    aceitarCookies: async (page) => {
      try {
        const btn = page.locator('button:has-text("Accept"), button:has-text("Aceitar"), .gdpr_ly_btn');
        if (await btn.first().isVisible({ timeout: 3000 })) {
          await btn.first().click();
          console.log('  ✅ Cookies aceitos automaticamente');
        }
      } catch { /* sem popup de cookies */ }
    },
    alturaMinima: 200,
    esperarAntes: 2000,
  },

  // ── MangaDex ────────────────────────────────────────────
  'mangadex.org': {
    nome: 'MangaDex',
    seletorImagens: '.md--page img, img[class*="page"], .reader--image img',
    seletorConteudo: '.reader-main, .md--reader',
    aceitarCookies: async () => {},
    alturaMinima: 300,
    esperarAntes: 3000,
  },

  // ── MangaLivre / MangaToo ───────────────────────────────
  'mangalivre.net': {
    nome: 'MangaLivre',
    seletorImagens: '.reader-area img, .page-container img, #reader img',
    seletorConteudo: '.reader-area, .page-container, #reader',
    aceitarCookies: async (page) => {
      try {
        const btn = page.locator('button:has-text("Aceitar"), .cookie-accept');
        if (await btn.first().isVisible({ timeout: 2000 })) await btn.first().click();
      } catch { }
    },
    alturaMinima: 200,
    esperarAntes: 2000,
  },

  // ── MangaReader / MangaNato ─────────────────────────────
  'manganato.com': {
    nome: 'MangaNato',
    seletorImagens: '.container-chapter-reader img',
    seletorConteudo: '.container-chapter-reader',
    aceitarCookies: async () => {},
    alturaMinima: 200,
    esperarAntes: 1500,
  },

  'chapmanganato.to': {
    nome: 'ChapMangaNato',
    seletorImagens: '.container-chapter-reader img',
    seletorConteudo: '.container-chapter-reader',
    aceitarCookies: async () => {},
    alturaMinima: 200,
    esperarAntes: 1500,
  },

  // ── ReadManga / MangaKakalot ────────────────────────────
  'mangakakalot.com': {
    nome: 'MangaKakalot',
    seletorImagens: '#vungdoc img, .container-chapter-reader img',
    seletorConteudo: '#vungdoc, .container-chapter-reader',
    aceitarCookies: async () => {},
    alturaMinima: 200,
    esperarAntes: 1500,
  },

  // ── Asura Scans ─────────────────────────────────────────
  'asuracomic.net': {
    nome: 'Asura Scans',
    seletorImagens: '.rdminimal img, .reading-content img, img[class*="ts-main-image"]',
    seletorConteudo: '.rdminimal, .reading-content',
    aceitarCookies: async (page) => {
      try {
        const btn = page.locator('button:has-text("Accept"), .cookie-consent-accept');
        if (await btn.first().isVisible({ timeout: 2000 })) await btn.first().click();
      } catch { }
    },
    alturaMinima: 200,
    esperarAntes: 2000,
  },

  // ── Flame Scans / Luminous Scans ────────────────────────
  'flamescans.org': {
    nome: 'Flame Scans',
    seletorImagens: '#readerarea img, .reading-content img',
    seletorConteudo: '#readerarea, .reading-content',
    aceitarCookies: async () => {},
    alturaMinima: 200,
    esperarAntes: 2000,
  },

  // ── TCBScans ────────────────────────────────────────────
  'tcbscans.me': {
    nome: 'TCB Scans',
    seletorImagens: '.reading-content img, picture img',
    seletorConteudo: '.reading-content',
    aceitarCookies: async () => {},
    alturaMinima: 200,
    esperarAntes: 2000,
  },
};

// ── Configuração genérica (fallback para qualquer site) ───────
const CONFIG_GENERICA = {
  nome: 'Genérico',
  seletorImagens: 'img',
  seletorConteudo: 'body',
  aceitarCookies: async (page) => {
    try {
      const btn = page.locator('button:has-text("Accept"), button:has-text("Aceitar"), button:has-text("OK"), button:has-text("Agree")');
      if (await btn.first().isVisible({ timeout: 2000 })) await btn.first().click();
    } catch { }
  },
  alturaMinima: 300,   // mais restritivo para evitar ícones
  esperarAntes: 2000,
};


// ═══════════════════════════════════════════════════════════════
//  UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════

/**
 * Identifica qual configuração de site usar baseado na URL
 */
function detectarSite(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    for (const [dominio, config] of Object.entries(SITE_CONFIGS)) {
      if (hostname.includes(dominio)) {
        return config;
      }
    }
  } catch (e) {
    console.error('[ERRO] URL inválida:', url);
  }
  return CONFIG_GENERICA;
}

/**
 * Extrai um nome legível da URL para nomear a pasta
 */
function extrairNomePasta(url) {
  try {
    const urlObj = new URL(url);
    const partes = urlObj.pathname
      .split('/')
      .filter(p => p && p.length > 1)
      .map(p => p.replace(/[^a-zA-Z0-9_\-]/g, '_'));

    if (partes.length >= 2) {
      // Pega os últimos 2 segmentos relevantes (manga + capítulo)
      return partes.slice(-2).join('_');
    }
    if (partes.length === 1) {
      return partes[0];
    }
  } catch { }
  return `manga_${Date.now()}`;
}

/**
 * Cria a pasta de destino se não existir
 */
function criarPasta(caminho) {
  if (!fs.existsSync(caminho)) {
    fs.mkdirSync(caminho, { recursive: true });
    console.log(`  📁 Pasta criada: ${caminho}`);
  }
  return caminho;
}

/**
 * Pergunta ao usuário via terminal
 */
function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(texto, (resposta) => {
      rl.close();
      resolve(resposta.trim());
    });
  });
}

/**
 * Barra de progresso simples no console
 */
function mostrarProgresso(atual, total, texto = '') {
  const largura = 30;
  const pct = Math.round((atual / total) * 100);
  const preenchido = Math.round((atual / total) * largura);
  const barra = '█'.repeat(preenchido) + '░'.repeat(largura - preenchido);
  process.stdout.write(`\r  [${barra}] ${pct}% (${atual}/${total}) ${texto}  `);
  if (atual === total) process.stdout.write('\n');
}

/**
 * Aguarda um tempo com mensagem
 */
function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ═══════════════════════════════════════════════════════════════
//  MOTOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function rolarPaginaCompleta(page) {
  console.log('  🖱️  Rolando a página para carregar imagens...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight + 500) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });

  // Volta ao topo e rola novamente (garante lazy-load)
  await page.evaluate(() => window.scrollTo(0, 0));
  await esperar(500);
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight + 500) {
          clearInterval(timer);
          resolve();
        }
      }, 80);
    });
  });
}

async function capturarImagens(page, config, pastaDestino) {
  console.log(`  🔍 Buscando imagens com seletor: ${config.seletorImagens}`);

  // Tenta seletor específico do site primeiro
  let imagens = await page.$$(config.seletorImagens);

  // Fallback: se encontrou poucas imagens, tenta genérico
  if (imagens.length < 3) {
    console.log('  ⚠️  Poucos resultados com seletor específico, tentando seletor expandido...');
    imagens = await page.$$('img');
  }

  console.log(`  📊 Total de elementos <img> encontrados: ${imagens.length}`);

  // Filtra apenas imagens grandes (páginas do manga)
  const imagensFiltradas = [];
  for (const img of imagens) {
    try {
      const box = await img.boundingBox();
      if (!box) continue;

      // Filtra por tamanho — manga pages são grandes
      if (box.height < config.alturaMinima) continue;
      if (box.width < 150) continue;

      // Verifica se a imagem tem src válido (não é placeholder)
      const src = await img.getAttribute('src');
      const dataSrc = await img.getAttribute('data-src');
      const imgSrc = src || dataSrc || '';

      // Ignora imagens comuns de UI
      const ignorar = ['logo', 'icon', 'avatar', 'banner', 'ad', 'advertisement',
                        'button', 'arrow', 'close', 'search', 'menu', 'social',
                        'facebook', 'twitter', 'instagram', 'discord', 'patreon',
                        'loading', 'spinner', 'blank', 'pixel', 'tracking',
                        'badge', 'flag', 'emoji'];

      const srcLower = imgSrc.toLowerCase();
      const classAttr = (await img.getAttribute('class') || '').toLowerCase();
      const altAttr = (await img.getAttribute('alt') || '').toLowerCase();
      const idAttr = (await img.getAttribute('id') || '').toLowerCase();

      const ehUIElement = ignorar.some(termo =>
        srcLower.includes(termo) || classAttr.includes(termo) ||
        altAttr.includes(termo) || idAttr.includes(termo)
      );

      if (ehUIElement) continue;

      imagensFiltradas.push(img);
    } catch {
      // Elemento pode ter sumido da DOM, ignorar
    }
  }

  console.log(`  ✨ Imagens de manga detectadas: ${imagensFiltradas.length}`);

  if (imagensFiltradas.length === 0) {
    console.log('\n  ❌ Nenhuma imagem de manga encontrada!');
    console.log('  💡 Dicas:');
    console.log('     • Verifique se o link está correto');
    console.log('     • Alguns sites requerem login');
    console.log('     • O site pode usar proteção anti-bot');
    return 0;
  }

  // Captura cada imagem
  let contador = 0;
  for (let i = 0; i < imagensFiltradas.length; i++) {
    const img = imagensFiltradas[i];
    try {
      // Scroll até a imagem para garantir que carregou
      await img.scrollIntoViewIfNeeded();
      await esperar(200);

      const numero = String(contador + 1).padStart(3, '0');
      const caminhoArquivo = path.join(pastaDestino, `pagina_${numero}.png`);

      await img.screenshot({ path: caminhoArquivo });
      mostrarProgresso(i + 1, imagensFiltradas.length, `pagina_${numero}.png`);
      contador++;
    } catch (err) {
      // Imagem pode não estar mais visível, pular
      console.log(`\n  ⚠️  Falha ao capturar imagem ${i + 1}: ${err.message.substring(0, 60)}`);
    }
  }

  return contador;
}

// Método alternativo: baixar imagens diretamente via URL
async function baixarImagensViaURL(page, config, pastaDestino) {
  console.log('  🌐 Tentando método alternativo: download direto das URLs...');

  const urls = await page.evaluate((seletor) => {
    const imgs = document.querySelectorAll(seletor);
    return Array.from(imgs).map(img => ({
      src: img.src || img.dataset.src || img.getAttribute('data-original') || '',
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    })).filter(i => i.src && i.height > 200 && !i.src.startsWith('data:'));
  }, config.seletorImagens);

  if (urls.length === 0) {
    // Tenta com todos os img
    const urlsGenericas = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      return Array.from(imgs).map(img => ({
        src: img.src || img.dataset.src || '',
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      })).filter(i => i.src && i.height > 200 && !i.src.startsWith('data:'));
    });
    urls.push(...urlsGenericas);
  }

  console.log(`  📊 URLs de imagens encontradas: ${urls.length}`);

  let contador = 0;
  for (let i = 0; i < urls.length; i++) {
    try {
      const response = await page.context().request.get(urls[i].src, {
        headers: {
          'Referer': page.url(),
          'Accept': 'image/*',
        },
      });

      if (response.ok()) {
        const numero = String(contador + 1).padStart(3, '0');
        const ext = urls[i].src.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'png';
        const caminhoArquivo = path.join(pastaDestino, `pagina_${numero}.${ext}`);

        const buffer = await response.body();
        fs.writeFileSync(caminhoArquivo, buffer);
        mostrarProgresso(i + 1, urls.length, `pagina_${numero}.${ext}`);
        contador++;
      }
    } catch (err) {
      console.log(`\n  ⚠️  Falha no download da imagem ${i + 1}: ${err.message.substring(0, 60)}`);
    }
  }

  return contador;
}


// ═══════════════════════════════════════════════════════════════
//  EXECUÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function iniciarAgente(urlArg) {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║       🐉 AGENTE MANGA — Capturador Visual   ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // Obtém a URL: via argumento CLI ou pergunta ao usuário
  let url = urlArg || process.argv[2];

  if (!url) {
    url = await perguntar('  🔗 Cole o link do capítulo do manga: ');
  }

  if (!url || !url.startsWith('http')) {
    console.log('  ❌ URL inválida. Use: node agente.js <URL_DO_CAPITULO>');
    console.log('  📖 Exemplo: node agente.js https://webtoons.com/...');
    process.exit(1);
  }

  // Detecta o site e configura
  const config = detectarSite(url);
  console.log(`  🌐 Site detectado: ${config.nome}`);

  // Cria pasta com nome inteligente
  const nomePasta = extrairNomePasta(url);
  const pastaDestino = criarPasta(path.resolve('.', 'downloads', nomePasta));
  console.log(`  📂 Salvando em: ${pastaDestino}`);
  console.log('');

  // Inicia o navegador
  console.log('  🚀 Iniciando navegador...');
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',  // anti-detecção
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'pt-BR',
  });

  // Bloqueia recursos desnecessários para acelerar
  await context.route('**/*.{mp4,webm,ogg,mp3,wav}', route => route.abort());
  await context.route('**/ads/**', route => route.abort());
  await context.route('**/analytics/**', route => route.abort());
  await context.route('**/tracking/**', route => route.abort());

  const page = await context.newPage();

  try {
    // Navega para a URL
    console.log(`  🧭 Navegando para: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Aceita cookies/popups
    await config.aceitarCookies(page);

    // Espera o conteúdo principal
    console.log('  ⏳ Aguardando conteúdo carregar...');
    await esperar(config.esperarAntes);

    // Tenta fechar qualquer popup/overlay genérico
    try {
      await page.evaluate(() => {
        // Remove overlays comuns
        document.querySelectorAll('[class*="overlay"], [class*="popup"], [class*="modal"]')
          .forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'absolute') {
              el.style.display = 'none';
            }
          });
      });
    } catch { }

    // Rola a página inteira para ativar lazy loading
    await rolarPaginaCompleta(page);
    console.log('  ✅ Rolagem concluída');

    // Espera final para imagens carregarem
    await esperar(2000);

    // Captura as imagens
    console.log('');
    console.log('  ═══════════════════════════════════════════');
    console.log('  📸 INICIANDO CAPTURA DAS PÁGINAS');
    console.log('  ═══════════════════════════════════════════');
    console.log('');

    let totalCapturado = await capturarImagens(page, config, pastaDestino);

    // Se captura via screenshot falhou, tenta download direto
    if (totalCapturado < 3) {
      console.log('');
      console.log('  🔄 Poucas imagens via screenshot, tentando download direto...');
      const downloadCount = await baixarImagensViaURL(page, config, pastaDestino);
      totalCapturado = Math.max(totalCapturado, downloadCount);
    }

    // Resultado final
    console.log('');
    console.log('  ═══════════════════════════════════════════');
    if (totalCapturado > 0) {
      console.log(`  ✅ SUCESSO! ${totalCapturado} páginas capturadas`);
      console.log(`  📂 Salvas em: ${pastaDestino}`);
    } else {
      console.log('  ❌ Nenhuma página capturada');
      console.log('  💡 O site pode ter proteção anti-bot ou requer login');
      console.log('  💡 Tente abrir o link manualmente para verificar');
    }
    console.log('  ═══════════════════════════════════════════');

  } catch (err) {
    console.error('');
    console.error(`  ❌ ERRO: ${err.message}`);
    console.error('');
    console.error('  💡 Possíveis soluções:');
    console.error('     • Verifique sua conexão com a internet');
    console.error('     • O site pode estar fora do ar');
    console.error('     • Tente novamente em alguns minutos');

    // Salva screenshot de erro para debug
    try {
      const erroPath = path.join(pastaDestino, '_ERRO_debug.png');
      await page.screenshot({ path: erroPath, fullPage: true });
      console.error(`  📸 Screenshot de debug salvo: ${erroPath}`);
    } catch { }

  } finally {
    console.log('');
    console.log('  🔒 Fechando navegador...');
    await browser.close();
    console.log('  👋 Agente finalizado!');
    console.log('');
  }
}

// ═══════════════════════════════════════════════════════════════
//  PONTO DE ENTRADA
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
  iniciarAgente().catch(err => {
    console.error('  💀 Erro fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { iniciarAgente };