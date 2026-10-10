#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：npm run preview -- [--port 8010]\n仅在本机提供静态网页预览。');
  process.exit(0);
}
if (args.length && (args.length !== 2 || args[0] !== '--port')) {
  console.error('用法：npm run preview -- [--port 8010]');
  process.exit(1);
}
const port = args.length ? Number(args[1]) : 8010;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('端口必须是 1—65535 之间的整数。');
  process.exit(1);
}
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.md': 'text/markdown', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' };
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, file);
    const parts = relative.split(path.sep);
    if (relative.startsWith('..') || path.isAbsolute(relative) || parts.some(part => part.startsWith('.') || ['node_modules', 'scripts', 'tests'].includes(part))) {
      response.writeHead(404);
      response.end();
      return;
    }
    const data = await readFile(file);
    const extension = path.extname(file).toLowerCase();
    const type = types[extension] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('找不到该文件');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请使用 npm run preview -- --port ${port + 1}。` : error.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`Wiki 预览：http://127.0.0.1:${port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
