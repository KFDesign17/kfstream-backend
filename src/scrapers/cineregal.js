const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const BASE = 'https://cineregal.art';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

function extractVideoUrl(html) {
  // RSC Next.js: les guillemets sont échappés \"videoUrl\":\"https:...\"
  let m = html.match(/\\"videoUrl\\":\\"(https:[^\\"]+)\\"/);
  if (m) return m[1].replace(/\\\//g, '/').replace(/\\u002F/g, '/');
  // Fallback: JSON non-échappé
  m = html.match(/"videoUrl":"(https:[^"]+)"/);
  if (m) return m[1].replace(/\\\//g, '/').replace(/\\u002F/g, '/');
  return null;
}

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' },
    timeout: 12000,
  });
  return data;
}

async function getCineregalFilmUrl(tmdbId) {
  try {
    const titles = await getTitles(tmdbId, 'movie');
    const slugs = [...new Set(titles.map(t => `${slugify(t)}-${tmdbId}`))];

    for (const slug of slugs) {
      try {
        const html = await fetchPage(`${BASE}/fiche/${slug}`);
        const videoUrl = extractVideoUrl(html);
        if (videoUrl) {
          return { url: videoUrl, version: 'VF', name: 'CineRegal', type: 'mp4' };
        }
      } catch {
        // essayer le slug suivant
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function getCineregalSeriesUrl(tmdbId, season, episode) {
  try {
    const titles = await getTitles(tmdbId, 'tv');
    const slugs = [...new Set(titles.map(t => `${slugify(t)}-${tmdbId}`))];

    const S = String(season).padStart(2, '0');
    const E = String(episode).padStart(2, '0');

    for (const slug of slugs) {
      try {
        const url = `${BASE}/lecture/serie/${slug}/${slug}-s${S}e${E}`;
        const html = await fetchPage(url);
        const videoUrl = extractVideoUrl(html);
        if (videoUrl) {
          return { url: videoUrl, version: 'VF', name: 'CineRegal', type: 'mp4' };
        }
      } catch {
        // essayer le slug suivant
      }
    }
  } catch {
    // ignore
  }
  return null;
}

module.exports = { getCineregalFilmUrl, getCineregalSeriesUrl };
