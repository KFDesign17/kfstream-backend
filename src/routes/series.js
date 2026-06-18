const express = require('express');
const axios = require('axios');
const router = express.Router();
const scraper = require('../scrapers/nakastream');
const catalogue = require('../services/catalogue');
const movixbet = require('../scrapers/movixbet');
const cineregal = require('../scrapers/cineregal');

const TMDB_TOKEN = process.env.TMDB_TOKEN;
const tmdb = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  timeout: 8000,
  headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' },
});

// GET /api/series?page=1
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  try {
    const data = await catalogue.getSeries(page);
    res.json({ series: data.items, page: data.page, totalPages: data.totalPages, hasNextPage: data.hasNextPage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/search?q=breaking+bad
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const items = await catalogue.search(q, 'serie');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/episodes?tmdbId=1396&season=1
router.get('/episodes', async (req, res) => {
  const { tmdbId, season } = req.query;
  if (!tmdbId || !season) return res.status(400).json({ error: 'tmdbId et season requis' });
  try {
    const { data } = await tmdb.get(`/tv/${tmdbId}/season/${season}`, { params: { language: 'fr-FR' } });
    const episodes = (data.episodes || []).map(ep => ({
      number: ep.episode_number,
      name: ep.name,
    }));
    res.json({ episodes, count: episodes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/seasons?tmdbId=1396
router.get('/seasons', async (req, res) => {
  const { tmdbId } = req.query;
  if (!tmdbId) return res.status(400).json({ error: 'tmdbId required' });
  try {
    const { data } = await tmdb.get(`/tv/${tmdbId}`, { params: { language: 'fr-FR' } });
    const seasons = (data.seasons || [])
      .filter(s => s.season_number > 0)
      .map(s => s.season_number);
    res.json(seasons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/series/embed?tmdbId=X&season=Y&episode=Z — retourne tous les serveurs VF disponibles
router.get('/embed', async (req, res) => {
  const { tmdbId, season, episode } = req.query;
  if (!tmdbId || !season || !episode) return res.status(400).json({ error: 'tmdbId, season, episode requis' });
  try {
    const [movixServers, cineregalServer] = await Promise.allSettled([
      movixbet.getAllSeriesVFServers(tmdbId, season, episode),
      cineregal.getCineregalSeriesUrl(tmdbId, season, episode),
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
