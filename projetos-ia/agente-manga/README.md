# 🐉 Agente Manga — Capturador Visual (FEITO COM IA!!)

Captura automaticamente todas as páginas de um capítulo de manga ao fornecer apenas o link.

## 🚀 Como usar

```bash
# Método 1: Passar o link direto
node agente.js https://www.webtoons.com/en/action/im-the-max-level-newbie/ep-0/viewer?title_no=3915&episode_no=1

# Método 2: Modo interativo (ele pergunta o link)
node agente.js

# Método 3: Via npm
npm start
```

## 📦 Setup (primeira vez)

```bash
npm install
npm run setup
```

## 🌐 Sites suportados

| Site | Suporte |
|------|---------|
| Webtoons | ✅ Completo |
| MangaDex | ✅ Completo |
| MangaLivre | ✅ Completo |
| MangaNato / ChapMangaNato | ✅ Completo |
| MangaKakalot | ✅ Completo |
| Asura Scans | ✅ Completo |
| Flame Scans | ✅ Completo |
| TCB Scans | ✅ Completo |
| **Qualquer outro site** | 🔄 Modo genérico |

## 📂 Onde ficam as imagens?

As imagens são salvas em `./downloads/<nome-do-manga>/` com nomes sequenciais:
```
downloads/
  └── im-the-max-level-newbie_ep-0/
      ├── pagina_001.png
      ├── pagina_002.png
      ├── pagina_003.png
      └── ...
```

## ✨ Features do Capturador

- 🔍 **Detecção automática do site** — identifica o site e usa seletores otimizados
- 🖱️ **Scroll inteligente** — simula rolagem humana para ativar lazy-loading
- 🛡️ **Anti-detecção** — user-agent realista e flags anti-bot
- 🍪 **Aceita cookies** — lida com popups de consentimento automaticamente
- 📊 **Barra de progresso** — mostra o andamento em tempo real
- 🔄 **Fallback duplo** — tenta screenshot + download direto das URLs
- 🎯 **Filtro inteligente** — ignora ícones, logos, ads — captura só as páginas
- ❌ **Tratamento de erros** — mensagens claras e screenshot de debug em caso de falha

---

## 🧩 Juntador de Manga — Merge Vertical

Após capturar as imagens, use o juntador para combiná-las verticalmente em blocos otimizados para alimentar IAs de visão (GPT-4o, Claude, Gemini, etc.).

### Como usar

```bash
# Modo interativo — lista as pastas e você escolhe
node juntar.js

# Passar a pasta direto
node juntar.js nome-da-pasta

# Via npm
npm run juntar
```

### O que ele faz

1. **Lê** as imagens em ordem crescente (`pagina_001.png`, `pagina_002.png`, ...)
2. **Analisa** dimensões de cada imagem
3. **Agrupa** em blocos inteligentes (máx. 12.000px de altura / 15 páginas por bloco)
4. **Junta** verticalmente com largura uniforme (sem distorção)
5. **Salva** em PNG lossless na pasta `<nome>_corrigido`

### Resultado

```
downloads/
  ├── im-the-max-level-newbie_ep-0/        ← imagens originais
  │   ├── pagina_001.png
  │   ├── pagina_002.png
  │   └── ...
  └── im-the-max-level-newbie_ep-0_corrigido/  ← blocos merged
      ├── bloco_01.png  (paginas 001→008)
      ├── bloco_02.png  (paginas 009→015)
      └── bloco_03.png  (paginas 016→020)
```

### Pipeline completo

```bash
# 1. Captura
node agente.js https://www.webtoons.com/en/action/...

# 2. Merge
node juntar.js
```

## 🛠️ Requisitos

- Node.js 18+
- Playwright (instalado via `npm run setup`)
- Sharp (instalado automaticamente com `npm install`)

