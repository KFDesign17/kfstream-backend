const express = require('express');
const router = express.Router();
const scraper = require('../scrapers/animesama');
const axios = require('axios');

// GET /api/anime/resolve-url?url=https://video.sibnet.ru/shell.php?videoid=xxx
router.get('/resolve-url', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    // Sibnet
    if (url.includes('sibnet.ru')) {
      const { data } = await axios.get(url, { headers: { 'User-Agent': ua }, timeout: 10000 });
      const match = data.match(/player\.src\(\[{src:\s*"([^"]+)"/);
      if (match) {
        const path = match[1];
        const embedUrl = path.startsWith('http') ? path : `https://video.sibnet.ru${path}`;
        const redirect = await axios.get(embedUrl, {
          headers: { 'Referer': url, 'User-Agent': ua },
          maxRedirects: 0,
          validateStatus: s => s === 302 || s === 200,
        });
        const cdnUrl = redirect.headers.location
          ? (redirect.headers.location.startsWith('//') ? 'https:' + redirect.headers.location : redirect.headers.location)
          : embedUrl;
        return res.json({ url: cdnUrl, type: 'mp4' });
      }
    }

    // Sendvid
    if (url.includes('sendvid.com')) {
      const { data } = await axios.get(url, { headers: { 'User-Agent': ua }, timeout: 10000 });
      const match = data.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/);
      if (match) return res.json({ url: match[0], type: 'mp4' });
      // Sendvid supporte iframe → fallback embed
      return res.json({ url, type: 'embed' });
    }

    // Vidmoly → non supporté (redirige vers survey sans session)
    if (url.includes('vidmoly.to')) {
      return res.json({ url, type: 'unsupported' });
    }

    // Autres → embed iframe
    return res.json({ url, type: 'embed' });
  } catch (err) {
    return res.json({ url, type: 'embed' });
  }
});

// GET /api/anime/catalogue?page=1&type[]=Anime&lang[]=VOSTFR&genre[]=Action
// GET /api/anime/stream?url=https://video.sibnet.ru/shell.php?videoid=xxx
// Proxy streaming : résout l'URL fraîche et streame le contenu en direct
router.get('/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  try {
    let cdnUrl = null;

    if (url.includes('sibnet.ru')) {
      const { data } = await axios.get(url, { headers: { 'User-Agent': ua }, timeout: 10000 });
      const match = data.match(/player\.src\(\[{src:\s*"([^"]+)"/);
      if (match) {
        const path = match[1];
        const embedUrl = path.startsWith('http') ? path : `https://video.sibnet.ru${path}`;
        const redirect = await axios.get(embedUrl, {
          headers: { 'Referer': url, 'User-Agent': ua },
          maxRedirects: 0,
          validateStatus: s => s === 302 || s === 200,
        });
        cdnUrl = redirect.headers.location
          ? (redirect.headers.location.startsWith('//') ? 'https:' + redirect.headers.location : redirect.headers.location)
          : embedUrl;
      }
    } else if (url.includes('sendvid.com')) {
      const { data } = await axios.get(url, { headers: { 'User-Agent': ua }, timeout: 10000 });
      const match = data.match(/https?:\/\/[^"' ]+\.mp4[^"' ]*/);
      if (match) cdnUrl = match[0];
    }

    if (!cdnUrl) return res.status(404).end();

    // Support Range requests (seek dans la vidéo)
    const rangeHeader = req.headers.range;
    const videoResp = await axios.get(cdnUrl, {
      headers: {
        'User-Agent': ua,
        'Referer': url.includes('sibnet') ? 'https://video.sibnet.ru/' : url,
        ...(rangeHeader ? { 'Range': rangeHeader } : {}),
      },
      responseType: 'stream',
      timeout: 60000,
    });

    res.setHeader('Content-Type', videoResp.headers['content-type'] || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (videoResp.headers['content-length']) res.setHeader('Content-Length', videoResp.headers['content-length']);
    if (videoResp.headers['content-range']) res.setHeader('Content-Range', videoResp.headers['content-range']);
    res.status(videoResp.status);
    videoResp.data.pipe(res);
  } catch (err) {
    res.status(500).end();
  }
});

router.get('/catalogue', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const types = [].concat(req.query['type[]'] || req.query.type || []);
  const langs = [].concat(req.query['lang[]'] || req.query.lang || []);
  const genres = [].concat(req.query['genre[]'] || req.query.genre || []);
  try {
    const data = await scraper.getCatalogue({ page, types, langs, genres });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/home
router.get('/home', async (req, res) => {
  try {
    const data = await scraper.getHomePage();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/anime/search?q=naruto
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const results = await scraper.searchAnime(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/anime/:slug
router.get('/:slug', async (req, res) => {
  try {
    const details = await scraper.getAnimeDetails(req.params.slug);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/anime/:slug/episodes?season=saison1/vostfr
router.get('/:slug/episodes', async (req, res) => {
  const { season } = req.query;
  if (!season) return res.status(400).json({ error: 'Query parameter "season" is required' });
  try {
    const data = await scraper.getEpisodes(req.params.slug, season);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
