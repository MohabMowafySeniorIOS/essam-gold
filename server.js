// دفتر الصائغ — سيرفر بسيط بدون أي مكتبات خارجية (Node.js فقط)
// يشغّل الواجهة من مجلد public/ ويحفظ البيانات في data.json على نفس الجهاز

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function readState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null; // لا يوجد ملف بيانات بعد — أول تشغيل
  }
}

function writeState(state) {
  // كتابة آمنة: نكتب في ملف مؤقت ثم نستبدل الملف الأصلي، لتفادي تلف البيانات لو حصل قطع كهرباء أثناء الكتابة
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, DATA_FILE);
}

function sendJSON(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(urlPath)));

  // منع الخروج خارج مجلد public (حماية بسيطة)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('الصفحة غير موجودة');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/state')) {
    if (req.method === 'GET') {
      const state = readState();
      sendJSON(res, 200, { state });
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 25 * 1024 * 1024) { // حد أقصى 25 ميجا للحماية
          tooLarge = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        try {
          const parsed = JSON.parse(body);
          writeState(parsed);
          sendJSON(res, 200, { ok: true });
        } catch (e) {
          sendJSON(res, 400, { ok: false, error: 'بيانات غير صالحة' });
        }
      });
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  دفتر الصائغ — إدارة حسابات محل الذهب');
  console.log('  السيرفر شغال على: http://localhost:' + PORT);
  console.log('  البيانات بتتحفظ في: ' + DATA_FILE);
  console.log('==============================================');
});
