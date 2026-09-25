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

// A foto é o ÍCONE da página (igual ao Hall das Fluidas).
// Coloque a foto de perfil do Instagram dela como ícone da página no Notion.
function findPhoto(page) {
  if (page.icon && page.icon.type !== 'emoji') return fileUrl(page.icon);
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
    for (const page of pages) {
      const item = readProps(page);
      if (!item.nome) continue;
      item.foto = findPhoto(page);
      cases.push(item);
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
