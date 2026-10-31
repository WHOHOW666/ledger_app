// ===== 记账本 主程序 =====
import {
  SOURCES, CATEGORIES, SOURCE_COLORS,
  loadTransactions, saveTransactions, loadBudgets, saveBudgets, loadSettings, saveSettings,
  genId, monthKey, todayStr, txOfMonth, sumExpense, sumIncome,
  categoryBreakdown, sourceBreakdown, monthlyTrend,
  findDuplicates, mergeDuplicate, smartAdd
} from './storage.js';
import { drawDonut, drawHBar, drawLine } from './charts.js';
import { parseText, parseMessage, guessCategory, extractAmount } from './parse.js';

const CAT_EMOJI = { 餐饮: '🍜', 购物: '🛍️', 交通: '🚕', 居住: '🏠', 娱乐: '🎬', 医疗: '💊', 教育: '📚', 人情: '🎁', 数码: '📱', 其他: '🧾' };
const CHANNELS = ['微信', '支付宝', '刷卡', '现金', '其他'];

const state = {
  view: 'add',
  ym: currentYM(),
  tx: loadTransactions(),
  budgets: loadBudgets(),
  settings: loadSettings(),
  form: { type: 'expense', category: '餐饮', source: '微信', date: todayStr() }
};

function currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function prevYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function nextYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function ymLabel(ym) {
  const [y, m] = ym.split('-');
  return y + ' 年 ' + Number(m) + ' 月';
}
function money(n) {
  return '¥' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneyShort(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return '¥' + (v / 10000).toFixed(1) + '万';
  return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

// ---------- 通用 UI ----------
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '<div class="modal-mask"><div class="modal">' + html + '</div></div>';
  root.querySelector('.modal-mask').addEventListener('click', e => {
    if (e.target.classList.contains('modal-mask')) closeModal();
  });
  return root;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

// ---------- 预算状态 ----------
function budgetStatus(ym) {
  const list = txOfMonth(state.tx, ym);
  const spent = sumExpense(list);
  const limit = Number(state.budgets.monthlyTotal) || 0;
  const ratio = limit > 0 ? spent / limit : 0;
  const over = limit > 0 && spent > limit;
  const warn = limit > 0 && ratio >= 0.8 && !over;
  return { spent, limit, ratio, over, warn };
}

function checkBudgetAndAlert(ym) {
  const s = budgetStatus(ym);
  if (s.over) {
    notify('⚠️ 超出本月预算', '本月已花 ' + money(s.spent) + '，超过限额 ' + money(s.limit));
    toast('⚠️ 已超出本月预算 ' + money(s.spent - s.limit));
    vibrate([80, 40, 80]);
  } else if (s.warn) {
    toast('提醒：本月已用 ' + Math.round(s.ratio * 100) + '% 预算');
  }
}

function vibrate(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
}

// ---------- 通知 ----------
function notify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: 'assets/icon-180.png', badge: 'assets/icon-180.png' });
    } catch (e) {
      // iOS 某些情况下需要 ServiceWorkerRegistration.showNotification
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body, icon: 'assets/icon-180.png' }));
      }
    }
  }
}

async function requestNotify() {
  if (!('Notification' in window)) { toast('当前环境不支持通知'); return; }
  if (Notification.permission === 'granted') { toast('通知已开启'); return; }
  if (Notification.permission === 'denied') { toast('通知被拒绝，请在系统设置中允许'); return; }
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') toast('通知已开启 ✓');
    else toast('未开启通知');
  } catch (e) { toast('开启失败'); }
}

// ---------- 渲染入口 ----------
function render() {
  const c = document.getElementById('view-container');
  const title = document.getElementById('topbar-title');
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === state.view);
  });
  if (state.view === 'add') { title.textContent = '记一笔'; c.innerHTML = viewAdd(); bindAdd(); }
  else if (state.view === 'stats') { title.textContent = '统计'; c.innerHTML = viewStats(); bindStats(); drawStatsCharts(); }
  else if (state.view === 'budget') { title.textContent = '预算与提醒'; c.innerHTML = viewBudget(); bindBudget(); }
  else if (state.view === 'mine') { title.textContent = '我的'; c.innerHTML = viewMine(); bindMine(); }
  c.scrollTop = 0;
}

// ================= 记账页 =================
function viewAdd() {
  const catChips = CATEGORIES.map(c =>
    '<button class="chip ' + (state.form.category === c ? 'active' : '') + '" data-cat="' + c + '">' +
    (CAT_EMOJI[c] || '') + ' ' + c + '</button>'
  ).join('');

  const srcChips = SOURCES.map(s =>
    '<button class="chip ' + (state.form.source === s ? 'active' : '') + '" data-src="' + s + '">' +
    '<span class="dot" style="background:' + SOURCE_COLORS[s] + '"></span>' + s + '</button>'
  ).join('');

  const recent = state.tx.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  return `
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
      <div>
        <div style="font-weight:700;font-size:14px">想更省事？</div>
        <div style="font-size:12px;color:#94A3B8;margin-top:2px">粘贴短信/支付通知，自动识别金额</div>
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-smart">📋 智能识别</button>
    </div>

    <div class="card">
      <div class="field">
        <div class="chips" id="type-toggle" style="margin-bottom:4px">
          <button class="chip ${state.form.type === 'expense' ? 'active' : ''}" data-type="expense">支出</button>
          <button class="chip ${state.form.type === 'income' ? 'active' : ''}" data-type="income">收入</button>
        </div>
      </div>
      <div class="field">
        <label>金额</label>
        <div class="amount-input">
          <span class="cur">¥</span>
          <input id="in-amount" class="input" type="number" inputmode="decimal" step="0.01" placeholder="0.00" />
        </div>
      </div>
      <div class="field">
        <label>花在哪了 / 内容</label>
        <input id="in-content" class="input" type="text" placeholder="例如：午饭、超市采购、打车" />
      </div>
      <div class="field">
        <label>分类</label>
        <div class="chips" id="cat-chips">${catChips}</div>
      </div>
      <div class="field">
        <label>资金来源（钱从哪扣的）</label>
        <div class="chips" id="src-chips">${srcChips}</div>
        <div class="hint">💡 用微信/支付宝付款、但实际扣的是银行卡时，<b>这里选那张银行卡</b>，只记这一笔，就不会重复记账了。</div>
      </div>
      <div class="field">
        <label>支付渠道（可选，仅备注）</label>
        <select id="in-channel" class="input">
          <option value="">—</option>
          ${CHANNELS.map(c => '<option value="' + c + '">' + c + '</option>').join('')}
        </select>
      </div>
      <div class="field">
        <label>日期</label>
        <input id="in-date" class="input" type="date" value="${state.form.date}" />
      </div>
      <div class="field">
        <label>备注（可选）</label>
        <input id="in-note" class="input" type="text" placeholder="补充说明" />
      </div>
      <button class="btn btn-primary" id="btn-save">保存</button>
    </div>

    <div class="card">
      <p class="card-title">最近记录</p>
      ${recent.length ? '<ul class="tx-list">' + recent.map(txItemHTML).join('') + '</ul>' : '<div class="empty">还没有记录，记下第一笔吧</div>'}
    </div>
  `;
}

function txItemHTML(t) {
  const color = SOURCE_COLORS[t.source] || '#888';
  const isIncome = t.type === 'income';
  const emoji = isIncome ? '💰' : (CAT_EMOJI[t.category] || '🧾');
  const ch = t.channel ? ' · ' + t.channel : '';
  return `<li class="tx-item" data-id="${t.id}">
    <div class="tx-ico">${emoji}</div>
    <div class="tx-main">
      <div class="tx-content">${escapeHtml(t.content || '未命名')}</div>
      <div class="tx-meta">
        <span class="src-tag" style="background:${color}">${t.source}</span>
        ${t.category || ''}${ch} · ${t.date}
      </div>
    </div>
    <div class="tx-amt ${isIncome ? 'income' : ''}">${isIncome ? '+' : '-'}${money(t.amount)}</div>
  </li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function bindAdd() {
  const c = document.getElementById('view-container');
  const toggle = (groupSel, target, attr, val) => {
    c.querySelectorAll(groupSel + ' .chip').forEach(x => x.classList.toggle('active', x === target));
    state.form[attr] = val;
  };
  c.querySelectorAll('#type-toggle .chip').forEach(b => {
    b.onclick = () => toggle('#type-toggle', b, 'type', b.dataset.type);
  });
  c.querySelectorAll('#cat-chips .chip').forEach(b => {
    b.onclick = () => toggle('#cat-chips', b, 'category', b.dataset.cat);
  });
  c.querySelectorAll('#src-chips .chip').forEach(b => {
    b.onclick = () => toggle('#src-chips', b, 'source', b.dataset.src);
  });
  c.querySelectorAll('.tx-item').forEach(li => {
    li.onclick = () => openTxDetail(li.dataset.id);
  });
  const sb = document.getElementById('btn-smart');
  if (sb) sb.onclick = openSmartParse;
  document.getElementById('btn-save').onclick = saveTransaction;
}

// ---------- 智能识别 ----------
function openSmartParse() {
  const root = openModal(`
    <h3>智能识别</h3>
    <p style="font-size:13px;color:#64748B;line-height:1.6;margin:0 0 10px">
      把银行短信、微信/支付宝的支付通知复制粘贴进来，可一次多笔。系统会自动识别金额、商户、来源和分类。
    </p>
    <textarea id="parse-input" class="input" rows="5" placeholder="例如：\n【中国银行】您尾号1234的储蓄卡消费人民币45.00元\n微信支付：商户「美团」付款成功 ¥32.50"></textarea>
    <div class="actions" style="display:flex;gap:10px;margin-top:10px">
      <button class="btn btn-ghost btn-sm" id="btn-clip" style="flex:1">读取剪贴板</button>
      <button class="btn btn-primary btn-sm" id="btn-parse" style="flex:1">识别</button>
    </div>
    <div id="parse-result" style="margin-top:14px"></div>
    <div class="actions">
      <button class="btn btn-ghost" id="p-cancel">关闭</button>
    </div>
  `);
  const ta = root.querySelector('#parse-input');
  const res = root.querySelector('#parse-result');

  root.querySelector('#btn-clip').onclick = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) { ta.value = txt; toast('已读取剪贴板'); }
      else toast('剪贴板为空');
    } catch (e) {
      ta.focus();
      toast('请长按输入框粘贴');
    }
  };

  let parsed = [];
  root.querySelector('#btn-parse').onclick = () => {
    parsed = parseText(ta.value);
    if (!parsed.length) { res.innerHTML = '<div class="empty">没识别到有效金额，请检查文本</div>'; return; }
    res.innerHTML = parsed.map((t, i) => `
      <div class="dup-item" style="border-color:#CFE8E6;background:#F5FBFA">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" class="p-check" data-i="${i}" checked style="width:18px;height:18px" />
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${escapeHtml(t.content)}</div>
            <div style="font-size:12px;color:#64748B;margin-top:2px">
              <span class="src-tag" style="background:${SOURCE_COLORS[t.source] || '#888'}">${t.source}</span>
              ${t.category} · ${t.date}${t.channel ? ' · ' + t.channel : ''}
            </div>
          </div>
          <div style="font-weight:800;font-size:15px;color:${t.type === 'income' ? '#16A34A' : '#0F172A'}">
            ${t.type === 'income' ? '+' : '-'}${money(t.amount)}
          </div>
        </label>
      </div>
    `).join('') + '<button class="btn btn-primary" id="btn-confirm-parse" style="margin-top:6px">确认记入</button>';

    root.querySelector('#btn-confirm-parse').onclick = () => {
      let added = 0, merged = 0;
      root.querySelectorAll('.p-check').forEach(chk => {
        if (!chk.checked) return;
        const tx = normalizeTx(parsed[Number(chk.dataset.i)]);
        const r = smartAdd(state.tx, tx);
        r.added ? added++ : merged++;
      });
      saveTransactions(state.tx);
      closeModal();
      toast('已记入 ' + added + ' 笔' + (merged ? '，去重合并 ' + merged + ' 笔' : ''));
      render();
      checkBudgetAndAlert(currentYM());
    };
  };

  root.querySelector('#p-cancel').onclick = closeModal;
}

function saveTransaction() {
  const amount = parseFloat(document.getElementById('in-amount').value);
  const content = document.getElementById('in-content').value.trim();
  const date = document.getElementById('in-date').value || todayStr();
  const channel = document.getElementById('in-channel').value;
  const note = document.getElementById('in-note').value.trim();

  if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
  if (!content) { toast('请输入消费内容'); return; }

  const tx = {
    id: genId(),
    type: state.form.type,
    amount: Math.round(amount * 100) / 100,
    content,
    category: state.form.category,
    source: state.form.source,
    channel: channel || '',
    date,
    note,
    createdAt: Date.now()
  };
  const r = smartAdd(state.tx, tx);
  saveTransactions(state.tx);
  toast(r.merged ? '已自动去重合并 ✓' : '已记录 ✓');

  // 重置表单（保留日期与来源，方便连续记）
  state.form.date = date;
  document.getElementById('in-amount').value = '';
  document.getElementById('in-content').value = '';
  document.getElementById('in-note').value = '';

  render();
  checkBudgetAndAlert(monthKey(date));
}

function openTxDetail(id) {
  const t = state.tx.find(x => x.id === id);
  if (!t) return;
  const html = `
    <h3>${escapeHtml(t.content)}</h3>
    <div class="setting-row"><span>金额</span><span class="val" style="font-weight:700;color:#0F172A">${t.type === 'income' ? '+' : '-'}${money(t.amount)}</span></div>
    <div class="setting-row"><span>类型</span><span class="val">${t.type === 'income' ? '收入' : '支出'}</span></div>
    <div class="setting-row"><span>分类</span><span class="val">${t.category || '-'}</span></div>
    <div class="setting-row"><span>资金来源</span><span class="val">${t.source}</span></div>
    <div class="setting-row"><span>支付渠道</span><span class="val">${t.channel || '-'}</span></div>
    <div class="setting-row"><span>日期</span><span class="val">${t.date}</span></div>
    ${t.note ? '<div class="setting-row"><span>备注</span><span class="val">' + escapeHtml(t.note) + '</span></div>' : ''}
    <div class="actions">
      <button class="btn btn-ghost" id="m-close">关闭</button>
      <button class="btn btn-danger" id="m-del">删除</button>
    </div>`;
  const root = openModal(html);
  root.querySelector('#m-close').onclick = closeModal;
  root.querySelector('#m-del').onclick = () => {
    state.tx = state.tx.filter(x => x.id !== id);
    saveTransactions(state.tx);
    closeModal();
    toast('已删除');
    render();
  };
}

// ================= 统计页 =================
function viewStats() {
  const list = txOfMonth(state.tx, state.ym);
  const spent = sumExpense(list);
  const income = sumIncome(list);
  const expenseCount = list.filter(t => t.type !== 'income').length;
  const daysInMonth = new Date(Number(state.ym.split('-')[0]), Number(state.ym.split('-')[1]), 0).getDate();
  const avg = spent / daysInMonth;
  const cats = categoryBreakdown(list);
  const srcs = sourceBreakdown(list);
  const st = budgetStatus(state.ym);

  let banner = '';
  if (st.over) {
    banner = `<div class="alert-banner"><span class="em">⚠️</span><div>已超本月预算 ${money(st.spent - st.limit)}，本月共花 ${money(st.spent)}。</div></div>`;
  } else if (st.warn) {
    banner = `<div class="alert-banner warn"><span class="em">🔔</span><div>本月已用掉 ${Math.round(st.ratio * 100)}% 预算，注意控制。</div></div>`;
  }

  const legend = cats.map(c => {
    const color = catColor(c.label);
    return `<div class="legend-item"><span class="sw" style="background:${color}"></span>${c.label} ${Math.round(c.value / (spent || 1) * 100)}%</div>`;
  }).join('');

  return `
    <div class="month-bar">
      <button id="prev-m">‹</button>
      <div class="m-label">${ymLabel(state.ym)}</div>
      <button id="next-m">›</button>
    </div>
    ${banner}
    <div class="summary">
      <div class="lbl">本月支出</div>
      <div class="big">${money(spent)}</div>
      <div class="sub">
        <span>收入 <b>${money(income)}</b></span>
        <span>${expenseCount} 笔</span>
        <span>日均 <b>${money(avg)}</b></span>
      </div>
    </div>

    <div class="card">
      <p class="card-title">支出分布（按分类）</p>
      ${cats.length ? `<div style="display:flex;flex-direction:column;align-items:center">
        <canvas id="donut"></canvas>
        <div class="legend" style="justify-content:center">${legend}</div>
      </div>` : '<div class="empty"><span class="big-emoji">📊</span>本月还没有支出记录</div>'}
    </div>

    <div class="card">
      <p class="card-title">按支付方式</p>
      ${srcs.length ? `<canvas id="hbar"></canvas>` : '<div class="empty">暂无数据</div>'}
    </div>

    <div class="card">
      <p class="card-title">近 6 个月趋势</p>
      <canvas id="line"></canvas>
    </div>
  `;
}

function catColor(label) {
  const palette = ['#0EA5A4', '#F59E0B', '#6366F1', '#EC4899', '#10B981', '#3B82F6', '#F97316', '#8B5CF6', '#EF4444', '#64748B'];
  const idx = CATEGORIES.indexOf(label);
  return palette[(idx >= 0 ? idx : 9) % palette.length];
}

function bindStats() {
  document.getElementById('prev-m').onclick = () => { state.ym = prevYM(state.ym); render(); };
  document.getElementById('next-m').onclick = () => { state.ym = nextYM(state.ym); render(); };
}

function drawStatsCharts() {
  const list = txOfMonth(state.tx, state.ym);
  const cats = categoryBreakdown(list).map(c => ({ ...c, color: catColor(c.label) }));
  const srcs = sourceBreakdown(list);
  const donut = document.getElementById('donut');
  if (donut) drawDonut(donut, cats, 220);
  const hbar = document.getElementById('hbar');
  if (hbar) {
    const w = Math.min(440, document.getElementById('view-container').clientWidth - 64);
    drawHBar(hbar, srcs, w);
  }
  const line = document.getElementById('line');
  if (line) {
    const w = Math.min(440, document.getElementById('view-container').clientWidth - 64);
    drawLine(line, monthlyTrend(state.tx, 6), w, 160);
  }
}

// ================= 预算页 =================
function viewBudget() {
  const st = budgetStatus(currentYM());
  const limit = st.limit;
  const pct = limit > 0 ? Math.min(100, Math.round(st.ratio * 100)) : 0;
  const cls = st.over ? 'over' : (st.warn ? 'warn' : '');

  const perSource = SOURCES.map(s => {
    const lim = Number(state.budgets.perSource[s]) || 0;
    const spent = sumExpense(txOfMonth(state.tx, currentYM()).filter(t => t.source === s));
    const p = lim > 0 ? Math.min(100, Math.round(spent / lim * 100)) : 0;
    const over = lim > 0 && spent > lim;
    return `
      <div class="field" style="margin-bottom:14px">
        <label style="display:flex;justify-content:space-between">
          <span><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${SOURCE_COLORS[s]};margin-right:6px"></span>${s}</span>
          <span style="color:${over ? '#E5484D' : '#94A3B8'};font-weight:600">${lim > 0 ? money(spent) + ' / ' + money(lim) : '未设限额'}</span>
        </label>
        <input class="input src-limit" data-src="${s}" type="number" inputmode="decimal" step="1" placeholder="不设则留空" value="${lim > 0 ? lim : ''}" />
        ${lim > 0 ? '<div class="progress ' + (over ? 'over' : (p >= 80 ? 'warn' : '')) + '"><i style="width:' + p + '%"></i></div>' : ''}
      </div>`;
  }).join('');

  return `
    <div class="card">
      <p class="card-title">本月总限额</p>
      <div class="field">
        <label>每月支出上限（元）</label>
        <input class="input" id="budget-total" type="number" inputmode="decimal" step="1" placeholder="例如 5000" value="${limit > 0 ? limit : ''}" />
      </div>
      <div class="progress ${cls}"><i style="width:${pct}%"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748B">
        <span>已用 ${money(st.spent)}</span>
        <span>${limit > 0 ? (st.over ? '超出 ' + money(st.spent - limit) : '剩余 ' + money(limit - st.spent)) : '未设置限额'}</span>
      </div>
      ${limit > 0 ? `<div style="margin-top:10px;font-size:13px;font-weight:600;color:${st.over ? '#E5484D' : (st.warn ? '#9A6B00' : '#16A34A')}">
        ${st.over ? '⚠️ 已超预算，请注意！' : (st.warn ? '🔔 已用 ' + Math.round(st.ratio * 100) + '%，接近上限' : '✓ 在预算内')}
      </div>` : ''}
    </div>

    <div class="card">
      <p class="card-title">各支付方式单独限额（可选）</p>
      ${perSource}
      <button class="btn btn-primary" id="btn-save-budget">保存限额</button>
    </div>

    <div class="card">
      <p class="card-title">通知提醒</p>
      <div class="setting-row">
        <span>系统通知</span>
        <span class="val" id="notify-state">${('Notification' in window) ? (Notification.permission === 'granted' ? '已开启' : '未开启') : '不支持'}</span>
      </div>
      <div class="actions" style="display:flex;gap:10px;margin-top:14px">
        <button class="btn btn-ghost btn-sm" id="btn-enable-notify" style="flex:1">开启通知</button>
        <button class="btn btn-ghost btn-sm" id="btn-test-notify" style="flex:1">测试通知</button>
      </div>
      <div class="hint">提示：iPhone 需先把本应用"添加到主屏幕"并以 App 图标打开，系统通知才可用（iOS 16.4+）。超限额时会在应用内红色提醒，并尽量推送系统通知。</div>
    </div>
  `;
}

function bindBudget() {
  document.getElementById('btn-save-budget').onclick = () => {
    const total = parseFloat(document.getElementById('budget-total').value) || 0;
    const perSource = {};
    document.querySelectorAll('.src-limit').forEach(inp => {
      const v = parseFloat(inp.value);
      if (v > 0) perSource[inp.dataset.src] = v;
    });
    state.budgets = { monthlyTotal: total, perSource };
    saveBudgets(state.budgets);
    toast('限额已保存 ✓');
    render();
    checkBudgetAndAlert(currentYM());
  };
  document.getElementById('btn-enable-notify').onclick = requestNotify;
  document.getElementById('btn-test-notify').onclick = () => {
    if (!('Notification' in window)) { toast('不支持通知'); return; }
    if (Notification.permission !== 'granted') { toast('请先开启通知'); return; }
    notify('测试通知', '如果你看到这条通知，说明提醒已生效 🎉');
    toast('已发送测试通知');
  };
}

// ================= 我的页 =================
function viewMine() {
  const dups = findDuplicates(state.tx);
  const dupHtml = dups.length ? dups.map((g, i) => `
    <div class="dup-item">
      <div class="dup-pair"><span>${escapeHtml(g[0].content)} · ${g[0].source}</span><span>${money(g[0].amount)}</span></div>
      <div class="dup-pair"><span>${escapeHtml(g[1].content)} · ${g[1].source}</span><span>${money(g[1].amount)}</span></div>
      <button class="btn btn-sm btn-ghost" data-merge="${i}" style="margin-top:8px">合并为一笔（保留银行卡）</button>
    </div>`).join('') : '<div class="empty">没有发现疑似重复的记录 👍</div>';

  return `
    <div class="card">
      <p class="card-title">数据概况</p>
      <div class="setting-row"><span>总记录数</span><span class="val">${state.tx.length} 笔</span></div>
      <div class="setting-row"><span>本月支出</span><span class="val">${money(sumExpense(txOfMonth(state.tx, currentYM())))}</span></div>
    </div>

    <div class="card">
      <p class="card-title">疑似重复（去重）</p>
      <div class="hint" style="margin-bottom:12px">用微信/支付宝付了银行卡的钱时，若同时记了"微信"和"建行"两笔，这里会自动识别，点合并只留一笔。</div>
      ${dupHtml}
    </div>

    <div class="card">
      <p class="card-title">自动化（快捷指令）</p>
      <div class="hint" style="margin:0 0 10px">
        在 iPhone「快捷指令」App → 自动化 → 新建，触发条件选「信息」并指定银行号码；动作加「打开 URL」，把短信内容拼到下面的地址后面。这样收到银行短信就能自动记一笔。
      </div>
      <div id="url-template" style="font-size:12px;color:#475569;background:#F8FAFC;border:1px solid #E9EEF4;border-radius:10px;padding:10px;word-break:break-all">${location.origin + location.pathname}?text=短信内容</div>
      <button class="btn btn-ghost btn-sm" id="btn-copy-url" style="width:100%;margin-top:10px">复制 URL 模板</button>
      <div class="hint">也可直接指定参数：<b>?quick=1&amount=45&content=午饭&source=建设银行</b></div>
    </div>

    <div class="card">
      <p class="card-title">数据备份 / 导入</p>
      <div class="actions" style="display:flex;gap:10px">
        <button class="btn btn-ghost btn-sm" id="btn-export-json" style="flex:1">导出 JSON</button>
        <button class="btn btn-ghost btn-sm" id="btn-export-csv" style="flex:1">导出 CSV</button>
      </div>
      <div style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" id="btn-import" style="width:100%">导入 JSON / CSV 文件</button>
        <input type="file" id="file-import" accept=".json,.csv" style="display:none" />
      </div>
      <div class="hint">数据只存在本机浏览器里。换手机或清理 Safari 数据前，请先导出备份。</div>
    </div>

    <div class="card">
      <p class="card-title">设置</p>
      <div class="setting-row"><span>昵称</span><span class="val">${escapeHtml(state.settings.name || '我')}</span></div>
      <div class="actions" style="margin-top:14px">
        <button class="btn btn-danger btn-sm" id="btn-clear" style="width:100%">清空所有数据</button>
      </div>
    </div>

    <div class="card">
      <p class="card-title">关于</p>
      <div class="hint" style="margin:0">记账本 · 本地离线记账。四种支付方式：微信、支付宝、中国银行、建设银行。支持分类分布、月度统计、限额预警与重复去重。所有数据不上传服务器。</div>
    </div>
  `;
}

function bindMine() {
  document.getElementById('btn-export-json').onclick = () => {
    download('记账备份-' + todayStr() + '.json', JSON.stringify(state.tx, null, 2), 'application/json');
  };
  document.getElementById('btn-export-csv').onclick = () => {
    const head = '日期,类型,金额,内容,分类,资金来源,支付渠道,备注\n';
    const rows = state.tx.map(t => [t.date, t.type === 'income' ? '收入' : '支出', t.amount, t.content, t.category, t.source, t.channel || '', t.note || '']
      .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    download('记账备份-' + todayStr() + '.csv', '\ufeff' + head + rows, 'text/csv');
  };
  const fileInput = document.getElementById('file-import');
  document.getElementById('btn-import').onclick = () => fileInput.click();
  fileInput.onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let imported = [];
        if (f.name.endsWith('.json')) {
          const arr = JSON.parse(reader.result);
          imported = arr.map(normalizeTx);
        } else {
          imported = parseCSV(reader.result);
        }
        if (!imported.length) { toast('没有可导入的数据'); return; }
        state.tx = state.tx.concat(imported);
        saveTransactions(state.tx);
        toast('已导入 ' + imported.length + ' 笔');
        render();
      } catch (err) { toast('导入失败：文件格式不对'); }
    };
    reader.readAsText(f);
  };

  const copyBtn = document.getElementById('btn-copy-url');
  if (copyBtn) copyBtn.onclick = async () => {
    const tpl = location.origin + location.pathname + '?text=';
    try { await navigator.clipboard.writeText(tpl); toast('已复制 URL 模板'); }
    catch (e) { toast('复制失败，请手动长按选择'); }
  };

  document.querySelectorAll('[data-merge]').forEach(b => {
    b.onclick = () => {
      const dups = findDuplicates(state.tx);
      const g = dups[Number(b.dataset.merge)];
      if (!g) return;
      state.tx = mergeDuplicate(g, state.tx);
      saveTransactions(state.tx);
      toast('已合并为一笔');
      render();
    };
  });

  document.getElementById('btn-clear').onclick = () => {
    const root = openModal(`
      <h3>确认清空？</h3>
      <p style="color:#64748B;font-size:14px;line-height:1.6">所有记账记录将被永久删除，且无法恢复。建议先导出备份。</p>
      <div class="actions">
        <button class="btn btn-ghost" id="c-cancel">取消</button>
        <button class="btn btn-danger" id="c-ok">确认清空</button>
      </div>`);
    root.querySelector('#c-cancel').onclick = closeModal;
    root.querySelector('#c-ok').onclick = () => {
      state.tx = [];
      saveTransactions(state.tx);
      closeModal();
      toast('已清空');
      render();
    };
  };
}

function normalizeTx(o) {
  return {
    id: o.id || genId(),
    type: o.type === 'income' ? 'income' : 'expense',
    amount: Number(o.amount) || 0,
    content: o.content || '导入记录',
    category: o.category || '其他',
    source: SOURCES.includes(o.source) ? o.source : '微信',
    channel: o.channel || '',
    date: o.date || todayStr(),
    note: o.note || '',
    createdAt: o.createdAt || Date.now()
  };
}

function parseCSV(text) {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // 简单 CSV 解析（支持引号）
    const cells = [];
    let cur = '', inQ = false;
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (inQ) {
        if (ch === '"' && lines[i][j + 1] === '"') { cur += '"'; j++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    if (cells.length < 4) continue;
    rows.push(normalizeTx({
      date: cells[0], type: cells[1] === '收入' ? 'income' : 'expense',
      amount: cells[2], content: cells[3], category: cells[4], source: cells[5], channel: cells[6], note: cells[7]
    }));
  }
  return rows;
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出');
}

// ---------- 启动 ----------
function bindTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => { state.view = t.dataset.view; location.hash = t.dataset.view; render(); };
  });
  document.getElementById('btn-settings-global').onclick = () => { state.view = 'mine'; location.hash = 'mine'; render(); };
}

// ---------- URL 快捷协议（配合 iOS 快捷指令自动记账） ----------
function handleQuickParams() {
  const p = new URLSearchParams(location.search);
  if (!p.has('quick') && !p.has('text')) return;
  let added = 0, merged = 0;
  if (p.has('text')) {
    const txs = parseText(p.get('text'));
    txs.forEach(t => { const r = smartAdd(state.tx, normalizeTx(t)); r.added ? added++ : merged++; });
  } else {
    const amount = parseFloat(p.get('amount'));
    if (amount > 0) {
      const content = p.get('content') || '快捷记账';
      const tx = normalizeTx({
        type: p.get('type') || 'expense', amount, content,
        category: p.get('category') || guessCategory(content),
        source: p.get('source') || '微信', channel: p.get('channel') || '',
        date: p.get('date') || todayStr(), note: p.get('note') || ''
      });
      const r = smartAdd(state.tx, tx);
      r.added ? added++ : merged++;
    }
  }
  saveTransactions(state.tx);
  if (added || merged) {
    setTimeout(() => toast('自动记录 ' + added + ' 笔' + (merged ? '，去重合并 ' + merged + ' 笔' : '')), 500);
  }
  const view = p.get('view') || 'stats';
  state.view = ['add', 'stats', 'budget', 'mine'].includes(view) ? view : 'stats';
  history.replaceState(null, '', location.pathname + '#' + state.view);
}

function init() {
  const h = (location.hash || '').replace('#', '');
  if (['add', 'stats', 'budget', 'mine'].includes(h)) state.view = h;
  handleQuickParams();
  bindTabs();
  render();
  // 首屏提示当前月超预算
  const st = budgetStatus(currentYM());
  if (st.over) {
    setTimeout(() => toast('⚠️ 本月已超预算 ' + money(st.spent - st.limit)), 600);
  }
  // 注册 Service Worker（离线）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

init();
