'use strict';
/**
 * 平台适配器共用的 HTTP 与字段工具。
 * 统一走 source-manager.requestAsync，继承用户在设置里配置的代理。
 */
const { requestAsync } = require('../source-manager');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const DEFAULT_TIMEOUT = 12000;

function parseJsonText(text) {
  let s = String(text == null ? '' : text).trim();
  if (!s) throw new Error('上游返回空响应');
  if (s[0] !== '{' && s[0] !== '[') {
    const start = s.search(/[{\[]/);
    if (start > 0) s = s.slice(start);
  }
  // 容忍 JSONP 尾部：); 或 ;
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (end > 0 && end < s.length - 1) s = s.slice(0, end + 1);
  return JSON.parse(s);
}

async function getJson(url, { headers = {}, timeout = DEFAULT_TIMEOUT, mobile = false } = {}) {
  const r = await requestAsync(url, {
    timeout,
    headers: {
      'User-Agent': mobile ? MOBILE_UA : DESKTOP_UA,
      Accept: 'application/json, text/plain, */*',
      ...headers,
    },
  });
  if (r.statusCode >= 400) throw new Error(`上游返回 HTTP ${r.statusCode}`);
  if (r.body && typeof r.body === 'object') return r.body;
  return parseJsonText(r.body);
}

async function postJson(url, body, { headers = {}, timeout = DEFAULT_TIMEOUT, mobile = false } = {}) {
  const r = await requestAsync(url, {
    method: 'POST',
    timeout,
    headers: {
      'User-Agent': mobile ? MOBILE_UA : DESKTOP_UA,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (r.statusCode >= 400) throw new Error(`上游返回 HTTP ${r.statusCode}`);
  if (r.body && typeof r.body === 'object') return r.body;
  return parseJsonText(r.body);
}

// "4分29秒" / "3:45" / 225 → 毫秒
function toMs(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? (raw > 10000 ? raw : raw * 1000) : 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const cn = /(?:(\d+)\s*分)?\s*(?:(\d+)\s*秒)?/.exec(s);
  if (/分|秒/.test(s) && cn) {
    const m = Number(cn[1] || 0);
    const sec = Number(cn[2] || 0);
    if (m || sec) return (m * 60 + sec) * 1000;
  }
  const colon = /^(\d+):(\d+)$/.exec(s);
  if (colon) return (Number(colon[1]) * 60 + Number(colon[2])) * 1000;
  const n = Number(s);
  return Number.isFinite(n) ? (n > 10000 ? n : n * 1000) : 0;
}

module.exports = {
  DESKTOP_UA,
  MOBILE_UA,
  DEFAULT_TIMEOUT,
  parseJsonText,
  getJson,
  postJson,
  toMs,
};
