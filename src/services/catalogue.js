const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CR = 'https://cineregal.art';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Cache en mémoire TTL 12h ───────────────────────────────
const _cache = new Map();
const TTL = 12 * 60 * 60 * 1000;
function cGet(k) {
  const e = _cache.get(k);
  if (!e) return undefined;
  if (Date.now() - e.ts > TTL) { _cache.delete(k); return undefined; }
  return e.v;
}
function cSet(k, v) { _cache.set(k, { v, ts: Date.now() }); }

// ─── Utilitaires ─────────────────────────────────────────────
function slugify(s) {
  return s.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

function tmdbH() {
  return { Authorization: `Bearer ${process.env.TMDB_TOKEN}`, Accept: 'application/json' };
}

const GENRES = {
  // Films
  28:'Action', 12:'Aventure', 16:'Animation', 35:'Comédie', 80:'Crime',
  99:'Documentaire', 18:'Drame', 10751:'Familial', 14:'Fantastique',
  36:'Histoire', 27:'Horreur', 10402:'Musique', 9648:'Mystère',
  10749:'Romance', 878:'Science-Fiction', 10770:'Téléfilm', 53:'Thriller',
  10752:'Guerre', 37:'Western',
  // Séries TV (IDs spécifiques TMDB)
  10759:'Action', 10762:'Animation', 10763:'Documentaire', 10764:'Réalité',
  10765:'Science-Fiction', 10766:'Soap', 10767:'Talk-show', 10768:'Guerre',
};

function fmtFilm(item) {
  return {
    id: item.id, tmdbId: item.id, slug: String(item.id),
    title: item.title || item.original_title,
    originalTitle: item.original_title || item.title,
    thumbnail: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : '',
    backdrop: item.backdrop_path ? `${TMDB_IMG}${item.backdrop_path}` : '',
    synopsis: item.overview || '',
    year: item.release_date ? new Date(item.release_date).getFullYear() : null,
    rating: item.vote_average ? parseFloat(item.vote_average) : null,
    duration: null, type: 'film', seasons: null, episodes: null, quality: null,
    genres: (item.genre_ids || []).map(id => GENRES[id]).filter(Boolean),
  };
}

function fmtShow(item) {
  return {
    id: item.id, tmdbId: item.id, slug: String(item.id),
    title: item.name || item.original_name,
    originalTitle: item.original_name || item.name,
    thumbnail: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : '',
    backdrop: item.backdrop_path ? `${TMDB_IMG}${item.backdrop_path}` : '',
    synopsis: item.overview || '',
    year: item.first_air_date ? new Date(item.first_air_date).getFullYear() : null,
    rating: item.vote_average ? parseFloat(item.vote_average) : null,
    duration: null, type: 'serie', seasons: null, episodes: null, quality: null,
    genres: (item.genre_ids || []).map(id => GENRES[id]).filter(Boolean),
  };
}

// ─── Vérification disponibilité cineregal ────────────────────
async function checkFilm(tmdbId, frTitle, origTitle) {
  const k = `f:${tmdbId}`;
  const cached = cGet(k);
  if (cached !== undefined) return cached;

  const slugs = [...new Set([frTitle, origTitle].filter(Boolean).map(slugify))];
  for (const slug of slugs) {
    try {
      const { data: html } = await axios.get(`${CR}/fiche/${slug}-${tmdbId}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR' },
        timeout: 6000,
      });
      if (!html.includes('introuvable')) {
        cSet(k, true);
        return true;
      }
    } catch {}
  }
  cSet(k, false);
  return false;
}

async function checkSeries(tmdbId, frName, origName) {
  const k = `s:${tmdbId}`;
  const cached = cGet(k);
  if (cached !== undefined) return cached;

  // Series: essaie original (souvent anglais) en premier
  const slugs = [...new Set([origName, frName].filter(Boolean).map(slugify))];
  for (const slug of slugs) {
    try {
      const { data: html } = await axios.get(`${CR}/serie/${slug}-${tmdbId}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR' },
        timeout: 6000,
      });
      if (!html.includes('introuvable')) {
        cSet(k, true);
        return true;
      }
    } catch {}
  }
  cSet(k, false);
  return false;
}

// ─── Catalogue ───────────────────────────────────────────────
// Langues dont le contenu est généralement doublé en français
const VF_LANGS = new Set(['en', 'fr', 'es', 'ko', 'ja', 'de', 'it', 'pt']);

async function getFilms(page = 1) {
  const { data } = await axios.get(`${TMDB_BASE}/movie/popular`, {
    params: { language: 'fr-FR', page },
    headers: tmdbH(), timeout: 10000,
  });
  return {
    items: (data.results || []).filter(r => VF_LANGS.has(r.original_language)).map(fmtFilm),
    page: data.page,
    totalPages: Math.min(data.total_pages || 1, 50),
    hasNextPage: data.page < (data.total_pages || 1),
  };
}

async function getSeries(page = 1) {
  const { data } = await axios.get(`${TMDB_BASE}/tv/popular`, {
    params: { language: 'fr-FR', page },
    headers: tmdbH(), timeout: 10000,
  });
  return {
    items: (data.results || [])
      .filter(r => VF_LANGS.has(r.original_language))
      .filter(r => !(r.original_language === 'ja' && (r.genre_ids || []).includes(16)))
      .map(fmtShow),
    page: data.page,
    totalPages: Math.min(data.total_pages || 1, 50),
    hasNextPage: data.page < (data.total_pages || 1),
  };
}

// ─── Recherche via cineregal ─────────────────────────────────
async function search(query, type = 'all') {
  const { data: html } = await axios.get(
    `${CR}/recherche?q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR' }, timeout: 10000 }
  );

  // Extrait tmdbIds des liens (dernier segment numérique)
  const filmIds = [...new Set(
    [...(html.matchAll(/href="\/fiche\/[^"]*-(\d+)"/g) || [])]
      .map(m => parseInt(m[1])).filter(Boolean)
  )];
  const serieIds = [...new Set(
    [...(html.matchAll(/href="\/serie\/[^"]*-(\d+)"/g) || [])]
      .map(m => parseInt(m[1])).filter(Boolean)
  )];

  const toFetch = [];
  if (type !== 'serie') filmIds.slice(0, 15).forEach(id => toFetch.push({ id, t: 'film' }));
  if (type !== 'film') serieIds.slice(0, 15).forEach(id => toFetch.push({ id, t: 'serie' }));

  const results = await Promise.allSettled(
    toFetch.map(async ({ id, t }) => {
      const ep = t === 'film' ? 'movie' : 'tv';
      const { data: d } = await axios.get(`${TMDB_BASE}/${ep}/${id}`, {
        params: { language: 'fr-FR' },
        headers: tmdbH(), timeout: 8000,
      });
      const gids = (d.genres || []).map(g => g.id);
      return t === 'film'
        ? fmtFilm({ ...d, genre_ids: gids })
        : fmtShow({ ...d, genre_ids: gids });
    })
  );

  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

module.exports = { getFilms, getSeries, search };
