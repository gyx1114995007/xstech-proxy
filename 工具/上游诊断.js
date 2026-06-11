const axios = require('axios');
const dns = require('dns').promises;
const { URL } = require('url');
const 配置 = require('../启动/配置');
const 账号池 = require('../服务层/账号池');

function nowIso() { return new Date().toISOString(); }

function 错误摘要(err) {
  return {
    name: err && err.name,
    message: err && err.message ? String(err.message).slice(0, 300) : '',
    code: err && err.code,
    status: err && (err.status || err.statusCode || (err.response && err.response.status)),
    axiosCode: err && err.isAxiosError ? err.code : undefined,
    causeCode: err && err.cause && err.cause.code,
  };
}

async function 计时(name, fn) {
  const start = Date.now();
  try {
    const data = await fn();
    return { name, ok: true, durationMs: Date.now() - start, ...data };
  } catch (err) {
    return { name, ok: false, durationMs: Date.now() - start, error: 错误摘要(err) };
  }
}

function 通用头(token) {
  const h = { Accept: 'application/json, text/plain, */*', 'X-APP-VERSION': 配置.xstech.应用版本 };
  if (token) h.Authorization = token;
  return h;
}

function 判断建议(checks) {
  const dnsOk = checks.find(x => x.name === 'dns')?.ok;
  const baseOk = checks.find(x => x.name === 'base-http')?.ok;
  const modelOk = checks.find(x => x.name === 'models-api')?.ok;
  const billing = checks.find(x => x.name === 'billing-plans-api');
  if (!dnsOk) return 'DNS 解析失败：优先检查网络、DNS 或域名污染。';
  if (!baseOk) return '基础 HTTPS 连接失败：可能是网络、代理、TLS 或上游不可达。';
  if (!modelOk) return '基础连接可用，但模型 API 异常：可能是上游接口波动或限流。';
  if (billing && !billing.ok) return '模型 API 可用，但账号接口异常：可能是 token、账号状态或账号接口波动。';
  return '上游连通性整体正常。';
}

async function 诊断(options = {}) {
  const base = 配置.xstech.基础地址 || 'https://xstech.one';
  const timeoutMs = Math.max(1000, Math.min(30000, Number(options.timeoutMs || 5000)));
  const accountKey = options.accountKey || 'acc_0';
  const url = new URL(base);
  const checks = [];
  const startedAt = nowIso();
  const start = Date.now();

  checks.push(await 计时('dns', async () => {
    const records = await dns.lookup(url.hostname, { all: true });
    return { host: url.hostname, records: records.map(r => ({ address: r.address, family: r.family })) };
  }));

  checks.push(await 计时('base-http', async () => {
    const res = await axios.get(base, { timeout: timeoutMs, validateStatus: () => true, maxRedirects: 3 });
    return { url: base, status: res.status, statusText: res.statusText, bytes: typeof res.data === 'string' ? res.data.length : undefined };
  }));

  checks.push(await 计时('models-api', async () => {
    const res = await axios.get(base.replace(/\/$/, '') + '/api/model', {
      timeout: timeoutMs,
      headers: 通用头(),
      validateStatus: () => true,
    });
    return {
      url: '/api/model',
      status: res.status,
      okStatus: res.status >= 200 && res.status < 300,
      dataType: typeof res.data,
      count: Array.isArray(res.data && res.data.data) ? res.data.data.length : undefined,
    };
  }));

  const acc = 账号池.获取全部账号 ? (账号池.获取全部账号().find(a => a.key === accountKey) || 账号池.获取全部账号()[0]) : null;
  if (acc && acc.token) {
    checks.push(await 计时('billing-plans-api', async () => {
      const res = await axios.get(base.replace(/\/$/, '') + '/api/user_plan?page=1', {
        timeout: timeoutMs,
        headers: 通用头(acc.token),
        validateStatus: () => true,
      });
      const data = res.data && res.data.data;
      return {
        url: '/api/user_plan?page=1',
        accountKey: acc.key,
        status: res.status,
        okStatus: res.status >= 200 && res.status < 300,
        records: Array.isArray(data && data.records) ? data.records.length : undefined,
        pages: data && data.pages,
      };
    }));
  } else {
    checks.push({ name: 'billing-plans-api', ok: false, durationMs: 0, skipped: true, reason: '没有可用账号 token' });
  }

  const ok = checks.every(c => c.ok && (c.status === undefined || c.okStatus !== false));
  return {
    ok,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - start,
    base,
    timeoutMs,
    accountKey,
    checks,
    recommendation: 判断建议(checks),
  };
}

module.exports = { 诊断 };
