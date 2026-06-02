const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://anime-sama.to';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
});

async function searchAnime(query) {
  const { data } = await http.get(`/catalogue/?search=${encodeURIComponent(query)}`);
  const $ = cheerio.load(data);
  const results = [];

  $('.catalog-card').each((_, el) => {
    const card = $(el);
    const title = card.find('.card-title').text().trim();
    const href = card.find('a').attr('href') || '';
    const slug = href.replace(`${BASE_URL}/catalogue/`, '').replace('/catalogue/', '').replace(/\/$/, '');
    const thumbnail = card.find('.card-image').attr('src') || '';
    const subtitle = card.find('.alternate-titles').text().trim().split(',')[0].trim();
    if (title && slug) results.push({ title, slug, thumbnail, subtitle });
  });

  return results;
}

async function checkVfExists(animeSlug, baseSlug) {
  try {
    await http.head(`/catalogue/${animeSlug}/${baseSlug}/vf/episodes.js`);
    return true;
  } catch {
    return false;
  }
}

async function getAnimeDetails(slug) {
  const { data } = await http.get(`/catalogue/${slug}/`);
  const $ = cheerio.load(data);

  const title = $('#titreOeuvre').text().trim();
  const subtitle = $('#titreAlter').text().trim() || $('.titrealter, .alternate-title').first().text().trim() || '';
  const synopsis = $('meta[name="description"]').attr('content') || '';
  const thumbnail = $('#coverOeuvre').attr('src') || $('meta[property="og:image"]').attr('content') || '';

  // Infos : genres, type, langues
  const infoRows = {};
  $('.catalog-info .info-row, .info-row').first().parent().find('.info-row').each((_, row) => {
    const label = $(row).find('.info-label').text().trim().toLowerCase();
    const value = $(row).find('.info-value').text().trim();
    if (label && value) infoRows[label] = value;
  });
  // Cherche aussi directement dans la page principale
  $('body').find('.info-row').each((_, row) => {
    const label = $(row).find('.info-label').text().trim().toLowerCase();
    const value = $(row).find('.info-value').text().trim();
    if (label && value && !infoRows[label]) infoRows[label] = value;
  });
  const genres = infoRows['genres'] || '';
  const type = infoRows['types'] || '';
  const langs = infoRows['langues'] || '';

  // Oeuvres similaires
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

  // Saisons extraites des appels panneauAnime("nom", "url") dans le HTML
  const vostfrSeasons = [];
  const seasonRegex = /panneauAnime\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = seasonRegex.exec(data)) !== null) {
    if (match[1] !== 'nom' && match[2] !== 'url') {
      vostfrSeasons.push({ name: match[1], slug: match[2] });
    }
  }

  // Pour chaque saison VOSTFR, vérifie si une version VF existe
  const seasons = [];
  await Promise.all(vostfrSeasons.map(async (s) => {
    const baseSlug = s.slug.replace('/vostfr', '');
    const hasVf = await checkVfExists(slug, baseSlug);
    seasons.push(s);
    if (hasVf) {
      seasons.push({ name: s.name, slug: `${baseSlug}/vf` });
    }
  }));

  // Remet dans le bon ordre (même ordre que vostfrSeasons)
  seasons.sort((a, b) => {
    const ia = vostfrSeasons.findIndex(s => s.slug === a.slug || s.slug === a.slug.replace('/vf', '/vostfr'));
    const ib = vostfrSeasons.findIndex(s => s.slug === b.slug || s.slug === b.slug.replace('/vf', '/vostfr'));
    return ia !== ib ? ia - ib : (a.slug.endsWith('/vf') ? 1 : -1);
  });

  return { title, subtitle, synopsis, thumbnail, seasons, genres, type, langs, similar };
}

async function getEpisodes(animeSlug, seasonSlug) {
  // Le fichier episodes.js contient: var eps1 = ['url1', 'url2', ...]
  const url = `/catalogue/${animeSlug}/${seasonSlug}/episodes.js`;
  const { data } = await http.get(url);

  const episodes = [];
  // Cherche toutes les variables eps1, eps2, etc. (un par lecteur)
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

  // eps1 est le lecteur principal — on construit la liste d'épisodes
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
  const { data } = await http.get('/');
  const $ = cheerio.load(data);

  // Carrousel hero (.ak-slide)
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

    // Extraire tous les boutons CTA (VOSTFR, VF)
    const ctas = [];
    slide.find('.ak-slide-cta').each((_, a) => {
      const href = $(a).attr('href') || '';
      const seasonSlug = href.replace(/^\/catalogue\/[^/]+\//, '').replace(/\/$/, '');
      const lang = seasonSlug.endsWith('/vf') ? 'VF' : 'VOSTFR';
      if (seasonSlug) ctas.push({ lang, season: seasonSlug });
    });

    if (title && slug) featured.push({ title, slug, thumbnail, synopsis, genres, badge, ctas });
  });

  // Sections du planning — collecte synchrone puis vérification VF async
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
      // Extrait le baseSlug depuis le href pour pouvoir vérifier la VF
      const afterSlug = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\/catalogue\/[^/]+\//, '').replace(/\/$/, '');
      const baseSlug = afterSlug.replace(/\/(vostfr|vf)$/, '');
      if (slug) rawCards.push({ title: title || slug, slug, thumbnail, lang, time, season, baseSlug });
    });
    rawSections.push({ title: sectionTitle, rawCards });
  });

  // Vérification VF en parallèle pour toutes les sections
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

  // Filtre les sections vides et trie par jour de la semaine
  const ordreJours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const sections = sectionsWithVf
    .filter(s => s.items.length > 0)
    .sort((a, b) => {
      const ia = ordreJours.findIndex(j => a.title.toLowerCase().includes(j));
      const ib = ordreJours.findIndex(j => b.title.toLowerCase().includes(j));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  // Dédoublonne le carrousel
  const seenFeatured = new Set();
  const uniqueFeatured = featured.filter(f => { if (seenFeatured.has(f.slug)) return false; seenFeatured.add(f.slug); return true; });

  // Derniers épisodes ajoutés
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
  langs.forEach(l => params.append('lang[]', l));
  genres.forEach(g => params.append('genre[]', g));

  const { data } = await http.get(`/catalogue/?${params.toString()}`);
  const $ = cheerio.load(data);

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
    if (title && slug) items.push({
      title, slug, thumbnail, subtitle,
      genres: infoRows['genres'] || '',
      type: infoRows['types'] || '',
      langs: infoRows['langues'] || '',
    });
  });

  // Filtre côté client pour langs et types (anime-sama filtre en OR, on force le AND)
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

  // Pagination
  const pages = [];
  $('#list_pagination a').each((_, el) => {
    const p = parseInt($(el).text().trim());
    if (p) pages.push(p);
  });
  const totalPages = pages.length ? Math.max(...pages) : 1;

  return { items: filtered, page, totalPages };
}

module.exports = { searchAnime, getAnimeDetails, getEpisodes, getHomePage, getCatalogue };
