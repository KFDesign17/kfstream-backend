const express = require('express');
const { randomUUID } = require('crypto');
const { getAdmin } = require('../services/firebaseAdmin');

const router = express.Router();
const sessions = new Map(); // sessionId → { status, customToken?, createdAt }
const SESSION_TTL = 10 * 60 * 1000; // 10 min

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) sessions.delete(id);
  }
}, 60000);

// POST /api/tv-auth/create-session
router.post('/create-session', (req, res) => {
  const sessionId = randomUUID();
  sessions.set(sessionId, { status: 'pending', createdAt: Date.now() });
  res.json({ sessionId });
});

// GET /api/tv-auth/link?s=SESSION_ID
// Opened in phone browser after QR scan → redirects to mobile app deep link
router.get('/link', (req, res) => {
  const s = req.query.s;
  if (!s || !sessions.has(s)) {
    return res.status(410).send('<h2>Session expirée. Revenez sur la TV et scannez le nouveau QR code.</h2>');
  }
  res.redirect(`kfstream://connect-tv?s=${s}`);
});

// POST /api/tv-auth/authenticate
// Called by mobile app: { sessionId, idToken }
router.post('/authenticate', async (req, res) => {
  const { sessionId, idToken } = req.body;
  if (!sessionId || !idToken) return res.status(400).json({ error: 'sessionId and idToken required' });
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  try {
    const admin = getAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const customToken = await admin.auth().createCustomToken(decoded.uid);
    sessions.set(sessionId, { ...session, status: 'ready', customToken });
    res.json({ success: true });
  } catch (e) {
    console.error('TV auth error:', e.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// GET /api/tv-auth/poll/:sessionId
// Polled by TV every 2.5s
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
