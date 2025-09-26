// src/db/firebase.js
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

function loadServiceAccountFromFile() {
  const fileEnv = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  if (!fileEnv) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_FILE is not set.');
  }

  // Resolve relative paths against the project root
  const filePath = path.isAbsolute(fileEnv) ? fileEnv : path.join(process.cwd(), fileEnv);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Firebase service account file not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw);

  // In case someone put \\n in the file by mistake, normalize (harmless if not needed)
  if (typeof json.private_key === 'string') {
    json.private_key = json.private_key.replace(/\\n/g, '\n');
  }
  return json;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccountFromFile()),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

export const rtdb = admin.database();
