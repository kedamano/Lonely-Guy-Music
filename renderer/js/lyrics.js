// LRC 歌词解析与逐行定位
export function parseLRC(text) {
  if (!text) return [];
  const lines = [];
  const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  text.split('\n').forEach((line) => {
    const tags = line.match(tagRe);
    if (!tags) return;
    const content = line.replace(tagRe, '').trim();
    if (!content) return;
    tags.forEach((tag) => {
      const p = tag.match(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
      const min = +p[1], sec = +p[2];
      const ms = p[3] ? +String(p[3]).padEnd(3, '0') : 0;
      lines.push({ time: min * 60 + sec + ms / 1000, text: content });
    });
  });
  lines.sort((a, b) => a.time - b.time);
  // 每行时长 = 下一行时间 - 本行时间（卡拉OK逐字高亮用）
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].duration = next ? Math.max(0.3, next.time - lines[i].time) : 4;
  }
  return lines;
}

// 网易云 tlyric 的时间轴常与原歌词不一一对应（译文行更少或整体偏移），
// 所以按"译文落在主行区间内"归并；对不上宁可留空，也不能串行。
export function attachTranslation(lines, tlyricText) {
  const tr = parseLRC(tlyricText);
  if (!lines || !lines.length || !tr.length) return lines;
  let ti = 0;
  lines.forEach((line, i) => {
    const next = lines[i + 1];
    const end = next ? next.time : Infinity;
    const buf = [];
    while (ti < tr.length && tr[ti].time < end) {
      if (tr[ti].time >= line.time - 0.5) buf.push(tr[ti].text);
      ti++;
    }
    if (buf.length) line.trans = buf.join(' ');
  });
  if (lines.every((l) => !l.trans) && tr.length === lines.length) {
    lines.forEach((l, i) => { l.trans = tr[i].text; });
  }
  return lines;
}

// 返回当前时间对应的歌词行索引（-1 表示还没开始）
export function activeLine(lines, time) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= time + 0.15) idx = i; else break;
  }
  return idx;
}
