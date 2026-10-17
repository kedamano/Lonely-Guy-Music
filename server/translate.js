/**
 * 歌词译文兜底：网易云没返回 tlyric 时，按需调用「用户自带 key」的 OpenAI 兼容接口翻译。
 * - baseUrl / apiKey / model 只存在本机 userData/translate.json，key 永不出现在响应里；
 * - 结果按 歌曲id + 目标语言 + 原文 缓存到 userData/translate-cache.json，同一首歌只花一次钱；
 * - 未配置时返回 501，前端只提示不重试，绝不影响播放。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let CONFIG_PATH = '';
let CACHE_PATH = '';
let cache = null;

const LANG_NAMES = {
  zh: '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'français', de: 'Deutsch',
};

function init(dataDir) {
  CONFIG_PATH = path.join(dataDir, 'translate.json');
  CACHE_PATH = path.join(dataDir, 'translate-cache.json');
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch (_) { cache = {}; }
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}

function config() {
  const c = readJson(CONFIG_PATH, null);
  if (!c || !c.baseUrl || !c.apiKey || !c.model) return null;
  return c;
}

function saveConfig(c) {
  const prev = readJson(CONFIG_PATH, {});
  const clean = {
    baseUrl: String(c.baseUrl || '').trim(),
    // 界面层不回显密钥，留空即保持原值
    apiKey: String(c.apiKey || '').trim() || String(prev.apiKey || ''),
    model: String(c.model || '').trim(),
  };
  if (!/^https?:\/\//.test(clean.baseUrl)) throw new Error('服务地址需要以 http(s):// 开头');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2));
  return clean;
}

function keyOf(id, to, lines) {
  return crypto.createHash('sha1').update(`${id}|${to}|${lines.join('\n')}`).digest('hex').slice(0, 16);
}

function saveCache() {
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(cache)); } catch (_) { /* 缓存写失败不影响本次结果 */ }
}

async function callProvider(cfg, lines, to) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const lang = LANG_NAMES[to] || to;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你是歌词翻译器。只输出 JSON 字符串数组，长度与输入行数一致，不要解释、不要编号。译文要适合随歌词滚动阅读，尽量短。' },
        { role: 'user', content: `把下面每行歌词翻译成${lang}，按原顺序返回等长数组：\n${JSON.stringify(lines)}` },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`翻译服务返回 ${res.status}`);
  const j = await res.json();
  const text = String(j?.choices?.[0]?.message?.content || '');
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('翻译服务未返回可解析内容');
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr)) throw new Error('翻译结果不是数组');
  return lines.map((_, i) => (typeof arr[i] === 'string' ? arr[i].trim() : ''));
}

// POST /api/translate { id, lines, to }
async function translate(body) {
  const lines = Array.isArray(body.lines) ? body.lines.slice(0, 400) : [];
  const text = lines.map((l) => String(l || ''));
  if (!text.length) return { code: 400, msg: '没有待翻译的歌词' };
  const to = String(body.to || 'zh');
  const k = keyOf(body.id || '', to, text);
  if (cache[k]) return { code: 0, data: { lines: cache[k], from: 'cache' } };

  const cfg = config();
  if (!cfg) return { code: 501, msg: '未配置翻译服务（设置 → 歌词翻译）' };
  const out = await callProvider(cfg, text, to);
  cache[k] = out;
  saveCache();
  return { code: 0, data: { lines: out, from: 'ai' } };
}

function state() {
  const cfg = config();
  return { configured: !!cfg, model: cfg ? cfg.model : '', baseUrl: cfg ? cfg.baseUrl : '' };
}

module.exports = { init, translate, config, state, saveConfig, LANG_NAMES };
