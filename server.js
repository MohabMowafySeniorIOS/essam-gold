// دفتر الصائغ — سيرفر بسيط بدون أي مكتبات خارجية (Node.js فقط)
// يشغّل الواجهة من مجلد public/ ويحفظ البيانات في data.json على نفس الجهاز

const http = require('http');
const https = require('https');
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

// جلب سعر الذهب من موقع آي صاغة (market.isagha.com) — السيرفر بيجيب الصفحة ويستخرج الأرقام،
// عشان المتصفح مايقدرش يعمل fetch مباشر لموقع خارجي (قيود CORS).
// ملحوظة: ده استخراج من نص الصفحة، فلو الموقع غيّر شكله ممكن يتعطل — عشان كده بنتحقق إن الأرقام
// في نطاق منطقي لسعر الذهب قبل ما نرجّعها، وبنرجّع خطأ واضح بدل رقم غلط لو حصل أي شك.
function fetchIsaghaPrices() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://market.isagha.com/prices', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'ar,en;q=0.8',
      },
      timeout: 10000,
    }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        https.get(r.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => collectBody(r2, resolve, reject));
        return;
      }
      collectBody(r, resolve, reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });

  function collectBody(r, resolve, reject) {
    let data = '';
    r.setEncoding('utf8');
    r.on('data', (c) => { data += c; if (data.length > 3 * 1024 * 1024) { r.destroy(); reject(new Error('too large')); } });
    r.on('end', () => {
      try {
        const karats = [24, 22, 21, 18];
        const out = {};
        karats.forEach((k) => {
          const re = new RegExp('عيار\\s*' + k + '[\\s\\S]{0,250}?شراء[\\s\\S]{0,80}?([\\d]+(?:\\.[\\d]+)?)[\\s\\S]{0,120}?بيع[\\s\\S]{0,80}?([\\d]+(?:\\.[\\d]+)?)', 'i');
          const m = data.match(re);
          if (m) {
            const buy = parseFloat(m[1]);
            const sell = parseFloat(m[2]);
            // فحص منطقي: سعر الذهب للجرام المفروض يكون في مدى معقول
            if (buy > 500 && buy < 30000 && sell > 500 && sell < 30000 && sell >= buy) {
              out[k] = { buy, sell };
            }
          }
        });
        if (Object.keys(out).length === 0) {
          reject(new Error('تعذر استخراج الأسعار من الصفحة — شكل الموقع ممكن يكون اتغيّر'));
          return;
        }
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });
    r.on('error', reject);
  }
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

  if (req.url.startsWith('/api/gold-price-live')) {
    fetchIsaghaPrices()
      .then((prices) => sendJSON(res, 200, { ok: true, prices, source: 'isagha.com', fetchedAt: new Date().toISOString() }))
      .catch((e) => sendJSON(res, 502, { ok: false, error: 'تعذر جلب السعر من آي صاغة: ' + (e && e.message ? e.message : 'خطأ غير معروف') }));
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
          // حماية من تضارب الحفظ بين أكتر من تاب/جهاز: كل حفظة بتاخد رقم إصدار (_rev) بيزيد بواحد.
          // لو اللي جاي من العميل مبني على إصدار قديم (حد تاني حفظ بعده)، نرفض الكتابة بدل ما نمسح تعديلات التاني.
          const current = readState();
          const currentRev = current && typeof current._rev === 'number' ? current._rev : 0;
          const incomingRev = typeof parsed._rev === 'number' ? parsed._rev : 0;
          if (current && incomingRev !== currentRev) {
            sendJSON(res, 409, { ok: false, error: 'conflict', serverRev: currentRev });
            return;
          }
          parsed._rev = currentRev + 1;
          writeState(parsed);
          sendJSON(res, 200, { ok: true, rev: parsed._rev });
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
