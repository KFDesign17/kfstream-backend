const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://nakastream.tv';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : null);

const LAUNCH_OPTS = {
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--disable-extensions', '--disable-default-apps', '--no-first-run',
    '--single-process', '--no-zygote',
  ],
  ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
};

// Shared browser instance — avoids launching Chromium on every request
let _browser = null;
let _browserReady = null;

async function getBrowser() {
  if (_browser) {
    try { await _browser.pages(); return _browser; } catch { _browser = null; }
  }
  if (_browserReady) return _browserReady;
  _browserReady = puppeteer.launch(LAUNCH_OPTS).then(b => {
    _browser = b;
    _browserReady = null;
    b.on('disconnected', () => { _browser = null; });
    return b;
  });
  return _browserReady;
}

// Fetches a nakastream API path via the shared browser to bypass Cloudflare
async function fetchApi(apiPath) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/films`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const data = await page.evaluate(async (path) => {
      const res = await fetch(path, { credentials: 'include' });
      return res.ok ? res.json() : null;
    }, apiPath);
    return data;
  } finally {
    await page.close();
  }
}

// Mapping TMDB genre IDs → noms (noms exacts retournés par TMDB en français)
const TMDB_GENRES = {
  28:'Action',12:'Aventure',16:'Animation',35:'Comédie',80:'Crime',
  99:'Documentaire',18:'Drame',10751:'Familial',14:'Fantastique',
  36:'Histoire',27:'Horreur',10402:'Musique',9648:'Mystère',
  10749:'Romance',878:'Science-Fiction',10770:'Téléfilm',53:'Thriller',
  10752:'Guerre',37:'Western',
};

function formatItem(item) {
  const isMovie = item.mediaType === 'movie';
  // Genres : tableau d'objets {id,name} ou tableau d'IDs
  const rawGenres = item.genres || item.genreIds || [];
  const genres = rawGenres.map(g =>
    typeof g === 'object' ? g.name : (TMDB_GENRES[g] || null)
  ).filter(Boolean);
  return {
    id: item.id,
    tmdbId: item.tmdbId,
    slug: item.tmdbId,
    title: item.title,
    originalTitle: item.originalTitle || item.title,
    thumbnail: item.posterPath ? `${TMDB_IMG}${item.posterPath}` : '',
    backdrop: item.backdropPath ? `${TMDB_IMG}${item.backdropPath}` : '',
    synopsis: item.overview || '',
    year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : null,
    rating: item.voteAverage ? parseFloat(item.voteAverage) : null,
    duration: item.runtime || null,
    type: isMovie ? 'film' : 'serie',
    seasons: item.numberOfSeasons || null,
    episodes: item.numberOfEpisodes || null,
    quality: item.quality || null,
    genres,
    url: `${BASE_URL}/content/${isMovie ? 'movie' : 'tv'}/${item.tmdbId}`,
  };
}

// ─── TMDB fallback ───────────────────────────────────────────────
const TMDB_BASE = 'https://api.themoviedb.org/3';

function tmdbHeaders() {
  return process.env.TMDB_TOKEN
    ? { Authorization: `Bearer ${process.env.TMDB_TOKEN}` }
    : {};
}

function formatTMDBMovie(item) {
  const genres = (item.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean);
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
    genres, url: `${BASE_URL}/content/movie/${item.id}`,
  };
}

function formatTMDBShow(item) {
  const genres = (item.genre_ids || []).map(id => TMDB_GENRES[id]).filter(Boolean);
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
    genres, url: `${BASE_URL}/content/tv/${item.id}`,
  };
}

async function getTMDBFilms(page = 1) {
  const { data } = await axios.get(`${TMDB_BASE}/movie/popular`, {
    params: { language: 'fr-FR', page },
    headers: tmdbHeaders(),
    timeout: 10000,
  });
  return {
    items: (data.results || []).map(formatTMDBMovie),
    page: data.page,
    totalPages: Math.min(data.total_pages || 1, 50),
  };
}

async function getTMDBSeries(page = 1) {
  const { data } = await axios.get(`${TMDB_BASE}/tv/popular`, {
    params: { language: 'fr-FR', page },
    headers: tmdbHeaders(),
    timeout: 10000,
  });
  return {
    items: (data.results || []).map(formatTMDBShow),
    page: data.page,
    totalPages: Math.min(data.total_pages || 1, 50),
  };
}
// ─────────────────────────────────────────────────────────────────

async function getFilms(page = 1) {
  try {
    const data = await fetchApi(`/api/v1/browse/movies?page=${page}`);
    const items = (data?.data || []).map(formatItem);
    if (items.length > 0) {
      return { items, page: data?.meta?.currentPage || page, totalPages: data?.meta?.lastPage || 1 };
    }
  } catch {}
  return getTMDBFilms(page);
}

async function getSeries(page = 1) {
  try {
    const data = await fetchApi(`/api/v1/browse/shows?page=${page}`);
    const items = (data?.data || []).map(formatItem);
    if (items.length > 0) {
      return { items, page: data?.meta?.currentPage || page, totalPages: data?.meta?.lastPage || 1 };
    }
  } catch {}
  return getTMDBSeries(page);
}

async function search(query, type = 'all') {
  const data = await fetchApi(`/api/v1/browse/search?q=${encodeURIComponent(query)}`);
  let items = (data?.data || data?.results || []).map(formatItem);
  if (type === 'film') items = items.filter(i => i.type === 'film');
  else if (type === 'serie') items = items.filter(i => i.type === 'serie');
  return items;
}

async function getAvailableSeasons(nakaId) {
  const data = await fetchApi(`/api/v1/browse/${nakaId}/available-seasons`);
  return data?.seasons || [];
}

async function getSeasonEpisodes(nakaId, season) {
  const data = await fetchApi(`/api/v1/browse/${nakaId}/season/${season}`);
  return (data?.episodes || []).map(ep => ({
    number: ep.episode_number,
    name: ep.name,
  }));
}

// Récupère le stream via Puppeteer
async function getVideoStream(nakaId, tmdbId, type = 'movie', season = 1, episode = 1) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    let sourceData = null;

    // Charger la page content pour passer Cloudflare
    await page.goto(`${BASE_URL}/content/${type}/${tmdbId}`, {
      waitUntil: 'networkidle2', timeout: 35000,
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    if (type === 'tv') {
      sourceData = await page.evaluate(async (nakaId, season, episode) => {
        const res = await fetch(`/api/v1/streaming/sources/${nakaId}?type=tv&season=${season}&episode=${episode}`, {
          credentials: 'include',
        });
        return res.ok ? res.json() : null;
      }, nakaId, season, episode);
    } else {
      sourceData = await page.evaluate(async (nakaId) => {
        const res = await fetch(`/api/v1/streaming/sources/${nakaId}?type=movie`, {
          credentials: 'include',
        });
        return res.ok ? res.json() : null;
      }, nakaId);
    }

    if (!sourceData?.sources?.length) return null;

    const source = sourceData.sources[0];
    const url = source.url.startsWith('http') ? source.url : `${BASE_URL}${source.url}`;
    const subtitles = (source.subtitles || []).map(s => ({
      lang: s.lang,
      label: s.label,
      url: s.url.startsWith('http') ? s.url : `${BASE_URL}${s.url}`,
    }));

    return { url, kind: 'hls', subtitles };
  } finally {
    await page.close();
  }
}

// Garde Chromium chaud avec les cookies Cloudflare — toutes les 4 minutes
setInterval(async () => {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/films`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.close();
  } catch {}
}, 4 * 60 * 1000);

module.exports = { getFilms, getSeries, search, getVideoStream, getAvailableSeasons, getSeasonEpisodes, formatItem };
