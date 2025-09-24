export default function apiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.APP_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}
