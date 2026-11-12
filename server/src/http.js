'use strict';

function send(res, code, data, headers = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function sendText(res, code, text, headers = {}) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

// UnityWebRequest with a WWWForm sends a form body, browsers and Godot send JSON.
function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const type = String(req.headers['content-type'] || '');
      if (type.startsWith('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(text)));
      }
      if (text.trim() === '') return resolve({});
      try {
        const data = JSON.parse(text);
        resolve(data && typeof data === 'object' && !Array.isArray(data) ? data : {});
      } catch {
        reject(Object.assign(new Error('invalid body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function bearerToken(req) {
  const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
  return m ? m[1] : '';
}

function ageConfirmed(body) {
  const v = body.age_confirmed;
  return v === true || v === 'true' || v === '1';
}

function defaultLog(message, data) {
  console.log(new Date().toISOString(), message, data ? JSON.stringify(data) : '');
}

module.exports = { send, sendText, readBody, bearerToken, ageConfirmed, defaultLog };
