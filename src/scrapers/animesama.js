const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://anime-sama.to';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL + '/',
};

async function _fetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const { method = 'GET', body = null } = opts;
  try {
    let response;
    if (method === 'POST') {
      response = await axios.post(url, body, {
        headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'Origin': BASE_URL },
        timeout: 12000,
      });
    } else {
      response = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    }
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    console.log(`[animesama] ${method} ${url} → ${response.status} len=${text.length}`);
    return { ok: response.status < 400, status: response.status, text };
  } catch (err) {
    const status = err.response?.status || 0;
    const text = typeof err.response?.data === 'string' ? err.response.data : String(err.response?.data || err.message);
    console.log(`[animesama] ${method} ${url} → ${status} error=${err.message}`);
    return { ok: false, status, text };
  }
}

async function _fetchSuggest(q) {
  const result = await _fetch('/template-php/defaut/fetch.php', {
    method: 'POST',
    body: `query=${encodeURIComponent(q)}`,
  });
  if (!result.ok) return [];
  const $ = cheerio.load(result.text);
  const results = [];
  $('a.asn-search-result').each((_, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    const slug = href.replace(`${BASE_URL}/catalogue/`, '').replace('/catalogue/', '').replace(/\/$/, '');
    const title = a.find('.asn-search-result-title').text().trim();
    const thumbnail = a.find('.asn-search-result-img').attr('src') || '';
    const subtitle = a.find('.asn-search-result-subtitle').text().trim().split(',')[0].trim();
    if (title && slug) results.push({ title, slug, thumbnail, subtitle });
  });
  return results;
}

async function searchAnime(query) {
  const results = await _fetchSuggest(query);
  if (results.length > 0) return results;
  const words = query.trim().split(/\s+/);
  if (words.length >= 3) {
    const short = words.slice(0, 2).join(' ');
    const retry = await _fetchSuggest(short);
    if (retry.length > 0) return retry;
  }
  return results;
}

async function checkVfExists(animeSlug, baseSlug) {
  try {
    const result = await _fetch(`/catalogue/${animeSlug}/${baseSlug}/vf/episodes.js`);
    return result.ok;
  } catch {
    return false;
  }
}

async function checkSeasonHasEpisodes(animeSlug, seasonSlug) {
  try {
    const result = await _fetch(`/catalogue/${animeSlug}/${seasonSlug}/episodes.js`);
    return result.ok && typeof result.text === 'string' && result.text.trim().length > 0 && /https?:\/\//.test(result.text);
  } catch {
    return false;
  }
}

async function getAnimeDetails(slug) {
  const result = await _fetch(`/catalogue/${slug}/`);
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  const data = result.text;
  const $ = cheerio.load(data);

  const title = $('#titreOeuvre').text().trim() ||
    ($('meta[property="og:title"]').attr('content') || '').replace(/\s*[-–|]\s*(anime-sama|animesama|anime sama).*/i, '').trim() ||
    $('title').text().replace(/\s*[-–|]\s*(anime-sama|animesama|anime sama).*/i, '').trim() || '';
  const subtitle = $('#titreAlter').text().trim() || $('.titrealter, .alternate-title').first().text().trim() || '';
  const synopsis = $('#synopsisText').text().trim() || $('meta[name="description"]').attr('content') || '';
  const thumbnail = $('#coverOeuvre').attr('src') || $('meta[property="og:image"]').attr('content') || '';

  const infoRows = {};
  $('.catalog-info .info-row, .info-row').first().parent().find('.info-row').each((_, row) => {
    const label = $(row).find('.info-label').text().trim().toLowerCase();
    const value = $(row).find('.info-value').text().trim();
    if (label && value) infoRows[label] = value;
  });
  $('body').find('.info-row').each((_, row) => {
    const label = $(row).find('.info-label').text().trim().toLowerCase();
    const value = $(row).find('.info-value').text().trim();
    if (label && value && !infoRows[label]) infoRows[label] = value;
  });
  const genres = infoRows['genres'] || '';
  const type = infoRows['types'] || '';
  let langs = infoRows['langues'] || '';

  const similar = [];
  $('.catalog-card').each((_, el) => {
    const card = $(el);
    const cardTitle = card.find('.card-title').text().trim();
    const href = card.find('a').attr('href') || '';
    const cardSlug = href.replace(`${BASE_URL}/catalogue/`, '').replace('/catalogue/', '').replace(/\/$/, '');
    const cardThumb = card.find('.card-image').attr('src') || '';
    const cardSubtitle = card.find('.alternate-titles').text().trim().split(',')[0].trim();
    const cardRows = {};
    card.find('.info-row').each((_, row) => {
      const lbl = $(row).find('.info-label').text().trim().toLowerCase();
      const val = $(row).find('.info-value').text().trim();
      if (lbl && val) cardRows[lbl] = val;
    });
    if (cardTitle && cardSlug) similar.push({
      title: cardTitle, slug: cardSlug, thumbnail: cardThumb, subtitle: cardSubtitle,
      genres: cardRows['genres'] || '', type: cardRows['types'] || '', langs: cardRows['langues'] || '',
    });
  });

  const dataNoComments = data.replace(/\/\*[\s\S]*?\*\//g, '');
  const vostfrSeasons = [];
  const seasonRegex = /panneauAnime\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = seasonRegex.exec(dataNoComments)) !== null) {
    if (match[1] !== 'nom' && match[2] !== 'url') {
      vostfrSeasons.push({ name: match[1], slug: match[2] });
    }
  }

  const seasons = [];
  await Promise.all(vostfrSeasons.map(async (s) => {
    const baseSlug = s.slug.replace('/vostfr', '');
    const hasEpisodes = await checkSeasonHasEpisodes(slug, s.slug);
    if (!hasEpisodes) return;
    const hasVf = await checkVfExists(slug, baseSlug);
    seasons.push(s);
    if (hasVf) {
      seasons.push({ name: s.name, slug: `${baseSlug}/vf` });
    }
  }));

  seasons.sort((a, b) => {
    const ia = vostfrSeasons.findIndex(s => s.slug === a.slug || s.slug === a.slug.replace('/vf', '/vostfr'));
    const ib = vostfrSeasons.findIndex(s => s.slug === b.slug || s.slug === b.slug.replace('/vf', '/vostfr'));
    return ia !== ib ? ia - ib : (a.slug.endsWith('/vf') ? 1 : -1);
  });

  if (!langs && seasons.length > 0) {
    const hasVostfr = seasons.some(s => s.slug.endsWith('/vostfr'));
    const hasVf = seasons.some(s => s.slug.endsWith('/vf'));
    langs = [hasVostfr ? 'VOSTFR' : null, hasVf ? 'VF' : null].filter(Boolean).join(', ');
  }

  const thumbFinal = thumbnail || `https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/${slug}.webp`;
  return { title, subtitle, synopsis, thumbnail: thumbFinal, seasons, genres, type, langs, similar };
}

async function getEpisodes(animeSlug, seasonSlug) {
  const result = await _fetch(`/catalogue/${animeSlug}/${seasonSlug}/episodes.js`);
  if (!result.ok) return { episodes: [], lecteurs: {} };
  const data = result.text;

  const episodes = [];
  const epsRegex = /var\s+(eps\d+)\s*=\s*\[([^\]]+)\]/g;
  let match;
  const lecteurs = {};

  while ((match = epsRegex.exec(data)) !== null) {
    const varName = match[1];
    const urls = match[2]
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    lecteurs[varName] = urls;
  }

  const mainLecteur = lecteurs['eps1'] || [];
  mainLecteur.forEach((videoUrl, i) => {
    const epNum = i + 1;
    const sources = {};
    Object.keys(lecteurs).forEach(key => {
      if (lecteurs[key][i]) sources[key] = lecteurs[key][i];
    });
    episodes.push({ number: epNum, title: `Épisode ${epNum}`, sources });
  });

  return { episodes, lecteurs };
}

async function getHomePage() {
  const result = await _fetch('/');
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  const $ = cheerio.load(result.text);

  const featured = [];
  $('.ak-slide').each((_, el) => {
    const slide = $(el);
    const title = slide.find('.ak-slide-title').text().trim();
    const thumbnail = slide.find('.ak-slide-bg img').attr('src') || '';
    const synopsis = slide.find('.ak-slide-synopsis').text().trim();
    const genres = slide.find('.ak-genre-tag').map((_, g) => $(g).text().trim()).get();
    const badge = slide.find('.ak-badge').text().trim();
    const ctaHref = slide.find('.ak-slide-cta').first().attr('href') || '';
    const slugMatch = ctaHref.match(/\/catalogue\/([^/]+)\//);
    const slug = slugMatch ? slugMatch[1] : '';
    const ctas = [];
    slide.find('.ak-slide-cta').each((_, a) => {
      const href = $(a).attr('href') || '';
      const seasonSlug = href.replace(/^\/catalogue\/[^/]+\//, '').replace(/\/$/, '');
      const lang = seasonSlug.endsWith('/vf') ? 'VF' : 'VOSTFR';
      if (seasonSlug) ctas.push({ lang, season: seasonSlug });
    });
    if (title && slug) featured.push({ title, slug, thumbnail, synopsis, genres, badge, ctas });
  });

  const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const rawSections = [];
  $('.fadeJours').each((i, el) => {
    const section = $(el);
    const sectionTitle = section.find('.titreJours').text().replace(/[<>]/g, '').trim()
      .split('\n').map(s => s.trim()).filter(Boolean)[0] || jours[i] || `Jour ${i}`;
    const rawCards = [];
    section.find('.anime-card-premium').each((_, card) => {
      const c = $(card);
      const href = c.find('a').first().attr('href') || '';
      const slugMatch = href.match(/\/catalogue\/([^/]+)/);
      const slug = slugMatch ? slugMatch[1] : '';
      const title = c.find('.card-title').first().text().trim();
      const thumbnail = c.find('.card-image').attr('src') || '';
      const flagAlt = c.find('.flag-icon').attr('alt') || c.find('.flag-icon').attr('title') || 'VOSTFR';
      const lang = flagAlt.toLowerCase().includes('vf') && !flagAlt.toLowerCase().includes('vostfr') ? 'vf' : 'vostfr';
      const infoTexts = c.find('.info-text').map((_, el) => $(el).text().trim()).get();
      const time = infoTexts.find(t => /^\d{1,2}h\d{2}$/.test(t)) || '';
      const season = infoTexts.find(t => /saison/i.test(t)) || '';
      const afterSlug = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\/catalogue\/[^/]+\//, '').replace(/\/$/, '');
      const baseSlug = afterSlug.replace(/\/(vostfr|vf)$/, '');
      if (slug) rawCards.push({ title: title || slug, slug, thumbnail, lang, time, season, baseSlug });
    });
    rawSections.push({ title: sectionTitle, rawCards });
  });

  const sectionsWithVf = await Promise.all(rawSections.map(async ({ title, rawCards }) => {
    const seen = new Set();
    const unique = rawCards.filter(c => { if (seen.has(c.slug)) return false; seen.add(c.slug); return true; });
    const items = await Promise.all(unique.map(async (card) => {
      let langs = card.lang;
      if (card.lang === 'vostfr' && card.baseSlug) {
        try {
          const hasVf = await checkVfExists(card.slug, card.baseSlug);
          if (hasVf) langs = 'vostfr,vf';
        } catch {}
      }
      return { title: card.title, slug: card.slug, thumbnail: card.thumbnail, lang: card.lang, langs, time: card.time, season: card.season };
    }));
    return { title, items };
  }));

  const ordreJours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const sections = sectionsWithVf
    .filter(s => s.items.length > 0)
    .sort((a, b) => {
      const ia = ordreJours.findIndex(j => a.title.toLowerCase().includes(j));
      const ib = ordreJours.findIndex(j => b.title.toLowerCase().includes(j));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  const seenFeatured = new Set();
  const uniqueFeatured = featured.filter(f => { if (seenFeatured.has(f.slug)) return false; seenFeatured.add(f.slug); return true; });

  const latestEpisodes = [];
  $('#containerAjoutsAnimes .anime-card-premium').each((_, card) => {
    const c = $(card);
    const href = c.find('a').first().attr('href') || '';
    const slugMatch = href.match(/\/catalogue\/([^/]+)/);
    const slug = slugMatch ? slugMatch[1] : '';
    const title = c.find('.card-title').first().text().trim();
    const thumbnail = c.find('.card-image').attr('src') || '';
    const flagAlt = c.find('.flag-icon').attr('alt') || 'VOSTFR';
    const lang = flagAlt.toLowerCase().includes('vf') && !flagAlt.toLowerCase().includes('vostfr') ? 'vf' : 'vostfr';
    const episodeInfo = c.find('.info-text').first().text().trim();
    const dateText = c.find('.time-text').first().text().trim();
    if (slug) latestEpisodes.push({ title, slug, thumbnail, lang, episodeInfo, date: dateText });
  });

  return { featured: uniqueFeatured, sections, latestEpisodes };
}

async function getCatalogue({ page = 1, types = [], langs = [], genres = [] } = {}) {
  const params = new URLSearchParams();
  params.append('page', page);
  types.forEach(t => params.append('type[]', t));
  langs.forEach(l => params.append('langue[]', l));
  genres.forEach(g => params.append('genre[]', g));

  const result = await _fetch(`/catalogue/?${params.toString()}`);
  if (!result.ok) return { items: [], page, totalPages: 1 };
  const $ = cheerio.load(result.text);

  const items = [];
  $('.catalog-card').each((_, el) => {
    const card = $(el);
    const title = card.find('.card-title').text().trim();
    const href = card.find('a').attr('href') || '';
    const slug = href.replace(`${BASE_URL}/catalogue/`, '').replace('/catalogue/', '').replace(/\/$/, '');
    const thumbnail = card.find('.card-image').attr('src') || '';
    const subtitle = card.find('.alternate-titles').text().trim();
    const infoRows = {};
    card.find('.info-row').each((_, row) => {
      const label = $(row).find('.info-label').text().trim().toLowerCase();
      const value = $(row).find('.info-value').text().trim();
      if (label && value) infoRows[label] = value;
    });
    const flagTitles = card.find('.lang-flag').map((_, el) => $(el).attr('title')).get();
    const cardLangs = [];
    if (flagTitles.includes('JP')) cardLangs.push('VOSTFR');
    if (flagTitles.includes('FR')) cardLangs.push('VF');
    if (flagTitles.length > 0 && !flagTitles.includes('JP') && !flagTitles.includes('FR')) {
      cardLangs.push(flagTitles.join(', '));
    }
    const langsStr = cardLangs.join(', ') || infoRows['langues'] || '';
    if (title && slug) items.push({
      title, slug, thumbnail, subtitle,
      genres: infoRows['genres'] || '',
      type: infoRows['types'] || '',
      langs: langsStr,
    });
  });

  let filtered = items;
  if (langs.length > 0) {
    filtered = filtered.filter(item =>
      langs.some(l => item.langs.toUpperCase().includes(l.toUpperCase()))
    );
  }
  if (types.length > 0) {
    filtered = filtered.filter(item =>
      types.some(t => item.type.toUpperCase().includes(t.toUpperCase()))
    );
  }

  const pages = [];
  $('#list_pagination a').each((_, el) => {
    const p = parseInt($(el).text().trim());
    if (p) pages.push(p);
  });
  const totalPages = pages.length ? Math.max(...pages) : 1;

  return { items: filtered, page, totalPages };
}

// ─── Pure parsers (no HTTP, called from /api/anime/parse route) ─────────────

function parseSearchHtml(html) {
  const $ = cheerio.load(html);
  const results = [];
  $('a.asn-search-result').each((_, el) => {
    const a = $(el);
    const href = a.attr('href') || '';
    const slug = href.replace(`${BASE_URL}/catalogue/`, '').replace('/catalogue/', '').replace(/\/$/, '');
    const title = a.find('.asn-search-result-title').text().trim();
    const thumbnail = a.find('.asn-search-result-img').attr('src') || '';
    const subtitle = a.find('.asn-search-result-subtitle').text().trim().split(',')[0].trim();
    if (title && slug) results.push({ title, slug, thumbnail, subtitle });
  });
  return results;
}

function parseEpisodesJs(text) {
  const episodes = [];
  const epsRegex = /var\s+(eps\d+)\s*=\s*\[([^\]]+)\]/g;
  let match;
  const lecteurs = {};
  while ((match = epsRegex.exec(text)) !== null) {
    const varName = match[1];
    const urls = match[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    lecteurs[varName] = urls;
  }
  const mainLecteur = lecteurs['eps1'] || [];
  mainLecteur.forEach((videoUrl, i) => {
    const epNum = i + 1;
    const sources = {};
    Object.keys(lecteurs).forEach(key => { if (lecteurs[key][i]) sources[key] = lecteurs[key][i]; });
    episodes.push({ number: epNum, title: `Épisode ${epNum}`, sources });
  });
  return { episodes, lecteurs };
}

function parseHomeHtml(html) {
  const $ = cheerio.load(html);

  const featured = [];
  $('.ak-slide').each((_, el) => {
    const slide = $(el);
    const title = slide.find('.ak-slide-title').text().trim();
    const thumbnail = slide.find('.ak-slide-bg img').attr('src') || '';
    const synopsis = slide.find('.ak-slide-synopsis').text().trim();
    const genres = slide.find('.ak-genre-tag').map((_, g) => $(g).text().trim()).get();
    const badge = slide.find('.ak-badge').text().trim();
    const ctaHref = slide.find('.ak-slide-cta').first().attr('href') || '';
    const slugMatch = ctaHref.match(/\/catalogue\/([^/]+)\//);
    const slug = slugMatch ? slugMatch[1] : '';
    const ctas = [];
    slide.find('.ak-slide-cta').each((_, a) => {
      const href = $(a).attr('href') || '';
      const seasonSlug = href.replace(/^\/catalogue\/[^/]+\//, '').replace(/\/$/, '');
      const lang = seasonSlug.endsWith('/vf') ? 'VF' : 'VOSTFR';
      if (seasonSlug) ctas.push({ lang, season: seasonSlug });
    });
    if (title && slug) featured.push({ title, slug, thumbnail, synopsis, genres, badge, ctas });
  });

  const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const rawSections = [];
  $('.fadeJours').each((i, el) => {
    const section = $(el);
    const sectionTitle = section.find('.titreJours').text().replace(/[<>]/g, '').trim()
      .split('\n').map(s => s.trim()).filter(Boolean)[0] || jours[i] || `Jour ${i}`;
    const rawCards = [];
    section.find('.anime-card-premium').each((_, card) => {
      const c = $(card);
      const href = c.find('a').first().attr('href') || '';
      const slugMatch = href.match(/\/catalogue\/([^/]+)/);
      const slug = slugMatch ? slugMatch[1] : '';
      const title = c.find('.card-title').first().text().trim();
      const thumbnail = c.find('.card-image').attr('src') || '';
      const flagAlt = c.find('.flag-icon').attr('alt') || c.find('.flag-icon').attr('title') || 'VOSTFR';
      const lang = flagAlt.toLowerCase().includes('vf') && !flagAlt.toLowerCase().includes('vostfr') ? 'vf' : 'vostfr';
      const infoTexts = c.find('.info-text').map((_, el) => $(el).text().trim()).get();
      const time = infoTexts.find(t => /^\d{1,2}h\d{2}$/.test(t)) || '';
      const season = infoTexts.find(t => /saison/i.test(t)) || '';
      const afterSlug = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\/catalogue\/[^/]+\//, '').replace(/\/$/, '');
      const baseSlug = afterSlug.replace(/\/(vostfr|vf)$/, '');
      if (slug) rawCards.push({ title: title || slug, slug, thumbnail, lang, time, season, baseSlug });
    });
    rawSections.push({ title: sectionTitle, rawCards });
  });

  const latestEpisodes = [];
  $('#containerAjoutsAnimes .anime-card-premium').each((_, card) => {
    const c = $(card);
    const href = c.find('a').first().attr('href') || '';
    const slugMatch = href.match(/\/catalogue\/([^/]+)/);
    const slug = slugMatch ? slugMatch[1] : '';
    const title = c.find('.card-title').first().text().trim();
    const thumbnail = c.find('.card-image').attr('src') || '';
    const flagAlt = c.find('.flag-icon').attr('alt') || 'VOSTFR';
    const lang = flagAlt.toLowerCase().includes('vf') && !flagAlt.toLowerCase().includes('vostfr') ? 'vf' : 'vostfr';
    const episodeInfo = c.find('.info-text').first().text().trim();
    const dateText = c.find('.time-text').first().text().trim();
    if (slug) latestEpisodes.push({ title, slug, thumbnail, lang, episodeInfo, date: dateText });
  });

  // Build sections with vf info (based on provided checks if available, else no vf)
  const sections = rawSections.map(({ title, rawCards }) => {
    const seen = new Set();
    const items = rawCards
      .filter(c => { if (seen.has(c.slug)) return false; seen.add(c.slug); return true; })
      .map(card => ({ title: card.title, slug: card.slug, thumbnail: card.thumbnail, lang: card.lang, langs: card.lang, time: card.time, season: card.season }));
    return { title, items };
  }).filter(s => s.items.length > 0).sort((a, b) => {
    const order = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    const ia = order.findIndex(j => a.title.toLowerCase().includes(j));
    const ib = order.findIndex(j => b.title.toLowerCase().includes(j));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const seenFeatured = new Set();
  const uniqueFeatured = featured.filter(f => { if (seenFeatured.has(f.slug)) return false; seenFeatured.add(f.slug); return true; });

  return { featured: uniqueFeatured, sections, latestEpisodes };
}

function parseDetailsHtml(html, slug, seasonChecks) {
  const $ = cheerio.load(html);

  const title = $('#titreOeuvre').text().trim() ||
    ($('meta[property="og:title"]').attr('content') || '').replace(/\s*[-–|]\s*(anime-sama|animesama|anime sama).*/i, '').trim() ||
    $('title').text().replace(/\s*[-–|]\s*(anime-sama|animesama|anime sama).*/i, '').trim() || '';
  const subtitle = $('#titreAlter').text().trim() || $('.titrealter, .alternate-title').first().text().trim() || '';
  const synopsis = $('#synopsisText').text().trim() || $('meta[name="description"]').attr('content') || '';
  const thumbnail = $('#coverOeuvre').attr('src') || $('meta[property="og:image"]').attr('content') || '';

  const infoRows = {};
  $('body').find('.info-row').each((_, row) => {
    const label = $(row).find('.info-label').text().trim().toLowerCase();
    const value = $(row).find('.info-value').text().trim();
    if (label && value && !infoRows[label]) infoRows[label] = value;
  });
  const genres = infoRows['genres'] || '';
  const type = infoRows['types'] || '';

  const similar = [];
  $('.catalog-card').each((_, el) => {
    const card = $(el);
    const cardTitle = card.find('.card-title').text().trim();
    const href = card.find('a').attr('href') || '';
    const cardSlug = href.replace(`${BASE_URL}/catalogue/`, '').replace('/catalogue/', '').replace(/\/$/, '');
    const cardThumb = card.find('.card-image').attr('src') || '';
    const cardSubtitle = card.find('.alternate-titles').text().trim().split(',')[0].trim();
    const cardRows = {};
    card.find('.info-row').each((_, row) => {
      const lbl = $(row).find('.info-label').text().trim().toLowerCase();
      const val = $(row).find('.info-value').text().trim();
      if (lbl && val) cardRows[lbl] = val;
    });
    if (cardTitle && cardSlug) similar.push({
      title: cardTitle, slug: cardSlug, thumbnail: cardThumb, subtitle: cardSubtitle,
      genres: cardRows['genres'] || '', type: cardRows['types'] || '', langs: cardRows['langues'] || '',
    });
  });

  // seasonChecks: [{ name, slug, hasEpisodes, hasVf }] provided by the mobile WebView
  const seasons = [];
  if (seasonChecks && seasonChecks.length > 0) {
    // Use the order from checks (which matches HTML order)
    const vostfrSlugs = seasonChecks.map(c => c.slug);
    seasonChecks.forEach(check => {
      if (!check.hasEpisodes) return;
      const baseSlug = check.slug.replace('/vostfr', '');
      seasons.push({ name: check.name, slug: check.slug });
      if (check.hasVf) seasons.push({ name: check.name, slug: `${baseSlug}/vf` });
    });
    seasons.sort((a, b) => {
      const ia = vostfrSlugs.findIndex(s => s === a.slug || s === a.slug.replace('/vf', '/vostfr'));
      const ib = vostfrSlugs.findIndex(s => s === b.slug || s === b.slug.replace('/vf', '/vostfr'));
      return ia !== ib ? ia - ib : (a.slug.endsWith('/vf') ? 1 : -1);
    });
  }

  const hasVostfr = seasons.some(s => s.slug.endsWith('/vostfr'));
  const hasVf = seasons.some(s => s.slug.endsWith('/vf'));
  const langs = infoRows['langues'] || [hasVostfr ? 'VOSTFR' : null, hasVf ? 'VF' : null].filter(Boolean).join(', ');

  return { title, subtitle, synopsis, thumbnail, seasons, genres, type, langs, similar };
}

function parseCatalogueHtml(html, { types = [], langs = [] } = {}) {
  const $ = cheerio.load(html);
  const items = [];
  $('.catalog-card').each((_, el) => {
    const card = $(el);
    const title = card.find('.card-title').text().trim();
    const href = card.find('a').attr('href') || '';
    const slug = href.replace(`${BASE_URL}/catalogue/`, '').replace('/catalogue/', '').replace(/\/$/, '');
    const thumbnail = card.find('.card-image').attr('src') || '';
    const subtitle = card.find('.alternate-titles').text().trim();
    const infoRows = {};
    card.find('.info-row').each((_, row) => {
      const label = $(row).find('.info-label').text().trim().toLowerCase();
      const value = $(row).find('.info-value').text().trim();
      if (label && value) infoRows[label] = value;
    });
    const flagTitles = card.find('.lang-flag').map((_, el) => $(el).attr('title')).get();
    const cardLangs = [];
    if (flagTitles.includes('JP')) cardLangs.push('VOSTFR');
    if (flagTitles.includes('FR')) cardLangs.push('VF');
    if (flagTitles.length > 0 && !flagTitles.includes('JP') && !flagTitles.includes('FR')) cardLangs.push(flagTitles.join(', '));
    const langsStr = cardLangs.join(', ') || infoRows['langues'] || '';
    if (title && slug) items.push({ title, slug, thumbnail, subtitle, genres: infoRows['genres'] || '', type: infoRows['types'] || '', langs: langsStr });
  });

  let filtered = items;
  if (langs.length > 0) filtered = filtered.filter(item => langs.some(l => item.langs.toUpperCase().includes(l.toUpperCase())));
  if (types.length > 0) filtered = filtered.filter(item => types.some(t => item.type.toUpperCase().includes(t.toUpperCase())));

  const pages = [];
  $('#list_pagination a').each((_, el) => { const p = parseInt($(el).text().trim()); if (p) pages.push(p); });
  const totalPages = pages.length ? Math.max(...pages) : 1;

  return { items: filtered, totalPages };
}

module.exports = { searchAnime, getAnimeDetails, getEpisodes, getHomePage, getCatalogue, parseSearchHtml, parseEpisodesJs, parseHomeHtml, parseDetailsHtml, parseCatalogueHtml };
