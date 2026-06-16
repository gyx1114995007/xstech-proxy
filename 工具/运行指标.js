const 指标 = {
  启动时间: Date.now(),
  请求: {
    总数: 0,
    成功: 0,
    失败: 0,
    取消: 0,
    进行中: 0,
    总耗时Ms: 0,
    按模型: {},
    按账号: {},
    最近: [],
    小时趋势: {},
  },
  模型流错误: {
    总数: 0,
    按类型: {},
    按模型: {},
    最近: [],
  },
};

function 限制最近(list, max = 30) {
  while (list.length > max) list.shift();
}

function 小时键(ts = Date.now()) {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function 确保小时桶(key) {
  if (!指标.请求.小时趋势[key]) {
    指标.请求.小时趋势[key] = { hour: key, 总数: 0, 成功: 0, 失败: 0, 取消: 0, 总耗时Ms: 0, 平均耗时Ms: 0, 按模型: {}, 按账号: {} };
  }
  return 指标.请求.小时趋势[key];
}

function 增加小时维度(map, name, status, durationMs) {
  const key = name || 'unknown';
  if (!map[key]) map[key] = { 总数: 0, 成功: 0, 失败: 0, 取消: 0, 总耗时Ms: 0, 平均耗时Ms: 0 };
  const item = map[key];
  item.总数++;
  item[status]++;
  item.总耗时Ms += durationMs;
  item.平均耗时Ms = Math.round(item.总耗时Ms / Math.max(1, item.总数));
}

function 记录小时趋势(ctx, status, durationMs) {
  const key = 小时键();
  const bucket = 确保小时桶(key);
  bucket.总数++;
  bucket[status]++;
  bucket.总耗时Ms += durationMs;
  bucket.平均耗时Ms = Math.round(bucket.总耗时Ms / Math.max(1, bucket.总数));
  增加小时维度(bucket.按模型, ctx.model, status, durationMs);
  增加小时维度(bucket.按账号, ctx.accountKey, status, durationMs);

  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  for (const k of Object.keys(指标.请求.小时趋势)) {
    if (Date.parse(k) < cutoff) delete 指标.请求.小时趋势[k];
  }
}

function 获取请求趋势(hours = 24) {
  hours = Math.max(1, Math.min(168, Number(hours || 24)));
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const rows = [];
  for (let i = hours - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = t.toISOString();
    const b = 指标.请求.小时趋势[key] || { hour: key, 总数: 0, 成功: 0, 失败: 0, 取消: 0, 总耗时Ms: 0, 平均耗时Ms: 0, 按模型: {}, 按账号: {} };
    rows.push({
      hour: key,
      总数: b.总数 || 0,
      成功: b.成功 || 0,
      失败: b.失败 || 0,
      取消: b.取消 || 0,
      平均耗时Ms: b.平均耗时Ms || 0,
      错误率: b.总数 ? Number((((b.失败 || 0) / b.总数) * 100).toFixed(2)) : 0,
      按模型: b.按模型 || {},
      按账号: b.按账号 || {},
    });
  }
  const summary = rows.reduce((s, r) => {
    s.总数 += r.总数;
    s.成功 += r.成功;
    s.失败 += r.失败;
    s.取消 += r.取消;
    s.总耗时Ms += (r.平均耗时Ms || 0) * (r.总数 || 0);
    return s;
  }, { hours, 总数: 0, 成功: 0, 失败: 0, 取消: 0, 总耗时Ms: 0, 平均耗时Ms: 0, 错误率: 0 });
  summary.平均耗时Ms = Math.round(summary.总耗时Ms / Math.max(1, summary.总数));
  summary.错误率 = summary.总数 ? Number(((summary.失败 / summary.总数) * 100).toFixed(2)) : 0;
  delete summary.总耗时Ms;
  return { hours, summary, rows };
}

function 确保模型请求(model) {
  const m = model || 'unknown';
  if (!指标.请求.按模型[m]) {
    指标.请求.按模型[m] = { 总数: 0, 成功: 0, 失败: 0, 取消: 0, 总耗时Ms: 0, 平均耗时Ms: 0 };
  }
  return 指标.请求.按模型[m];
}

function 确保账号请求(accountKey) {
  const a = accountKey || 'unknown';
  if (!指标.请求.按账号[a]) {
    指标.请求.按账号[a] = { 总数: 0, 成功: 0, 失败: 0, 取消: 0, 总耗时Ms: 0, 平均耗时Ms: 0 };
  }
  return 指标.请求.按账号[a];
}

function 开始请求({ model, accountKey } = {}) {
  const ctx = {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    start: Date.now(),
    model: model || 'unknown',
    accountKey: accountKey || 'unknown',
    ended: false,
  };

  指标.请求.总数++;
  指标.请求.进行中++;

  确保模型请求(ctx.model).总数++;

  return ctx;
}

function 结束请求(ctx, status = 'success', extra = {}) {
  if (!ctx || ctx.ended) return;
  ctx.ended = true;

  const durationMs = Date.now() - ctx.start;
  const s = status === 'canceled' ? '取消' : status === 'failed' ? '失败' : '成功';

  指标.请求.进行中 = Math.max(0, 指标.请求.进行中 - 1);
  指标.请求[s]++;
  指标.请求.总耗时Ms += durationMs;

  const byModel = 确保模型请求(ctx.model);
  byModel[s]++;
  byModel.总耗时Ms += durationMs;
  byModel.平均耗时Ms = Math.round(byModel.总耗时Ms / Math.max(1, byModel.总数));

  const byAccount = 确保账号请求(ctx.accountKey);
  byAccount.总数++;
  byAccount[s]++;
  byAccount.总耗时Ms += durationMs;
  byAccount.平均耗时Ms = Math.round(byAccount.总耗时Ms / Math.max(1, byAccount.总数));

  记录小时趋势(ctx, s, durationMs);

  指标.请求.最近.push({
    time: new Date().toISOString(),
    id: ctx.id,
    model: ctx.model,
    accountKey: ctx.accountKey,
    status,
    durationMs,
    sessionId: extra.sessionId,
    reason: extra.reason ? String(extra.reason).slice(0, 120) : undefined,
  });
  限制最近(指标.请求.最近, 50);
}

function 记录模型流错误({ model, type, code, message, xstechCode, xstechErr }) {
  const m = model || 'unknown';
  const t = type || 'model_stream_error';

  指标.模型流错误.总数++;
  指标.模型流错误.按类型[t] = (指标.模型流错误.按类型[t] || 0) + 1;

  if (!指标.模型流错误.按模型[m]) {
    指标.模型流错误.按模型[m] = { 总数: 0, 按类型: {}, 最近错误: null };
  }
  const mm = 指标.模型流错误.按模型[m];
  mm.总数++;
  mm.按类型[t] = (mm.按类型[t] || 0) + 1;
  mm.最近错误 = {
    time: new Date().toISOString(),
    type: t,
    code: code || t,
    message: String(message || '').slice(0, 300),
    xstechCode,
    xstechErr: xstechErr === undefined ? undefined : String(xstechErr).slice(0, 300),
  };

  指标.模型流错误.最近.push({
    time: new Date().toISOString(),
    model: m,
    type: t,
    code: code || t,
    message: String(message || '').slice(0, 300),
    xstechCode,
    xstechErr: xstechErr === undefined ? undefined : String(xstechErr).slice(0, 300),
  });
  限制最近(指标.模型流错误.最近);
}

function 快照请求指标() {
  const q = 指标.请求;
  return {
    总数: q.总数,
    成功: q.成功,
    失败: q.失败,
    取消: q.取消,
    进行中: q.进行中,
    平均耗时Ms: Math.round(q.总耗时Ms / Math.max(1, q.成功 + q.失败 + q.取消)),
    按模型: q.按模型,
    按账号: q.按账号,
    最近: q.最近,
    最近24小时趋势: 获取请求趋势(24),
  };
}

function 获取指标() {
  let 模型流错误规则 = null;
  try { 
    模型流错误规则 = require('./模型流错误分类').获取规则状态(); 
  } catch (err) {
    console.error('[运行指标] 加载模型流错误规则失败:', err.message);
  }
  return JSON.parse(JSON.stringify({
    uptimeSec: Math.floor((Date.now() - 指标.启动时间) / 1000),
    请求: 快照请求指标(),
    模型流错误: 指标.模型流错误,
    模型流错误规则,
  }));
}

module.exports = { 开始请求, 结束请求, 记录模型流错误, 获取指标, 获取请求趋势 };
