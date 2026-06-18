require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL: NodeURL } = require('url');
const animeRoutes = require('./routes/anime');
const filmsRoutes = require('./routes/films');
const seriesRoutes = require('./routes/series');
const notifyRoutes = require('./routes/notify');
const trailerRoutes = require('./routes/trailer');
const { getCineregalFilmUrl, getCineregalSeriesUrl, getCineregalFilmUrlWithCookies, getCineregalSeriesUrlWithCookies } = require('./scrapers/cineregal');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/anime', animeRoutes);
app.use('/api/films', filmsRoutes);
app.use('/api/series', seriesRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/trailer', trailerRoutes);

// Proxy vidéo streaming — transmet avec Referer cineregal.art, suit les redirects, supporte Range
function streamVideoProxy(url, headers, res, redirectsLeft) {
  if (redirectsLeft <= 0) return res.status(502).end();
  let parsed;
  try { parsed = new NodeURL(url); } catch { return res.status(400).end(); }
  const protocol = parsed.protocol === 'https:' ? https : http;
  const proxyReq = protocol.request({
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers,
  }, (proxyRes) => {
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
      proxyRes.resume();
      const loc = proxyRes.headers.location;
      const next = loc.startsWith('http') ? loc : new NodeURL(loc, url).toString();
      return streamVideoProxy(next, headers, res, redirectsLeft - 1);
    }
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach(h => {
      if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(proxyRes.statusCode || 200);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => { try { res.status(502).end(); } catch {} });
  proxyReq.end();
}

app.get('/api/proxy/video', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url requis' });
  const reqHeaders = {
    'Referer': 'https://cineregal.art/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
  };
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;
  req.on('close', () => res.destroy());
  streamVideoProxy(url, reqHeaders, res, 5);
});

// Proxy téléchargement — re-scrape URL + cookies CineRegal frais juste avant de streamer
app.get('/api/proxy/download', async (req, res) => {
  const { type, tmdbId, season, episode } = req.query;
  if (!type || !tmdbId) return res.status(400).json({ error: 'type et tmdbId requis' });

  let result;
  try {
    if (type === 'film') {
      result = await getCineregalFilmUrlWithCookies(Number(tmdbId));
    } else {
      result = await getCineregalSeriesUrlWithCookies(Number(tmdbId), Number(season) || 1, Number(episode) || 1);
    }
  } catch {
    return res.status(500).json({ error: 'Impossible de récupérer le lien vidéo' });
  }

  if (!result?.url) return res.status(404).json({ error: 'Vidéo non trouvée' });

  const reqHeaders = {
    'Referer': 'https://cineregal.art/',
    'Origin': 'https://cineregal.art',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  };
  if (result.cookies) reqHeaders['Cookie'] = result.cookies;
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;
  req.on('close', () => { try { res.destroy(); } catch {} });
  streamVideoProxy(result.url, reqHeaders, res, 5);
});

// Proxy générique — transmet les requêtes avec le bon Referer
app.get('/api/proxy', async (req, res) => {
  const { url, referer } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'Referer': referer || '',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': referer ? new URL(referer).origin : '',
      },
    });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(response.data));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/download/kfstream.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'kfstream.apk');
  res.setHeader('Content-Disposition', 'attachment; filename="kfstream.apk"');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.sendFile(apkPath);
});

app.get('/download/kfstream-tv.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'kfstream-tv.apk');
  res.setHeader('Content-Disposition', 'attachment; filename="kfstream-tv.apk"');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.sendFile(apkPath);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KFStream backend running on port ${PORT}`);
});
