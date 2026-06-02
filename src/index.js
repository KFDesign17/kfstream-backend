require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const animeRoutes = require('./routes/anime');
const filmsRoutes = require('./routes/films');
const seriesRoutes = require('./routes/series');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/anime', animeRoutes);
app.use('/api/films', filmsRoutes);
app.use('/api/series', seriesRoutes);

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`KFStream backend running on http://localhost:${PORT}`);
});
