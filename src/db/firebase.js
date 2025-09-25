// src/db/firebase.js
import admin from 'firebase-admin';
import fs from 'fs';

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON', e);
      throw e;
    }
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    const raw = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8');
    return JSON.parse(raw);
  }
  throw new Error('Service account not provided. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_FILE.');
}

if (!admin.apps.length) {
  const cred = admin.credential.cert(loadServiceAccount());
  admin.initializeApp({
    credential: cred,
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

export const rtdb = admin.database();
