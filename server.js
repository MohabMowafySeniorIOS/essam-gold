// دفتر الصائغ — سيرفر بسيط بدون أي مكتبات خارجية (Node.js فقط)
// يشغّل الواجهة من مجلد public/ ويحفظ البيانات في data.json على نفس الجهاز

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// مكان حفظ البيانات:
// - محليًا: جنب server.js زي ما هو
// - على الاستضافة (Railway وغيرها): حدد متغير البيئة DATA_DIR على مسار الـ Volume الدائم
//   مثال: DATA_DIR=/data  — كده البيانات مش هتتمسح مع كل ديبلوي
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// اتأكد إن مجلد البيانات موجود
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

// أول تشغيل بعد نقل المشروع لـ Volume: لو فيه data.json قديم جنب server.js
// وملفش نسخة في مجلد البيانات الجديد، ننقله تلقائيًا عشان مايضيعش
(function migrateLegacyData() {
  if (DATA_DIR === __dirname) return;
  const legacy = path.join(__dirname, 'data.json');
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(DATA_FILE)) {
      fs.copyFileSync(legacy, DATA_FILE);
      console.log('تم نقل data.json القديم إلى مجلد البيانات الدائم');
    }
  } catch (e) { console.error('تعذر نقل ملف البيانات القديم', e); }
})();

function readState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null; // لا يوجد ملف بيانات بعد — أول تشغيل
  }
}

function writeState(state) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  // كتابة آمنة: نكتب في ملف مؤقت ثم نستبدل الملف الأصلي، لتفادي تلف البيانات لو حصل قطع كهرباء أثناء الكتابة
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  // نسخة احتياطية للملف السابق قبل ما يتستبدل
  try { if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch (e) {}
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
  // تنزيل نسخة احتياطية كملف JSON
  if (req.url.startsWith('/api/backup')) {
    const raw = (() => { try { return fs.readFileSync(DATA_FILE, 'utf8'); } catch (e) { return '{}'; } })();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="goldshop-backup-' + stamp + '.json"',
      'Content-Length': Buffer.byteLength(raw),
    });
    res.end(raw);
    return;
  }

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
  console.log('  DATA_DIR = ' + DATA_DIR + (process.env.DATA_DIR ? '  (من متغير البيئة ✓)' : '  (افتراضي — على الاستضافة حدّد DATA_DIR على مسار Volume)'));
  console.log('==============================================');
});
