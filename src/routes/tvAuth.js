const express = require('express');
const { randomUUID } = require('crypto');
const { getAdmin } = require('../services/firebaseAdmin');

const router = express.Router();
const sessions = new Map();   // sessionId → { status, shortCode, customToken?, createdAt }
const shortCodes = new Map(); // shortCode  → sessionId
const SESSION_TTL = 10 * 60 * 1000; // 10 min

function genShortCode() {
  let code;
  do { code = Math.floor(100000 + Math.random() * 900000).toString(); }
  while (shortCodes.has(code));
  return code;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) {
      if (s.shortCode) shortCodes.delete(s.shortCode);
      sessions.delete(id);
    }
  }
}, 60000);

// POST /api/tv-auth/create-session
router.post('/create-session', (req, res) => {
  const sessionId = randomUUID();
  const shortCode = genShortCode();
  sessions.set(sessionId, { status: 'pending', shortCode, createdAt: Date.now() });
  shortCodes.set(shortCode, sessionId);
  res.json({ sessionId, shortCode });
});

// GET /api/tv-auth/link?s=SESSION_ID
router.get('/link', (req, res) => {
  const s = req.query.s;
  if (!s || !sessions.has(s)) {
    return res.status(410).send('<h2>Session expirée. Revenez sur la TV et scannez le nouveau QR code.</h2>');
  }
  res.redirect(`kfstream://connect-tv?s=${s}`);
});

// POST /api/tv-auth/authenticate
// Called by mobile: { sessionId?, shortCode?, idToken }
router.post('/authenticate', async (req, res) => {
  const { sessionId, shortCode, idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });

  let id = sessionId;
  if (!id && shortCode) id = shortCodes.get(shortCode.toString().trim());
  if (!id) return res.status(400).json({ error: 'sessionId or shortCode required' });

  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  try {
    const admin = getAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const customToken = await admin.auth().createCustomToken(decoded.uid);
    if (session.shortCode) shortCodes.delete(session.shortCode);
    sessions.set(id, { ...session, status: 'ready', customToken });
    res.json({ success: true });
  } catch (e) {
    console.error('TV auth error:', e.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// GET /api/tv-auth/poll/:sessionId
router.get('/poll/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ status: 'expired' });
  if (session.status === 'ready') {
    const { customToken } = session;
    sessions.delete(req.params.sessionId);
    return res.json({ status: 'ready', customToken });
  }
  res.json({ status: 'pending' });
});

module.exports = router;
