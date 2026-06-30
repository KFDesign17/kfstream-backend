const admin = require('firebase-admin');

let initialized = false;

function getAdmin() {
  if (!initialized) {
    const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!key) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
    initialized = true;
  }
  return admin;
}

module.exports = { getAdmin };
