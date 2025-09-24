import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import assetsRoutes from './routes/assets.routes.js';
import swaggerUi from 'swagger-ui-express';
import { loadOpenApi } from './docs.js';

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const openapi = loadOpenApi();
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
  swaggerOptions: { persistAuthorization: true },
  customSiteTitle: 'Secure Asset API — Docs'
}));

app.get('/health', (_,res)=>res.json({ ok:true, service:'secure-asset-api' }));
app.use('/api/v1', assetsRoutes);

app.listen(process.env.PORT || 3000, () =>
  console.log(`Secure Asset API running on :${process.env.PORT || 3000}`)
);
