// src/docs.js
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export function loadOpenApi() {
  const p = path.join(process.cwd(), 'openapi.yaml'); // project root
  try {
    if (!fs.existsSync(p)) {
      console.warn(`[docs] openapi.yaml not found at ${p} — serving minimal spec.`);
      return {
        openapi: '3.1.0',
        info: { title: 'Secure Asset API', version: '1.0.0' },
        paths: {},
      };
    }
    const raw = fs.readFileSync(p, 'utf8');
    return YAML.parse(raw);
  } catch (err) {
    console.error('[docs] Failed to read/parse openapi.yaml:', err?.message || err);
    // serve a minimal spec so /docs still loads
    return {
      openapi: '3.1.0',
      info: { title: 'Secure Asset API (spec parse error)', version: '1.0.0' },
      paths: {},
    };
  }
}
