import { Router } from 'express';
import multer from 'multer';
import apiKey from '../middleware/apiKey.js';
import { registerExisting, uploadGithubRegister, listRecent, resolveBySlug, deleteGithubAsset,listAllAssets } from '../controllers/assets.controller.js';

const upload = multer({ dest: 'uploads/' });
const r = Router();

r.use(apiKey);

r.post('/assets/register', registerExisting);
r.post('/assets/github', upload.single('file'), uploadGithubRegister);
r.get('/assets/recent', listRecent);
r.get('/assets/:slug', resolveBySlug);
r.delete('/assets/github', deleteGithubAsset);
r.get('/assets', listAllAssets);


export default r;
