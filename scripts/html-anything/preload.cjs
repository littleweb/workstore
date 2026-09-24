// WorkStore transport/lifecycle boundary. Does not change upstream UI, prompts or exports.
const http = require('node:http');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const port = Number(process.env.PORT);
const expectedHost = `127.0.0.1:${port}`;
const nonce = process.env.WORKSTORE_HTML_NONCE;
const children = new Set();
const spawn = cp.spawn;
cp.spawn = function(command, args, options = {}) {
  const env = { ...(options.env || process.env) }; delete env.WORKSTORE_HTML_NONCE;
  const child = spawn.call(this, command, args, { ...options, env, ...(process.platform !== 'win32' ? { detached: true } : {}) });
  children.add(child); child.once('close', () => children.delete(child));
  return child;
};
function stopChildren(signal = 'SIGTERM') {
  for (const child of children) {
    try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {}
  }
}
const createServer = http.createServer;
http.createServer = function(...args) {
  const index = args.findIndex(arg => typeof arg === 'function');
  if (index >= 0) {
    const handler = args[index];
    args[index] = function(req, res) {
      const pathname = (req.url || '/').split('?')[0];
      if (req.headers.host !== expectedHost || (pathname.startsWith('/api/') && req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) {
        res.writeHead(403); res.end('Request origin not allowed'); return;
      }
      if (pathname.startsWith('/__workstore/')) {
        const key = req.headers['x-workstore-runtime'];
        if (!nonce || typeof key !== 'string' || key.length !== nonce.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(nonce))) { res.writeHead(403); res.end(); return; }
        if (pathname === '/__workstore/health') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ready: true })); return; }
        if (pathname === '/__workstore/cancel' && req.method === 'POST') { stopChildren(); res.end('ok'); return; }
        res.writeHead(404); res.end(); return;
      }
      return handler.call(this, req, res);
    };
  }
  return createServer.apply(this, args);
};
const parent = Number(process.env.WORKSTORE_PARENT_PID);
if (parent > 0) setInterval(() => { try { process.kill(parent, 0); } catch { stopChildren(); process.exit(0); } }, 2000).unref();
// Next's own SIGTERM handler closes HTTP; also terminate every owned agent process group.
process.on('SIGTERM', () => stopChildren());
process.on('SIGINT', () => stopChildren());
process.on('exit', () => stopChildren('SIGKILL'));
