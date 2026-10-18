'use strict';
/**
 * 容错 JSON 解析器：专治酷我 `search.kuwo.cn/r.s` 这类「伪 JSON」。
 *
 * 上游实际返回的并不是合法 JSON：对象键不带引号、字符串用单引号、
 * 允许尾逗号、转义里有 `\xNN`，还混着 `&apos;` 之类 HTML 实体。
 * 这里用递归下降手写解析，绝不 eval / new Function / vm 执行网络数据。
 *
 * 支持的宽松语法：
 *   - 单/双引号字符串，`\xNN` 与 `\uNNNN` 转义
 *   - 无引号对象键
 *   - 尾逗号
 *   - true/false/null/undefined/NaN/Infinity 字面量
 *   - JSONP 包装（callback({...})）与前后空白/分号
 *   - 字符串内 HTML 实体解码（&apos; &amp; &quot; 等）
 */

const { decodeEntities } = require('./song-utils');

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
  }

  error(msg) {
    return new SyntaxError(`loose-json: ${msg} @${this.i}`);
  }

  skipWs() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  parseValue() {
    this.skipWs();
    if (this.i >= this.s.length) throw this.error('输入意外结束');
    const ch = this.s[this.i];
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"' || ch === "'") return this.parseString();

    const rest = this.s.slice(this.i, this.i + 16);
    const lit = /^(true|false|null|undefined|NaN|-?Infinity)(?![A-Za-z0-9_$])/.exec(rest);
    if (lit) {
      this.i += lit[0].length;
      switch (lit[0]) {
        case 'true': return true;
        case 'false': return false;
        case 'undefined': return undefined;
        case 'NaN': return NaN;
        case '-Infinity': return -Infinity;
        case 'Infinity': return Infinity;
        default: return null;
      }
    }

    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i, this.i + 64));
    if (num) {
      this.i += num[0].length;
      const n = Number(num[0]);
      if (Number.isFinite(n)) return n;
    }

    return this.parseBare();
  }

  parseString() {
    const quote = this.s[this.i];
    this.i++;
    let out = '';
    while (this.i < this.s.length) {
      const ch = this.s[this.i++];
      if (ch === quote) return decodeEntities(out);
      if (ch !== '\\') { out += ch; continue; }
      if (this.i >= this.s.length) throw this.error('字符串转义未完成');
      const esc = this.s[this.i++];
      switch (esc) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case '0': out += '\0'; break;
        case 'x': {
          const hex = this.s.slice(this.i, this.i + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw this.error('非法 \\x 转义');
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 2;
          break;
        }
        case 'u': {
          let hex = this.s.slice(this.i, this.i + 4);
          let len = 4;
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            // 上游偶见 \u{1F600}
            const m = /^\{([0-9a-fA-F]{1,6})\}/.exec(this.s.slice(this.i));
            if (!m) throw this.error('非法 \\u 转义');
            hex = m[1];
            len = m[0].length;
          }
          try { out += String.fromCodePoint(parseInt(hex, 16)); } catch (_) { /* 非法码点丢弃 */ }
          this.i += len;
          break;
        }
        case '\n': break; // 行续接
        default: out += esc; // \' \" \\ \/ 等原样保留
      }
    }
    throw this.error('字符串未闭合');
  }

  /** 无引号键：读到空白或冒号为止 */
  parseKey() {
    this.skipWs();
    const ch = this.s[this.i];
    if (ch === '"' || ch === "'") return this.parseString();
    const start = this.i;
    while (this.i < this.s.length && !/[\s:]/.test(this.s[this.i])) this.i++;
    const key = this.s.slice(start, this.i).trim();
    if (!key) throw this.error('缺少对象键');
    return key;
  }

  /** 无引号值：读到 , } ] 为止（酷我少量字段是裸 token） */
  parseBare() {
    const start = this.i;
    while (this.i < this.s.length && !/[,}\]]/.test(this.s[this.i])) this.i++;
    const raw = this.s.slice(start, this.i).trim();
    if (!raw) throw this.error('缺少值');
    return decodeEntities(raw);
  }

  parseObject() {
    this.i++; // {
    const obj = {};
    for (;;) {
      this.skipWs();
      if (this.i >= this.s.length) throw this.error('对象未闭合');
      if (this.s[this.i] === '}') { this.i++; return obj; }
      const key = this.parseKey();
      this.skipWs();
      if (this.s[this.i] !== ':') throw this.error(`键 ${key} 后缺少冒号`);
      this.i++;
      obj[key] = this.parseValue();
      this.skipWs();
      if (this.s[this.i] === ',') { this.i++; continue; } // 允许尾逗号
      if (this.s[this.i] === '}') { this.i++; return obj; }
      throw this.error(`键 ${key} 后缺少 , 或 }`);
    }
  }

  parseArray() {
    this.i++; // [
    const arr = [];
    for (;;) {
      this.skipWs();
      if (this.i >= this.s.length) throw this.error('数组未闭合');
      if (this.s[this.i] === ']') { this.i++; return arr; }
      arr.push(this.parseValue());
      this.skipWs();
      if (this.s[this.i] === ',') { this.i++; continue; } // 允许尾逗号
      if (this.s[this.i] === ']') { this.i++; return arr; }
      throw this.error('数组元素后缺少 , 或 ]');
    }
  }
}

/** 从任意包装文本中定位根对象/数组的起点 */
function locateRoot(text) {
  const obj = text.indexOf('{');
  const arr = text.indexOf('[');
  if (obj === -1) return arr;
  if (arr === -1) return obj;
  return Math.min(obj, arr);
}

/**
 * @param {string|object} input 原始响应文本或已解析对象
 * @returns {any} 解析结果
 */
function parseLooseJson(input) {
  if (input && typeof input === 'object') return input;
  let text = String(input == null ? '' : input).replace(/^﻿/, '').trim();
  if (!text) throw new SyntaxError('loose-json: 空输入');

  const start = locateRoot(text);
  if (start === -1) throw new SyntaxError('loose-json: 找不到对象或数组起点');
  // 酷我少数接口返回不带外层花括号的对象：abslist:[...],total:'10'
  if (start > 0 && !/^\s*[{\[]/.test(text) && /^\s*[A-Za-z_$][\w$.-]*\s*:/.test(text)) {
    text = `{${text}}`;
  } else {
    text = text.slice(start);
  }

  const p = new Parser(text);
  const value = p.parseValue();
  p.skipWs();
  // 容忍 JSONP 收尾：); 或多余空白
  if (p.i < p.s.length && !/^[;)\s]*$/.test(p.s.slice(p.i))) {
    throw p.error('无法解析的尾部内容');
  }
  return value;
}

/** 解析失败返回 null，适合单平台适配器里「跳过该平台」的用法 */
function tryParseLooseJson(input) {
  try { return parseLooseJson(input); } catch (_) { return null; }
}

module.exports = { parseLooseJson, tryParseLooseJson };
