// 实时频谱可视化：环形频谱 + 中心波形；无音频信号时显示呼吸式待机波形
export function createVisualizer(canvas, analyser) {
  const ctx = canvas.getContext('2d');
  let raf = 0, freq = null, timeData = null, running = false;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const nw = Math.floor(w * dpr), nh = Math.floor(h * dpr);
    if (canvas.width !== nw || canvas.height !== nh) {
      canvas.width = nw;
      canvas.height = nh;
    }
  }
  function accent() {
    const c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff6a2c';
    return c;
  }
  function frame(ts = 0) {
    raf = requestAnimationFrame(frame);
    resize();
    if (!freq) return;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;

    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(timeData);

    let energy = 0;
    for (let i = 0; i < freq.length; i++) energy += freq[i];
    energy = energy / freq.length / 255;
    const idle = energy < 0.008;
    const t = ts / 1000;

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const baseR = Math.min(w, h) * 0.255;
    const col = accent();

    // 环形频谱
    const bars = 72;
    const step = Math.max(1, Math.floor(freq.length / bars));
    for (let i = 0; i < bars; i++) {
      let v;
      if (idle) {
        v = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.34));
      } else {
        v = freq[i * step] / 255;
      }
      const ang = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const len = baseR * 0.92 + v * baseR * 1.1;
      const x1 = cx + Math.cos(ang) * baseR;
      const y1 = cy + Math.sin(ang) * baseR;
      const x2 = cx + Math.cos(ang) * len;
      const y2 = cy + Math.sin(ang) * len;
      ctx.strokeStyle = col;
      ctx.globalAlpha = idle ? 0.18 + v * 0.35 : 0.32 + v * 0.68;
      ctx.lineWidth = (Math.PI * 2 * baseR) / bars * 0.56;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 中心波形
    ctx.beginPath();
    const slice = w / timeData.length;
    for (let i = 0; i < timeData.length; i++) {
      const wave = idle
        ? Math.sin(t * 1.4 + i * 0.035) * 0.14 + Math.sin(t * 0.7 + i * 0.011) * 0.07
        : (timeData[i] - 128) / 128;
      const y = cy + wave * baseR * 0.52;
      const x = i * slice;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = col;
    ctx.globalAlpha = idle ? 0.24 : 0.5;
    ctx.lineWidth = 1.6 * dpr;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 中心光晕
    const avg = idle ? 0.1 + 0.04 * Math.sin(t * 1.2) : energy;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 0.95);
    grad.addColorStop(0, col);
    grad.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.08 + avg * 0.22;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR * (0.55 + avg * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  return {
    start() {
      if (running) return;
      running = true;
      resize();
      freq = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
      window.addEventListener('resize', resize);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
