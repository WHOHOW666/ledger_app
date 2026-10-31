// ===== 智能识别：从短信 / 支付通知 / 账单文本中解析交易 =====
import { SOURCES, WALLETS, BANKS } from './storage.js';

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

// 提取金额：优先带货币符号/元/人民币
export function extractAmount(text) {
  const pats = [
    /(?:¥|￥)\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /人民币\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    /([0-9]+(?:\.[0-9]{1,2})?)\s*元/,
    /(?:金额|消费|支出|付款|支付|扣款|交易)[^0-9]{0,8}([0-9]+(?:\.[0-9]{1,2})?)/
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

// 判断支出/收入
export function guessType(text) {
  if (/退款|入账|收入|到账|工资|转入|收到/.test(text)) return 'income';
  return 'expense';
}

// 判断资金来源（返回四种之一或 ''）
export function guessSource(text) {
  const hasWX = /微信/.test(text);
  const hasAli = /支付宝/.test(text);
  const hasCCB = /建设银行|建行/.test(text);
  const hasBOC = /中国银行|中行/.test(text);

  // 钱包 + 银行卡同时出现：钱实际从银行卡扣，来源记银行卡
  if (hasCCB) return '建设银行';
  if (hasBOC) return '中国银行';
  if (hasWX) return '微信';
  if (hasAli) return '支付宝';
  if (/银行|储蓄卡|借记卡|信用卡|尾号/.test(text)) return '建设银行'; // 兜底，可在界面改
  return '';
}

// 判断支付渠道（微信/支付宝付款）
export function guessChannel(text) {
  if (/微信/.test(text)) return '微信';
  if (/支付宝/.test(text)) return '支付宝';
  if (/刷卡|银行卡|储蓄卡|借记卡|信用卡/.test(text)) return '刷卡';
  return '';
}

// 提取商户/内容
export function extractMerchant(text) {
  const pats = [
    /(?:商户名称|商户全称|商户|收款方|交易对方|对方)[：:\s]+([^\s，,。;；、]{2,24})/,
    /(?:微信支付|支付宝)[：:\-\s]+([^\s，,。;；、]{2,24})/,
    /在([^，,。\s]{2,20}?)(?:消费|支付|付款|买单)/,
    /于([^，,。\s]{2,20}?)(?:消费|支付|付款)/
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m && m[1]) return m[1].replace(/[（(].*?[)）]/g, '').trim();
  }
  return '';
}

// 猜测分类
export function guessCategory(text) {
  const rules = [
    [/餐|饭|食|外卖|奶茶|咖啡|火锅|烧烤|麦当劳|肯德基|星巴克|美团|饿了么|面馆|小吃/, '餐饮'],
    [/超市|购物|淘宝|天猫|京东|拼多多|商场|衣服|鞋|日用品|便利店|百货/, '购物'],
    [/地铁|公交|打车|滴滴|高铁|火车|机票|加油|停车|出租|交通|共享单车/, '交通'],
    [/房租|物业|水费|电费|燃气|宽带|话费|居住|维修/, '居住'],
    [/电影|游戏|娱乐|健身|KTV|会员|音乐|视频|演出/, '娱乐'],
    [/药|医院|诊所|体检|医疗|挂号/, '医疗'],
    [/学费|书|培训|教育|课程|考试/, '教育'],
    [/红包|礼金|人情|份子|转账给|赠/, '人情'],
    [/数码|手机|电脑|耳机|电子|相机/, '数码']
  ];
  for (const [re, cat] of rules) if (re.test(text)) return cat;
  return '其他';
}

// 提取日期
export function extractDate(text) {
  let m = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) return new Date().getFullYear() + '-' + pad(m[1]) + '-' + pad(m[2]);
  if (/昨天/.test(text)) { const d = new Date(); d.setDate(d.getDate() - 1); return fmtDate(d); }
  if (/前天/.test(text)) { const d = new Date(); d.setDate(d.getDate() - 2); return fmtDate(d); }
  return todayStr();
}

// 解析单条消息
export function parseMessage(block) {
  const amount = extractAmount(block);
  if (amount == null || !(amount > 0)) return null;

  let source = guessSource(block);
  if (!source) source = /银行|卡/.test(block) ? '建设银行' : '微信';

  const type = guessType(block);
  let channel = guessChannel(block);
  // 来源是银行卡、渠道是钱包时保留钱包渠道
  if (WALLETS.includes(source)) channel = source;

  const merchant = extractMerchant(block);
  const category = guessCategory((merchant || '') + ' ' + block);
  const content = merchant || (category + '消费');

  return {
    type,
    amount: Math.round(amount * 100) / 100,
    content,
    category,
    source: SOURCES.includes(source) ? source : '微信',
    channel: channel || '',
    date: extractDate(block),
    note: '',
    auto: true
  };
}

// 解析多行文本：以"出现金额"为一条的结束
export function parseText(text) {
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const txs = [];
  let buf = [];
  for (const line of lines) {
    buf.push(line);
    if (extractAmount(line) != null) {
      const tx = parseMessage(buf.join(' '));
      if (tx) txs.push(tx);
      buf = [];
    }
  }
  if (buf.length) {
    const block = buf.join(' ');
    if (extractAmount(block) != null) {
      const tx = parseMessage(block);
      if (tx) txs.push(tx);
    }
  }
  return txs;
}
