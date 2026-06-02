const express = require('express');
const router = express.Router();
const scraper = require('../scrapers/nakastream');

// GET /api/films?page=1
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const data = await scraper.getFilms(page);
    res.json({ films: data.items, page: data.page, totalPages: data.totalPages, hasNextPage: data.page < data.totalPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/films/search?q=interstellar
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const items = await scraper.search(q, 'film');
    res.json(items);
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

module.exports = router;
