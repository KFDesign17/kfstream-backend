const express = require('express');
const axios = require('axios');
const router = express.Router();

const TMDB_TOKEN = process.env.TMDB_TOKEN;
const tmdb = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  timeout: 8000,
  headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' },
});

async function getYoutubeTrailer(videos) {
  const list = videos?.results || [];
  // Priorité : Trailer FR → Trailer EN → Teaser FR → Teaser EN
  const find = (type, lang) => list.find(v => v.site === 'YouTube' && v.type === type && v.iso_639_1 === lang);
  const v = find('Trailer','fr') || find('Trailer','en') || find('Teaser','fr') || find('Teaser','en')
          || list.find(v => v.site === 'YouTube');
  return v?.key || null;
}

// GET /api/trailer?tmdbId=123&type=movie|tv
router.get('/', async (req, res) => {
  const { tmdbId, type = 'movie' } = req.query;
  if (!tmdbId) return res.status(400).json({ error: 'tmdbId required' });
  if (!TMDB_TOKEN) return res.status(500).json({ error: 'TMDB_TOKEN not configured' });
  try {
    const endpoint = type === 'tv' ? `/tv/${tmdbId}/videos` : `/movie/${tmdbId}/videos`;
    const { data } = await tmdb.get(endpoint, { params: { language: 'fr-FR' } });
    let key = await getYoutubeTrailer(data);
    // Fallback anglais si pas de vidéo en FR
    if (!key) {
      const { data: dataEn } = await tmdb.get(endpoint, { params: { language: 'en-US' } });
      key = await getYoutubeTrailer(dataEn);
    }
    if (!key) return res.status(404).json({ error: 'No trailer found' });
    res.json({ key, url: `https://www.youtube.com/embed/${key}?autoplay=1&rel=0` });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/trailer/search?title=Naruto&type=tv  (pour les animes sans tmdbId)
router.get('/search', async (req, res) => {
  const { title, type = 'tv' } = req.query;
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!TMDB_TOKEN) return res.status(500).json({ error: 'TMDB_TOKEN not configured' });
  try {
    const searchEndpoint = type === 'tv' ? '/search/tv' : '/search/movie';
    const { data: search } = await tmdb.get(searchEndpoint, { params: { query: title, language: 'fr-FR' } });
    const result = search.results?.[0];
    if (!result) return res.status(404).json({ error: 'Not found on TMDB' });
    const videoEndpoint = type === 'tv' ? `/tv/${result.id}/videos` : `/movie/${result.id}/videos`;
    const { data: videos } = await tmdb.get(videoEndpoint, { params: { language: 'fr-FR' } });
    let key = await getYoutubeTrailer(videos);
    if (!key) {
      const { data: videosEn } = await tmdb.get(videoEndpoint, { params: { language: 'en-US' } });
      key = await getYoutubeTrailer(videosEn);
    }
    if (!key) return res.status(404).json({ error: 'No trailer found' });
    res.json({ key, url: `https://www.youtube.com/embed/${key}?autoplay=1&rel=0` });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
