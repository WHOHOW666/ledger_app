// ===== 记账本 数据层 =====
// 所有数据保存在浏览器 localStorage（手机本地），不上传任何服务器。

export const SOURCES = ['微信', '支付宝', '中国银行', '建设银行'];
export const WALLETS = ['微信', '支付宝'];      // 钱包类（可能代扣银行卡）
export const BANKS = ['中国银行', '建设银行'];   // 银行卡类
export const CATEGORIES = ['餐饮', '购物', '交通', '居住', '娱乐', '医疗', '教育', '人情', '数码', '其他'];

// 各支付方式主题色（用于图表/标签）
export const SOURCE_COLORS = {
  '微信': '#2DC100',
  '支付宝': '#1677FF',
  '中国银行': '#B71C1C',
  '建设银行': '#0A4C9E'
};

const K_TX = 'ledger_tx_v1';
const K_BUDGET = 'ledger_budget_v1';
const K_SETTINGS = 'ledger_settings_v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function write(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

export function loadTransactions() { return read(K_TX, []); }
export function saveTransactions(list) { write(K_TX, list); }

export function loadBudgets() {
  // 默认：仅总预算，各来源预算为空（不限）
  const b = read(K_BUDGET, null);
  if (!b) return { monthlyTotal: 0, perSource: {} };
  if (!b.perSource) b.perSource = {};
  return b;
}
export function saveBudgets(b) { write(K_BUDGET, b); }

export function loadSettings() {
  return read(K_SETTINGS, { name: '我' });
}
export function saveSettings(s) { write(K_SETTINGS, s); }

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function monthKey(dateStr) {
  // 输入 YYYY-MM-DD 或 Date，返回 'YYYY-MM'
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 取某月的交易（支出与收入都算，但统计默认只看支出）
export function txOfMonth(list, ym) {
  return list.filter(t => monthKey(t.date) === ym);
}

export function sumExpense(list) {
  return list.filter(t => t.type !== 'income')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
}
export function sumIncome(list) {
  return list.filter(t => t.type === 'income')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

// 按分类汇总支出
export function categoryBreakdown(list) {
  const map = {};
  list.filter(t => t.type !== 'income').forEach(t => {
    const c = t.category || '其他';
    map[c] = (map[c] || 0) + (Number(t.amount) || 0);
  });
  return Object.entries(map).map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

// 按资金来源汇总支出（去重后真实流出都归到 source）
export function sourceBreakdown(list) {
  const map = {};
  list.filter(t => t.type !== 'income').forEach(t => {
    const s = t.source || '其他';
    map[s] = (map[s] || 0) + (Number(t.amount) || 0);
  });
  return Object.entries(map).map(([label, value]) => ({ label, value, color: SOURCE_COLORS[label] || '#888' }))
    .sort((a, b) => b.value - a.value);
}

// 最近 N 个月（含当前）的月度支出趋势
export function monthlyTrend(list, n = 6) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    out.push({ ym, value: sumExpense(txOfMonth(list, ym)) });
  }
  return out;
}

// ===== 去重检测 =====
// 场景：用微信/支付宝付款，但钱实际从银行卡扣。这种情况若记了两笔（一笔钱包、一笔银行），
// 应只算一笔。这里把"同月、同金额、一端钱包一端银行"的交易标记为疑似重复，供用户合并。
export function findDuplicates(list) {
  const groups = [];
  const used = new Set();
  const txs = list.filter(t => t.type !== 'income' && !t.merged);
  for (let i = 0; i < txs.length; i++) {
    if (used.has(txs[i].id)) continue;
    for (let j = i + 1; j < txs.length; j++) {
      if (used.has(txs[j].id)) continue;
      const a = txs[i], b = txs[j];
      const sameAmount = Math.abs((Number(a.amount) || 0) - (Number(b.amount) || 0)) < 0.005;
      const sameDate = a.date === b.date;
      const aW = WALLETS.includes(a.source), aB = BANKS.includes(a.source);
      const bW = WALLETS.includes(b.source), bB = BANKS.includes(b.source);
      const walletVsBank = (aW && bB) || (aB && bW);
      if (sameAmount && sameDate && walletVsBank) {
        used.add(a.id); used.add(b.id);
        groups.push([a, b]);
        break;
      }
    }
  }
  return groups;
}

// 智能写入：新增前先查是否与已有记录构成"钱包 vs 银行卡"重复（同金额同日期）。
// 若重复则合并为一笔（保留银行卡），返回 { added, merged }，保证自动写入不会重复计账。
export function smartAdd(list, tx) {
  if (tx.type === 'income') { list.push(tx); return { added: true, merged: false, list }; }
  const dup = list.find(t =>
    t.type !== 'income' &&
    Math.abs((Number(t.amount) || 0) - (Number(tx.amount) || 0)) < 0.005 &&
    t.date === tx.date &&
    ((WALLETS.includes(t.source) && BANKS.includes(tx.source)) ||
     (BANKS.includes(t.source) && WALLETS.includes(tx.source)))
  );
  if (dup) {
    if (BANKS.includes(tx.source) && WALLETS.includes(dup.source)) {
      // 已有的是钱包记录，新来的是银行卡 → 以银行卡为准，渠道记原钱包
      dup.channel = dup.channel || dup.source;
      dup.source = tx.source;
      dup.amount = tx.amount;
      dup.mergedNote = '自动去重：合并了钱包记录';
    } else {
      // 已有的就是银行卡，新来的是钱包 → 忽略新的，仅补渠道
      dup.channel = dup.channel || tx.source;
      dup.mergedNote = '自动去重：忽略重复钱包记录';
    }
    return { added: false, merged: true, list };
  }
  list.push(tx);
  return { added: true, merged: false, list };
}

// 合并一组疑似重复：保留银行卡那笔（真实资金流出）作为 source，channel 记为钱包，删除钱包那笔。
export function mergeDuplicate(group, list) {
  const [a, b] = group;
  const bank = BANKS.includes(a.source) ? a : b;
  const wallet = BANKS.includes(a.source) ? b : a;
  bank.channel = wallet.source;     // 记录"用微信/支付宝付的"
  bank.mergedNote = '已合并：原钱包记录 ' + wallet.content;
  const filtered = list.filter(t => t.id !== wallet.id);
  return filtered;
}
