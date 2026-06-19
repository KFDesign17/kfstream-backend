const express = require('express');
const router = express.Router();
const scraper = require('../scrapers/nakastream');
const catalogue = require('../services/catalogue');
const movixbet = require('../scrapers/movixbet');
const cineregal = require('../scrapers/cineregal');

// GET /api/films?page=1
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const data = await catalogue.getFilms(page);
    res.json({ films: data.items, page: data.page, totalPages: data.totalPages, hasNextPage: data.hasNextPage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/films/search?q=interstellar
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const items = await catalogue.search(q, 'film');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/films/detail?tmdbId=12225
router.get('/detail', async (req, res) => {
  const { tmdbId } = req.query;
  if (!tmdbId) return res.status(400).json({ error: 'tmdbId requis' });
  try {
    const { data } = await require('axios').get(
      `https://api.themoviedb.org/3/movie/${tmdbId}?language=fr-FR`,
      { headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}`, Accept: 'application/json' }, timeout: 8000 }
    );
    res.json({ duration: data.runtime || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/films/stream?id=6529&tmdbId=12225
router.get('/stream', async (req, res) => {
  const { id, tmdbId } = req.query;
  if (!id || !tmdbId) return res.status(400).json({ error: 'id et tmdbId requis' });
  try {
    const stream = await scraper.getVideoStream(id, tmdbId, 'movie');
    if (!stream) return res.status(404).json({ error: 'Stream non trouvé' });
    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/films/embed?tmdbId=X
// Retourne tous les serveurs VF disponibles (movix.bet + cineregal)
router.get('/embed', async (req, res) => {
  const { tmdbId } = req.query;
  if (!tmdbId) return res.status(400).json({ error: 'tmdbId requis' });
  try {
    const [movixServers, cineregalServer] = await Promise.allSettled([
      movixbet.getAllVFServers(tmdbId),
      cineregal.getCineregalFilmUrl(tmdbId),
    ]);
    const servers = [
      ...(movixServers.status === 'fulfilled' ? movixServers.value : []),
      ...(cineregalServer.status === 'fulfilled' && cineregalServer.value ? [cineregalServer.value] : []),
    ];
    if (servers.length > 0) return res.json({ servers, available: true });
    return res.json({ servers: [], available: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
