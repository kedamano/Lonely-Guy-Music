'use strict';
/**
 * 播放地址探测：只下载前 64KB，判断直链是否真的可播、是否是试听占位。
 *
 * 需要这一层的原因（实测）：
 *   - 酷我对原曲/VIP 曲会返回同一个 181,521 字节的 11 秒试听文件，HTTP 200 且 content-type 正常
 *   - QQ 可能返回 preview 片段；部分接口失效时返回 HTML/JSON 错误页
 *
 * 设计原则：解析函数全部是纯函数，可离线测试；网络失败时「放行」而不是误杀，
 * 因为探测失败可能只是超时/代理抖动，真正播放失败还可以走跨源兜底。
 */
const { requestAsync } = require('./source-manager');
const { DESKTOP_UA } = require('./platforms/http');

const PLACEHOLDER_BYTES = 181521; // 酷我试听占位文件
const PROBE_BYTES = 65536;
const PROBE_MAX_BYTES = 131072;
const MIN_BITRATE = 24000;
const MAX_BITRATE = 2000000;

const BAD_CONTENT_TYPES = /(text\/|application\/(json|xml|xhtml\+xml)|image\/|application\/javascript)/i;

/** 解析 `bytes 0-65535/123456` */
function parseContentRange(value) {
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(String(value || ''));
  if (!m) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    total: m[3] === '*' ? null : Number(m[3]),
  };
}

function bytes(buf, offset, len) {
  return buf && buf.length >= offset + len ? buf.toString('latin1', offset, offset + len) : '';
}

/** 从文件头识别音频格式；识别不出返回 null */
function sniffAudio(buffer) {
  if (!buffer || !buffer.length) return null;
  if (bytes(buffer, 0, 4) === 'fLaC') return 'flac';
  if (bytes(buffer, 0, 4) === 'OggS') return 'ogg';
  if (bytes(buffer, 0, 4) === 'RIFF' && bytes(buffer, 8, 4) === 'WAVE') return 'wav';
  if (bytes(buffer, 4, 4) === 'ftyp') return 'm4a';
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'mp3'; // ID3
  if (buffer[0] === 0xff && buffer.length > 1) {
    // ADTS AAC：sync 后 layer 位为 00
    if ((buffer[1] & 0xf6) === 0xf0) return 'aac';
    if ((buffer[1] & 0xe0) === 0xe0) return 'mp3';
  }
  return null;
}

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_RATES = [44100, 48000, 32000];
const MPEG2_RATES = [22050, 24000, 16000];
const MPEG25_RATES = [11025, 12000, 8000];

/** 解析 offset 处的 MP3 帧头；不是合法帧返回 null */
function parseMp3FrameHeader(buf, offset) {
  if (!buf || offset + 4 > buf.length) return null;
  if (buf[offset] !== 0xff) return null;
  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];
  if ((b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=保留
  const layerBits = (b1 >> 1) & 3; // 1=Layer III
  if (versionBits === 1 || layerBits === 0) return null;

  const bitrateIdx = (b2 >> 4) & 0xf;
  if (bitrateIdx === 0 || bitrateIdx === 15) return null;
  const srIdx = (b2 >> 2) & 3;
  if (srIdx === 3) return null;
  const padding = (b2 >> 1) & 1;

  const bitRate = (versionBits === 3 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIdx];
  const sampleRate = (versionBits === 3 ? MPEG1_RATES : versionBits === 2 ? MPEG2_RATES : MPEG25_RATES)[srIdx];
  const frameLength = Math.floor(((versionBits === 3 ? 144 : 72) * bitRate * 1000) / sampleRate) + padding;
  if (!bitRate || !sampleRate || frameLength < 24) return null;
  return { bitRate, sampleRate, frameLength };
}

/** 读取连续 3 帧；仅当三帧码率一致时视为 CBR，可信度更高 */
function mp3Probe(buffer) {
  if (!buffer || !buffer.length) return null;
  let start = 0;
  if (bytes(buffer, 0, 3) === 'ID3' && buffer.length >= 10) {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14)
      | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    start = Math.min(buffer.length, 10 + size);
  }
  const end = Math.min(buffer.length - 4, start + 65536);
  for (let i = start; i < end; i++) {
    if (buffer[i] !== 0xff) continue;
    const h1 = parseMp3FrameHeader(buffer, i);
    if (!h1) continue;
    const h2 = parseMp3FrameHeader(buffer, i + h1.frameLength);
    if (!h2) continue;
    const h3 = parseMp3FrameHeader(buffer, i + h1.frameLength + h2.frameLength);
    if (!h3) continue;
    const cbr = h2.bitRate === h1.bitRate && h3.bitRate === h1.bitRate;
    return { ...h1, cbr };
  }
  return null;
}

/** CBR MP3：总字节数 ≈ 码率 × 时长 */
function estimateMp3DurationMs(totalBytes, bitRateKbps) {
  if (!(totalBytes > 0) || !(bitRateKbps > 0)) return null;
  return Math.round((totalBytes * 8) / bitRateKbps);
}

/**
 * 校验探测结果。
 * @returns {{ok:boolean, reason?:string, format?:string|null, totalBytes?:number|null,
 *            bitRate?:number|null, estimatedDuration?:number|null, unknown?:boolean}}
 */
function validateProbe({
  statusCode = 200,
  headers = {},
  buffer = null,
  expectedDurationMs = 0,
  truncated = false,
} = {}) {
  const h = headers || {};
  const contentType = String(h['content-type'] || '').toLowerCase();
  const range = parseContentRange(h['content-range']);
  const lengthHeader = Number(h['content-length'] || 0) || 0;

  let totalBytes = range && range.total ? range.total : null;
  if (totalBytes == null) {
    // 206 的 content-length 只是分片长度；完整 200 才是文件大小
    if (statusCode !== 206 && lengthHeader > 0) totalBytes = lengthHeader;
    else if (!truncated && buffer && buffer.length) totalBytes = buffer.length;
  }
  const totalKnown = Number(totalBytes) > 0;

  if (statusCode >= 400) return { ok: false, reason: `HTTP ${statusCode}` };
  if (BAD_CONTENT_TYPES.test(contentType)) return { ok: false, reason: `不是音频（${contentType}）` };

  const format = sniffAudio(buffer);
  const knownAudioType = /^audio\//i.test(contentType) || /octet-stream/i.test(contentType);
  if (!format && !knownAudioType && contentType) {
    return { ok: false, reason: `无法识别的响应类型（${contentType}）` };
  }

  if (totalKnown && Number(totalBytes) === PLACEHOLDER_BYTES) {
    return { ok: false, format, totalBytes, reason: '命中酷我试听占位文件' };
  }

  const expected = Number(expectedDurationMs || 0);
  if (expected > 60000 && totalKnown && Number(totalBytes) <= 200000) {
    return { ok: false, format, totalBytes, reason: '文件过小，疑似试听片段' };
  }

  let bitRate = null;
  if (expected > 0 && totalKnown) {
    bitRate = Math.round((Number(totalBytes) * 8) / (expected / 1000));
    if (bitRate < MIN_BITRATE) {
      return { ok: false, format, totalBytes, bitRate, reason: `码率异常偏低（${bitRate}bps）` };
    }
    if (bitRate > MAX_BITRATE) {
      return { ok: false, format, totalBytes, bitRate, reason: `码率异常偏高（${bitRate}bps）` };
    }
  }

  let estimatedDuration = null;
  if (format === 'mp3' && totalKnown && buffer) {
    const info = mp3Probe(buffer);
    // 只有 CBR 才用「总字节 / 帧码率」估时长；VBR 首帧码率不代表平均码率
    if (info && info.cbr) {
      estimatedDuration = estimateMp3DurationMs(Number(totalBytes), info.bitRate);
      if (expected > 0 && estimatedDuration != null && Math.abs(estimatedDuration - expected) > 20000) {
        return {
          ok: false,
          format,
          totalBytes,
          bitRate,
          estimatedDuration,
          reason: 'MP3 实际时长与预期相差超过 20 秒',
        };
      }
    }
  }

  return {
    ok: true,
    format,
    totalBytes: totalKnown ? Number(totalBytes) : null,
    bitRate,
    estimatedDuration,
    unknown: !format || !totalKnown,
  };
}

/**
 * 探测远程音频。只读前 64KB。
 * 网络失败返回 ok:true + unknown，交给播放器实际播放时再暴露错误。
 */
async function probeAudio(url, { expectedDurationMs = 0, timeout = 4500 } = {}) {
  try {
    const r = await requestAsync(url, {
      timeout,
      maxBytes: PROBE_MAX_BYTES,
      redirectLimit: 3,
      headers: {
        Range: `bytes=0-${PROBE_BYTES - 1}`,
        'Accept-Encoding': 'identity',
        Accept: '*/*',
        'User-Agent': DESKTOP_UA,
      },
    });
    const v = validateProbe({
      statusCode: r.statusCode,
      headers: r.headers,
      buffer: r.raw,
      expectedDurationMs,
      truncated: !!r.truncated,
    });
    return { ...v, statusCode: r.statusCode, truncated: !!r.truncated };
  } catch (e) {
    return {
      ok: true,
      unknown: true,
      reason: 'probe-failed',
      error: String((e && e.message) || e || '未知错误'),
    };
  }
}

module.exports = {
  PLACEHOLDER_BYTES,
  PROBE_BYTES,
  PROBE_MAX_BYTES,
  parseContentRange,
  sniffAudio,
  parseMp3FrameHeader,
  mp3Probe,
  estimateMp3DurationMs,
  validateProbe,
  probeAudio,
};
