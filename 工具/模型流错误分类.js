const fs = require('fs');
const path = require('path');

const 规则文件 = path.join(__dirname, '..', '模型流错误规则.json');
const 未分类文件 = path.join(__dirname, '..', '模型流错误未分类.json');

let 规则缓存 = null;
let 规则文件mtime = 0;
let 未分类写队列 = Promise.resolve();

function 文本化(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function 读JSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function 原子写JSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function 加载规则() {
  try {
    const st = fs.existsSync(规则文件) ? fs.statSync(规则文件) : null;
    const mtime = st ? st.mtimeMs : 0;
    if (规则缓存 && mtime === 规则文件mtime) return 规则缓存;

    const data = 读JSON(规则文件, { 规则: [] });
    const list = Array.isArray(data.规则) ? data.规则 : [];
    规则缓存 = list.map((r, index) => ({
      index,
      type: r.type || 'model_stream_error',
      code: r.code || r.type || 'model_stream_error',
      action: r.action || 'return_error',
      patterns: Array.isArray(r.patterns) ? r.patterns : [],
      flags: r.flags || 'i',
      description: r.description || r.说明 || '',
    }));
    规则文件mtime = mtime;
    return 规则缓存;
  } catch {
    return [];
  }
}

function 命中规则(text, code) {
  const all = String(code || '') + ' ' + text;
  for (const r of 加载规则()) {
    for (const p of r.patterns) {
      try {
        const re = new RegExp(p, r.flags || 'i');
        if (re.test(all)) return r;
      } catch {
        if (all.toLowerCase().includes(String(p).toLowerCase())) return r;
      }
    }
  }
  return null;
}

function 样例key(obj) {
  return [
    obj.type || '',
    obj.xstechCode || '',
    String(obj.message || '').slice(0, 500),
  ].join('|');
}

function 记录未分类样例({ code, message, data, model }) {
  未分类写队列 = 未分类写队列
    .catch(() => {})
    .then(() => {
      const file = 读JSON(未分类文件, { version: 1, 说明: '自动收集未命中精细规则的模型 SSE 流错误样例。', 样例: [] });
      if (!Array.isArray(file.样例)) file.样例 = [];

      const item = {
        time: new Date().toISOString(),
        type: 'model_stream_error',
        xstechCode: code,
        message: String(message || '').slice(0, 1000),
        data,
        model: model || undefined,
        count: 1,
      };
      const key = 样例key(item);
      const old = file.样例.find(x => 样例key(x) === key);
      if (old) {
        old.count = (old.count || 1) + 1;
        old.lastSeen = item.time;
      } else {
        file.样例.push(item);
      }

      file.样例.sort((a, b) => String(b.lastSeen || b.time || '').localeCompare(String(a.lastSeen || a.time || '')));
      if (file.样例.length > 200) file.样例 = file.样例.slice(0, 200);
      原子写JSON(未分类文件, file);
    });
}

function 分类模型流错误(input = {}) {
  const code = input.code;
  const err = input.err || input.msg || input.message || '';
  const data = input.data;
  const message = 文本化(err || data || ('xstech stream error code=' + code));
  const text = (String(code || '') + ' ' + message).toLowerCase();

  const rule = 命中规则(text, code);
  if (rule) {
    return {
      source: 'model_stream',
      type: rule.type,
      code: rule.code,
      action: rule.action || 'return_error',
      message,
      ruleIndex: rule.index,
      ruleSource: '模型流错误规则.json',
    };
  }

  // 规则文件缺失/损坏时的极简兜底，正常情况下由 JSON 规则覆盖。
  if (message.includes('不允许的文本')) {
    return { source: 'model_stream', type: 'content_censor', code: 'content_censor', action: 'censor_fix', message };
  }
  if (Number(code) === 429) {
    return { source: 'model_stream', type: 'model_rate_limit', code: 'model_rate_limit', action: 'return_error', message };
  }

  记录未分类样例({ code, message, data, model: input.model });
  return {
    source: 'model_stream',
    type: 'model_stream_error',
    code: 'model_stream_error',
    action: 'return_error',
    message,
    unclassified: true,
  };
}

function 下游安全提示(type) {
  switch (type) {
    case 'content_censor':
      return '内容触发模型安全策略';
    case 'model_rate_limit':
      return '模型上游限流，请稍后重试';
    case 'model_timeout':
      return '模型上游响应超时，请稍后重试';
    case 'model_context_error':
      return '请求上下文超出模型限制';
    case 'model_quota_error':
      return '模型上游额度不足，请联系管理员';
    case 'model_provider_auth_error':
      return '模型上游渠道认证异常，请联系管理员';
    case 'model_provider_subscription_error':
      return '模型上游渠道订阅不可用，请联系管理员';
    case 'model_not_found_or_no_access':
      return '模型不存在或当前渠道无访问权限';
    case 'model_no_channel':
      return '模型暂不可用：无可用渠道';
    case 'upstream_model_error':
      return '模型上游服务异常，请稍后重试';
    default:
      return '模型调用失败';
  }
}

function 转OpenAI错误(input = {}, model) {
  const c = input.type ? input : 分类模型流错误({ ...input, model });
  const type = c.type || 'model_stream_error';
  const code = c.code || type;
  return {
    message: 下游安全提示(type),
    type,
    code,
    source: c.source || 'model_stream',
    model,
  };
}

function 获取规则状态() {
  const rules = 加载规则();
  const un = 读JSON(未分类文件, { 样例: [] });
  return {
    规则文件,
    规则数量: rules.length,
    未分类文件,
    未分类样例数量: Array.isArray(un.样例) ? un.样例.length : 0,
  };
}

function 重载规则() {
  规则缓存 = null;
  规则文件mtime = 0;
  const rules = 加载规则();
  return 获取规则状态();
}

function 获取未分类样例(limit = 50) {
  const un = 读JSON(未分类文件, { version: 1, 样例: [] });
  const list = Array.isArray(un.样例) ? un.样例 : [];
  return {
    version: un.version || 1,
    count: list.length,
    samples: list.slice(0, Math.max(1, Number(limit) || 50)),
  };
}

function 清空未分类样例() {
  原子写JSON(未分类文件, {
    version: 1,
    说明: '自动收集未命中精细规则的模型 SSE 流错误样例。用于后续补充 模型流错误规则.json。',
    样例: [],
    clearedAt: new Date().toISOString(),
  });
  return 获取未分类样例();
}

module.exports = { 分类模型流错误, 转OpenAI错误, 获取规则状态, 重载规则, 获取未分类样例, 清空未分类样例 };
