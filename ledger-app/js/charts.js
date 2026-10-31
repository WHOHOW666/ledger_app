// ===== 记账本 图表（原生 Canvas，无外部依赖，可离线） =====

function setup(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

function fmt(n) {
  return '¥' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// 环形饼图（分类分布）
export function drawDonut(canvas, data, cssSize = 220) {
  const ctx = setup(canvas, cssSize, cssSize);
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = cssSize / 2, cy = cssSize / 2;
  const r = cssSize / 2 - 6, inner = r * 0.62;

  if (total <= 0) {
    ctx.fillStyle = '#E5E9F0';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#94A3B8';
    ctx.font = '14px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('暂无支出', cx, cy);
    return;
  }

  let start = -Math.PI / 2;
  data.forEach(d => {
    const ang = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + ang);
    ctx.closePath();
    ctx.fillStyle = d.color || '#0EA5A4';
    ctx.fill();
    start += ang;
  });

  // 挖空中心
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // 中心文字
  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 20px -apple-system, system-ui, sans-serif';
  ctx.fillText(fmt(total), cx, cy - 8);
  ctx.fillStyle = '#64748B';
  ctx.font = '12px -apple-system, system-ui, sans-serif';
  ctx.fillText('本月支出', cx, cy + 14);
}

// 横向柱状图（支付方式分布）
export function drawHBar(canvas, data, cssW = 320, cssH = 0) {
  const rowH = 34, gap = 10;
  const h = cssH || Math.max(60, data.length * (rowH + gap));
  const ctx = setup(canvas, cssW, h);
  const max = Math.max(1, ...data.map(d => d.value));
  const labelW = 64, barX = labelW + 8, barMax = cssW - barX - 48;

  data.forEach((d, i) => {
    const y = i * (rowH + gap);
    ctx.fillStyle = '#334155';
    ctx.font = '13px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(d.label, 4, y + rowH / 2);

    // 轨道
    ctx.fillStyle = '#EEF2F7';
    roundRect(ctx, barX, y + 6, barMax, rowH - 12, 6); ctx.fill();
    // 数值条
    const w = Math.max(2, (d.value / max) * barMax);
    ctx.fillStyle = d.color || '#0EA5A4';
    roundRect(ctx, barX, y + 6, w, rowH - 12, 6); ctx.fill();
    // 金额
    ctx.fillStyle = '#0F172A';
    ctx.font = '600 12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(fmt(d.value), cssW - 4, y + rowH / 2);
  });
}

// 折线图（月度趋势）
export function drawLine(canvas, data, cssW = 320, cssH = 160) {
  const ctx = setup(canvas, cssW, cssH);
  if (!data.length) return;
  const padL = 38, padR = 10, padT = 14, padB = 24;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
  const max = Math.max(1, ...data.map(d => d.value));
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

  // y 轴网格
  ctx.strokeStyle = '#E5E9F0'; ctx.lineWidth = 1;
  ctx.fillStyle = '#94A3B8'; ctx.font = '10px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let g = 0; g <= 3; g++) {
    const y = padT + plotH - (g / 3) * plotH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
    ctx.fillText(Math.round((max / 3) * g).toString(), padL - 4, y);
  }

  // 折线
  ctx.strokeStyle = '#0EA5A4'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = padL + i * stepX;
    const y = padT + plotH - (d.value / max) * plotH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 数据点 + x 标签
  ctx.fillStyle = '#0EA5A4';
  data.forEach((d, i) => {
    const x = padL + i * stepX;
    const y = padT + plotH - (d.value / max) * plotH;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#64748B';
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lbl = d.ym.slice(2); // YY-MM
    ctx.fillText(lbl, x, cssH - padB + 6);
    ctx.fillStyle = '#0EA5A4';
  });
}

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
