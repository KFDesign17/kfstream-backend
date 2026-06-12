const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const BASE_URL = 'https://fexini.net';
const TMDB_POSTER = 'https://image.tmdb.org/t/p/w780';
const TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  },
});

function formatItem(item) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    originalTitle: item.originalTitle || item.title,
    thumbnail: item.posterPath ? `${TMDB_POSTER}${item.posterPath}` : '',
    backdrop: item.backdropPath ? `${TMDB_BACKDROP}${item.backdropPath}` : '',
    synopsis: item.overview || '',
    year: item.releaseYear || null,
    rating: item.voteAverage || null,
    duration: item.runtimeMinutes || null,
    type: item.type === 'MOVIE' ? 'film' : 'serie',
    seasons: item.numberOfSeasons || null,
    episodes: item.numberOfEpisodes || null,
    url: item.type === 'MOVIE'
      ? `${BASE_URL}/watch/${item.slug}`
      : `${BASE_URL}/watch/${item.slug}`,
  };
}

async function search(query, type = 'all') {
  const { data } = await http.get(`/api/search?q=${encodeURIComponent(query)}`);
  const groups = data?.result?.groups || [];

  let items = [];
  for (const group of groups) {
    if (type === 'film' && group.type !== 'films') continue;
    if (type === 'serie' && group.type !== 'series') continue;
    items = items.concat((group.items || []).map(formatItem));
  }
  return items;
}

async function getFilms(page = 1) {
  // Fexini n'a pas d'API de listing publique — on utilise les nouveautés via search vide
  // En attendant, retourner une liste vide (la recherche est la fonctionnalité principale)
  return { items: [], page, totalPages: 1 };
}

async function getSeries(page = 1) {
  return { items: [], page, totalPages: 1 };
}

// Obtenir le stream vidéo via Puppeteer
// slug: "interstellar" pour un film, "euphoria-2019/saison-3/episode-8" pour une série
async function getVideoStream(slug) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: ['--no-sandbox'],
  });

  try {
    const page = await browser.newPage();

    let nativeStream = null;
    let sourceData = null;

    // Capturer les réponses API via listener simple
    page.on('response', async res => {
      try {
        if (res.url().includes('/api/watch/native-stream')) {
          nativeStream = await res.json();
        }
        if (res.url().includes('/api/watch/source')) {
          sourceData = await res.json();
        }
      } catch {}
    });

    // 1. Homepage pour initialiser la session
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    // 2. Film/épisode — networkidle2 déclenche le player (timeout ignoré)
    await page.goto(`${BASE_URL}/watch/${slug}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});

    // Attendre un peu après le timeout pour s'assurer que les listeners ont fini
    await new Promise(r => setTimeout(r, 1000));

    if (!nativeStream?.url) return null;

    return {
      url: nativeStream.url,
      kind: nativeStream.kind,
      referer: nativeStream.referer || '',
      subtitles: nativeStream.subtitles || [],
      source: sourceData ? {
        provider: sourceData.providerLabel,
        language: sourceData.language,
        quality: sourceData.quality,
      } : null,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { search, getFilms, getSeries, getVideoStream, formatItem };
