const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const MOVIX_BASE = 'https://movix.bet';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

async function getTitles(tmdbId, type) {
  const endpoint = type === 'movie' ? 'movie' : 'tv';
  const [frRes, enRes] = await Promise.allSettled([
    axios.get(`${TMDB_BASE}/${endpoint}/${tmdbId}?language=fr-FR`, {
      headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` },
      timeout: 8000,
    }),
    axios.get(`${TMDB_BASE}/${endpoint}/${tmdbId}?language=en-US`, {
      headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` },
      timeout: 8000,
    }),
  ]);
  const fr = frRes.status === 'fulfilled' ? (type === 'movie' ? frRes.value.data.title : frRes.value.data.name) : null;
  const en = enRes.status === 'fulfilled' ? (type === 'movie' ? enRes.value.data.title : enRes.value.data.name) : null;
  const orig = enRes.status === 'fulfilled'
    ? (type === 'movie' ? enRes.value.data.original_title : enRes.value.data.original_name)
    : null;
  return [...new Set([fr, en, orig].filter(Boolean))];
}

async function isEmbedValid(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': UA, Referer: `${MOVIX_BASE}/` },
      timeout: 5000,
      maxRedirects: 3,
    });
    if (typeof data !== 'string') return true;
    const lower = data.toLowerCase();
    return !lower.includes('not found') &&
           !lower.includes('video deleted') &&
           !lower.includes('video removed') &&
           !lower.includes('file was deleted') &&
           !lower.includes('has been deleted');
  } catch {
    return false;
  }
}

async function extractCandidates(html) {
  const match = html.match(/wire:snapshot="([^"]+)"/);
  if (!match) return [];

  const decoded = decodeHtmlEntities(match[1]);
  const snapshot = JSON.parse(decoded);
  const videos = snapshot?.data?.videos;
  if (!videos || !videos[0]) return [];

  const preferred = ['VF', 'FRENCH', 'TRUEFRENCH', 'VOSTFR', 'VOST'];
  const byVersion = {};

  for (const group of videos[0]) {
    for (const item of group) {
      if (item && item.link) {
        const v = item.version || 'unknown';
        if (!byVersion[v]) byVersion[v] = [];
        byVersion[v].push({
          url: item.link,
          version: v,
          name: item.server_name || extractDomain(item.link) || null,
        });
      }
    }
  }

  const ordered = [];
  for (const v of preferred) {
    if (byVersion[v]) ordered.push(...byVersion[v]);
  }
  for (const [v, items] of Object.entries(byVersion)) {
    if (!preferred.includes(v)) ordered.push(...items);
  }

  return ordered.map((c, i) => ({
    url: c.url,
    version: c.version,
    name: c.name || `Serveur ${i + 1}`,
  }));
}

async function getAllVFServers(tmdbId) {
  try {
    const titles = await getTitles(tmdbId, 'movie');
    const slugs = [...new Set(titles.map(slugify))];

    let candidates = [];
    for (const slug of slugs) {
      try {
        const { data: html } = await axios.get(`${MOVIX_BASE}/movie/${slug}`, {
          headers: { 'User-Agent': UA },
          timeout: 12000,
        });
        candidates = await extractCandidates(html);
        if (candidates.length > 0) break;
      } catch {
        // essayer le slug suivant
      }
    }

    if (candidates.length === 0) return [];

    const validations = await Promise.allSettled(candidates.map(c => isEmbedValid(c.url)));
    return candidates.filter((_, i) => validations[i].status === 'fulfilled' && validations[i].value === true);
  } catch {
    return [];
  }
}

async function getAllSeriesVFServers(tmdbId, season, episode) {
  try {
    const titles = await getTitles(tmdbId, 'tv');
    const slugs = [...new Set(titles.map(slugify))];

    let candidates = [];
    for (const slug of slugs) {
      try {
        const { data: html } = await axios.get(
          `${MOVIX_BASE}/episode/${slug}/${season}-${episode}`,
          { headers: { 'User-Agent': UA }, timeout: 12000 }
        );
        candidates = await extractCandidates(html);
        if (candidates.length > 0) break;
      } catch {
        // essayer le slug suivant
      }
    }

    if (candidates.length === 0) return [];

    const validations = await Promise.allSettled(candidates.map(c => isEmbedValid(c.url)));
    return candidates.filter((_, i) => validations[i].status === 'fulfilled' && validations[i].value === true);
  } catch {
    return [];
  }
}

async function getVFEmbedUrl(tmdbId) {
  const servers = await getAllVFServers(tmdbId);
  return servers.length > 0 ? servers[0] : null;
}

async function getSeriesVFEmbedUrl(tmdbId, season, episode) {
  const servers = await getAllSeriesVFServers(tmdbId, season, episode);
  return servers.length > 0 ? servers[0] : null;
}

module.exports = { getVFEmbedUrl, getSeriesVFEmbedUrl, getAllVFServers, getAllSeriesVFServers };
