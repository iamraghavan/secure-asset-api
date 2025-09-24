import { Router } from 'express';
import multer from 'multer';
import apiKey from '../middleware/apiKey.js';
import { registerExisting, uploadGithubRegister, listRecent, resolveBySlug } from '../controllers/assets.controller.js';

const upload = multer({ dest: 'uploads/' });
const r = Router();

r.use(apiKey);

// Register Existing (Create Asset from URL/path)
r.post('/assets/register', registerExisting);

// Upload to GitHub + Register
r.post('/assets/github', upload.single('file'), uploadGithubRegister);

// Recent Assets
r.get('/assets/recent', listRecent);

// Resolve by slug (handy for frontend)
r.get('/assets/:slug', resolveBySlug);

export default r;
