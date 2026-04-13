export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}

export function methodNotAllowed(res, allowed = ['GET']) {
  res.setHeader('Allow', allowed.join(', '));
  return json(res, 405, { error: `Method not allowed. Use ${allowed.join(', ')}` });
}

export function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
