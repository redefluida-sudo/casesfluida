// Lê o banco "Fluidas 2026" no Notion e devolve os cases em JSON para a página.
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   NOTION_TOKEN        → token da integração do Notion (pode ser o mesmo do Hall das Fluidas)
//   CASES_DATABASE_ID   → opcional; por padrão usa o banco Fluidas 2026

const NOTION_VERSION = '2022-06-28';
const TOKEN =
  process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || process.env.NOTION_SECRET;
const DATABASE_ID =
  process.env.CASES_DATABASE_ID || '2fd2d1b5c1be80f2bc6cc2b1fa6b2140';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notion(path, options = {}, tries = 4) {
  const res = await fetch('https://api.notion.com/v1' + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 429 && tries > 0) {
    const wait = (Number(res.headers.get('retry-after')) || 1) * 1000;
    await sleep(wait);
    return notion(path, options, tries - 1);
  }
  if (!res.ok) {
    throw new Error(`Notion respondeu ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const plain = (rich = []) => rich.map((t) => t.plain_text).join('').trim();

function fileUrl(f) {
  if (!f) return null;
  if (f.type === 'external') return f.external.url;
  if (f.type === 'file') return f.file.url;
  return null;
}

// Ordem de busca da foto:
// 1) ícone da página (foto de perfil do Instagram, igual ao Hall das Fluidas)
// 2) capa da página
// 3) primeira imagem dentro do conteúdo da página
async function findPhoto(page) {
  const icon = page.icon;
  if (icon) {
    if (icon.type === 'file' || icon.type === 'external') return fileUrl(icon);
    if (icon.type === 'custom_emoji' && icon.custom_emoji && icon.custom_emoji.url) return icon.custom_emoji.url;
  }
  if (page.cover) return fileUrl(page.cover);
  try {
    const children = await notion(`/blocks/${page.id}/children?page_size=30`);
    const img = children.results.find((b) => b.type === 'image');
    if (img) return fileUrl(img.image);
  } catch (e) {
    // sem foto: a página mostra a inicial do nome
  }
  return null;
}

function readProps(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    nome: plain(p['Nome']?.title),
    conquista: plain(p['O que ela conquistou']?.rich_text),
    nichos: (p['Nicho']?.multi_select || []).map((o) => o.name),
    instagram: p['Instagram']?.url || null,
    estudo: p['Estudo de caso']?.url || null,
  };
}

async function fetchAllPages() {
  const pages = [];
  let cursor;
  do {
    const body = {
      page_size: 100,
      sorts: [{ property: 'Nome', direction: 'ascending' }],
    };
    if (cursor) body.start_cursor = cursor;
    const data = await notion(`/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

module.exports = async (req, res) => {
  if (!TOKEN) {
    res.status(500).json({ error: 'NOTION_TOKEN não configurado na Vercel.' });
    return;
  }
  try {
    const pages = await fetchAllPages();
    const cases = [];
    // Busca as fotos em lotes pequenos para respeitar o limite da API do Notion
    for (let i = 0; i < pages.length; i += 3) {
      const lote = pages.slice(i, i + 3);
      const itens = await Promise.all(lote.map(async (page) => {
        const item = readProps(page);
        if (!item.nome) return null;
        item.foto = await findPhoto(page);
        return item;
      }));
      cases.push(...itens.filter(Boolean));
    }
    // Cache curto: mudanças no Notion aparecem em até ~1 minuto.
    // (Os links de imagem do Notion expiram em 1h, então o cache nunca passa disso.)
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ cases, atualizadoEm: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
};
