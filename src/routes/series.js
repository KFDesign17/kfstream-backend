const express = require('express');
const router = express.Router();
const scraper = require('../scrapers/nakastream');

// GET /api/series?page=1
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const data = await scraper.getSeries(page);
    res.json({ series: data.items, page: data.page, totalPages: data.totalPages, hasNextPage: data.page < data.totalPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/search?q=breaking+bad
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const items = await scraper.search(q, 'serie');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/episodes?id=334&season=1
router.get('/episodes', async (req, res) => {
  const { id, season } = req.query;
  if (!id || !season) return res.status(400).json({ error: 'id et season requis' });
  try {
    const { data } = await require('axios').get(
      `https://nakastream.tv/api/v1/browse/${id}/season/${season}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    const episodes = (data.episodes || []).map(ep => ({
      number: ep.episode_number,
      name: ep.name,
    }));
    res.json({ episodes, count: episodes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/seasons?id=334
router.get('/seasons', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const seasons = await scraper.getAvailableSeasons(id);
    res.json(seasons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/stream?id=334&tmdbId=79744&season=1&episode=1
router.get('/stream', async (req, res) => {
  const { id, tmdbId, season, episode } = req.query;
  if (!id || !tmdbId) return res.status(400).json({ error: 'id et tmdbId requis' });
  try {
    const stream = await scraper.getVideoStream(id, tmdbId, 'tv', parseInt(season) || 1, parseInt(episode) || 1);
    if (!stream) return res.status(404).json({ error: 'Stream non trouvé' });
    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
