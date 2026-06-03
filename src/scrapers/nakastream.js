const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const BASE_URL = 'https://nakastream.tv';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CHROME_PATH = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : null;

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  },
});

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

async function getFilms(page = 1) {
  const { data } = await http.get(`/api/v1/browse/movies?page=${page}`);
  return {
    items: (data.data || []).map(formatItem),
    page: data.meta?.currentPage || page,
    totalPages: data.meta?.lastPage || 1,
  };
}

async function getSeries(page = 1) {
  const { data } = await http.get(`/api/v1/browse/shows?page=${page}`);
  return {
    items: (data.data || []).map(formatItem),
    page: data.meta?.currentPage || page,
    totalPages: data.meta?.lastPage || 1,
  };
}

async function search(query, type = 'all') {
  const { data } = await http.get(`/api/v1/browse/search?q=${encodeURIComponent(query)}`);
  let items = (data.data || data.results || []).map(formatItem);
  if (type === 'film') items = items.filter(i => i.type === 'film');
  else if (type === 'serie') items = items.filter(i => i.type === 'serie');
  return items;
}

async function getAvailableSeasons(nakaId) {
  const { data } = await http.get(`/api/v1/browse/${nakaId}/available-seasons`);
  return data.seasons || [];
}

// Récupère le stream via Puppeteer
async function getVideoStream(nakaId, tmdbId, type = 'movie', season = 1, episode = 1) {
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-default-apps',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--memory-pressure-off',
    ],
  };
  if (CHROME_PATH) launchOptions.executablePath = CHROME_PATH;
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    let sourceData = null;

    // Attendre la réponse sources avec un timeout généreux
    const sourcesReady = new Promise(resolve => {
      page.on('response', async res => {
        if (res.url().includes('/api/v1/streaming/sources/')) {
          try { resolve(await res.json()); } catch { resolve(null); }
        }
      });
      setTimeout(() => resolve(null), 40000);
    });

    // Charger la page
    await page.goto(`${BASE_URL}/content/${type}/${tmdbId}`, {
      waitUntil: 'networkidle2', timeout: 35000,
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    if (type === 'tv') {
      // Pour les séries : appel direct de l'API sources avec saison/épisode
      sourceData = await page.evaluate(async (nakaId, season, episode) => {
        const res = await fetch(`/api/v1/streaming/sources/${nakaId}?type=tv&season=${season}&episode=${episode}`, {
          credentials: 'include',
        });
        return res.ok ? res.json() : null;
      }, nakaId, season, episode);
    } else {
      // Pour les films : clic sur "Lecture"
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Lecture');
        if (btn) btn.click();
      });
      sourceData = await sourcesReady;
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
    await browser.close();
  }
}

module.exports = { getFilms, getSeries, search, getVideoStream, getAvailableSeasons, formatItem };
