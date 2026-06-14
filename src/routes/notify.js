const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const ADMIN_EMAIL = 'dj.kwayne@gmail.com';
const SENDER = `KFStream <${process.env.GMAIL_USER}>`;

// POST /api/notify/email
// body: { type: 'new_account' | 'approved' | 'blocked' | 'unblocked', userEmail, userName }
router.post('/email', async (req, res) => {
  const { type, userEmail, userName } = req.body;
  if (!type || !userEmail) return res.status(400).json({ error: 'type and userEmail required' });

  let to, subject, html;
  const name = userName || userEmail;

  if (type === 'new_account') {
    to = process.env.GMAIL_USER;
    subject = `🔔 Nouveau compte en attente — KFStream`;
    html = `
      <div style="font-family:sans-serif;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:12px;max-width:480px">
        <h2 style="color:#3b82f6;margin-top:0">Nouvelle demande d'accès</h2>
        <p><b>${name}</b> (<code style="color:#94a3b8">${userEmail}</code>) vient de créer un compte et attend ton approbation.</p>
        <p style="color:#64748b;font-size:13px">Rends-toi dans la gestion des comptes sur KFStream pour approuver ou refuser.</p>
      </div>`;
  } else if (type === 'approved') {
    to = userEmail;
    subject = `✅ Ton compte KFStream a été approuvé`;
    html = `
      <div style="font-family:sans-serif;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:12px;max-width:480px">
        <h2 style="color:#22c55e;margin-top:0">Accès approuvé !</h2>
        <p>Bonjour <b>${name}</b>,</p>
        <p>Ton compte KFStream a été approuvé. Tu peux maintenant accéder à la plateforme.</p>
        <p style="color:#64748b;font-size:13px">Ouvre l'application ou le site et connecte-toi.</p>
      </div>`;
  } else if (type === 'blocked') {
    to = userEmail;
    subject = `🚫 Ton compte KFStream a été bloqué`;
    html = `
      <div style="font-family:sans-serif;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:12px;max-width:480px">
        <h2 style="color:#ef4444;margin-top:0">Compte bloqué</h2>
        <p>Bonjour <b>${name}</b>,</p>
        <p>Ton accès à KFStream a été suspendu par l'administrateur.</p>
      </div>`;
  } else if (type === 'unblocked') {
    to = userEmail;
    subject = `🔓 Ton compte KFStream a été débloqué`;
    html = `
      <div style="font-family:sans-serif;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:12px;max-width:480px">
        <h2 style="color:#3b82f6;margin-top:0">Compte débloqué</h2>
        <p>Bonjour <b>${name}</b>,</p>
        <p>Ton accès à KFStream a été rétabli. Tu peux de nouveau utiliser la plateforme.</p>
      </div>`;
  } else {
    return res.status(400).json({ error: 'unknown type' });
  }

  try {
    await transporter.sendMail({ from: SENDER, to, subject, html });
    res.json({ ok: true });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
