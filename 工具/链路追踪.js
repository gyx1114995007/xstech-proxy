const 日志 = require('./日志');

function now() {
  return Date.now();
}

function duration(from, to) {
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, to - from) : undefined;
}

function short(value, max = 120) {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).slice(0, max);
}

function valueOrDash(value) {
  return value === undefined || value === null ? '-' : String(value);
}

function 新ID(prefix = 'trace') {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function 创建(meta = {}) {
  const trace = {
    id: meta.id || 新ID(meta.source || 'chat'),
    source: meta.source || 'chat',
    route: meta.route,
    model: meta.model,
    xstechModel: meta.xstechModel,
    accountKey: meta.accountKey,
    sessionId: meta.sessionId,
    stream: meta.stream,
    filesCount: meta.filesCount || 0,
    result: 'unknown',
    reason: '',
    retryCount: 0,
    currentAttempt: 0,
    upstreamChunks: 0,
    downstreamWrites: 0,
    toolStarts: 0,
    toolDeltas: 0,
    toolDeltaBytes: 0,
    attempts: [],
    marks: {
      t0: now(),
    },
    retryDelays: [],
    ended: false,
  };

  function setMeta(next = {}) {
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined) trace[key] = value;
    }
    return api;
  }

  function mark(name, extra = {}) {
    trace.marks[name] = now();
    if (name === 't0_censor') {
      trace.marks.t0_pre_censor = trace.marks.t0_pre_censor || trace.marks.t0;
      trace.marks.t0_post_censor = trace.marks[name];
    }
    if (name === 't1') {
      const attempt = Number.isInteger(extra.attempt) ? extra.attempt : trace.currentAttempt;
      trace.currentAttempt = attempt;
      trace.retryCount = Math.max(trace.retryCount, attempt);
      
      if (attempt > 0 && trace.attempts[attempt - 1] && trace.attempts[attempt - 1].t1) {
        const delay = trace.marks[name] - trace.attempts[attempt - 1].t1;
        trace.retryDelays.push(delay);
      }
      
      trace.attempts[attempt] = {
        ...(trace.attempts[attempt] || {}),
        attempt,
        t1: trace.marks[name],
        sessionId: extra.sessionId,
        filesCount: extra.filesCount,
        tcpConnectMs: extra.tcpConnectMs,
        tlsHandshakeMs: extra.tlsHandshakeMs,
      };
    }
    return api;
  }

  function markOnce(name, extra = {}) {
    if (!trace.marks[name]) mark(name, extra);
    return api;
  }

  function markUpstreamRequest(extra = {}) {
    const attempt = Number.isInteger(extra.attempt) ? extra.attempt : trace.currentAttempt;
    trace.currentAttempt = attempt;
    trace.retryCount = Math.max(trace.retryCount, attempt);
    const t = now();
    
    if (attempt > 0 && trace.attempts[attempt - 1] && trace.attempts[attempt - 1].t1) {
      const delay = t - trace.attempts[attempt - 1].t1;
      trace.retryDelays.push(delay);
    }
    
    trace.attempts[attempt] = {
      ...(trace.attempts[attempt] || {}),
      attempt,
      t1: trace.attempts[attempt] && trace.attempts[attempt].t1 || t,
      sessionId: extra.sessionId,
      filesCount: extra.filesCount,
      tcpConnectMs: extra.tcpConnectMs,
      tlsHandshakeMs: extra.tlsHandshakeMs,
    };
    if (!trace.marks.t1) trace.marks.t1 = trace.attempts[attempt].t1;
    return api;
  }

  function markUpstreamData(extra = {}) {
    trace.upstreamChunks++;
    const t = now();
    const attempt = Number.isInteger(extra.attempt) ? extra.attempt : trace.currentAttempt;
    const item = trace.attempts[attempt] || { attempt };
    if (!item.t2) item.t2 = t;
    item.chunks = (item.chunks || 0) + 1;
    trace.attempts[attempt] = item;
    if (!trace.marks.t2) trace.marks.t2 = t;
    return api;
  }

  function markDownstreamWrite(_chunk = {}) {
    trace.downstreamWrites++;
    if (!trace.marks.t3) trace.marks.t3 = now();
    return api;
  }

  function markToolEvent(event = {}) {
    if (event.type === 'tool_start') {
      trace.toolStarts++;
      if (!trace.marks.tt_start) trace.marks.tt_start = now();
    } else if (event.type === 'tool_delta') {
      trace.toolDeltas++;
      trace.toolDeltaBytes += Buffer.byteLength(String(event.arguments || ''));
      if (!trace.marks.tt_delta) trace.marks.tt_delta = now();
    }
    return api;
  }

  function finish(result = 'success', extra = {}) {
    if (trace.ended) return trace;
    trace.ended = true;
    trace.result = result || trace.result || 'unknown';
    trace.reason = short(extra.reason || trace.reason, 160);
    if (extra.sessionId !== undefined) trace.sessionId = extra.sessionId;
    if (extra.accountKey !== undefined) trace.accountKey = extra.accountKey;
    if (extra.model !== undefined) trace.model = extra.model;
    if (extra.xstechModel !== undefined) trace.xstechModel = extra.xstechModel;
    if (extra.filesCount !== undefined) trace.filesCount = extra.filesCount;
    if (!trace.marks.t4) trace.marks.t4 = now();

    const m = trace.marks;
    const firstAttempt = trace.attempts[0] || {};
    const summary = {
      id: trace.id,
      source: trace.source,
      route: trace.route,
      model: trace.model,
      xstechModel: trace.xstechModel,
      accountKey: trace.accountKey,
      sessionId: trace.sessionId,
      stream: trace.stream,
      files: trace.filesCount,
      result: trace.result,
      reason: trace.reason,
      attempts: trace.retryCount + 1,
      retryDelays: trace.retryDelays.length > 0 ? trace.retryDelays : undefined,
      totalMs: duration(m.t0, m.t4),
      censorMs: duration(m.t0_pre_censor || m.t0, m.t0_post_censor),
      preUpstreamMs: duration(m.t0, m.t1),
      tcpConnectMs: firstAttempt.tcpConnectMs,
      tlsHandshakeMs: firstAttempt.tlsHandshakeMs,
      upstreamTtfbMs: duration(m.t1, m.t2),
      downstreamFirstWriteMs: duration(m.t1, m.t3),
      downstreamWaitMs: duration(m.t0, m.t3),
      streamAfterFirstMs: duration(m.t3, m.t4),
      upstreamChunks: trace.upstreamChunks,
      downstreamWrites: trace.downstreamWrites,
      toolStartMs: duration(m.t0, m.tt_start),
      toolDeltaMs: duration(m.t0, m.tt_delta),
      toolStarts: trace.toolStarts,
      toolDeltas: trace.toolDeltas,
      toolDeltaBytes: trace.toolDeltaBytes,
    };

    const line = [
      'id=' + summary.id,
      'source=' + valueOrDash(summary.source),
      'route=' + valueOrDash(summary.route),
      'model=' + valueOrDash(summary.model),
      'xstech=' + valueOrDash(summary.xstechModel),
      'account=' + valueOrDash(summary.accountKey),
      'session=' + valueOrDash(summary.sessionId),
      'stream=' + valueOrDash(summary.stream),
      'files=' + valueOrDash(summary.files),
      'result=' + valueOrDash(summary.result),
      'attempts=' + valueOrDash(summary.attempts),
      summary.retryDelays ? ('retry_delays=[' + summary.retryDelays.map(d => d + 'ms').join(',') + ']') : '',
      'total=' + valueOrDash(summary.totalMs) + 'ms',
      summary.censorMs !== undefined ? ('censor=' + valueOrDash(summary.censorMs) + 'ms') : '',
      'pre_upstream=' + valueOrDash(summary.preUpstreamMs) + 'ms',
      summary.tcpConnectMs !== undefined ? ('tcp=' + valueOrDash(summary.tcpConnectMs) + 'ms') : '',
      summary.tlsHandshakeMs !== undefined ? ('tls=' + valueOrDash(summary.tlsHandshakeMs) + 'ms') : '',
      'upstream_ttfb=' + valueOrDash(summary.upstreamTtfbMs) + 'ms',
      'first_write_from_upstream=' + valueOrDash(summary.downstreamFirstWriteMs) + 'ms',
      'downstream_wait=' + valueOrDash(summary.downstreamWaitMs) + 'ms',
      'after_first=' + valueOrDash(summary.streamAfterFirstMs) + 'ms',
      'chunks=' + valueOrDash(summary.upstreamChunks),
      'writes=' + valueOrDash(summary.downstreamWrites),
      'tool_start=' + valueOrDash(summary.toolStartMs) + 'ms',
      'tool_delta=' + valueOrDash(summary.toolDeltaMs) + 'ms',
      'tool_starts=' + valueOrDash(summary.toolStarts),
      'tool_deltas=' + valueOrDash(summary.toolDeltas),
      'tool_delta_bytes=' + valueOrDash(summary.toolDeltaBytes),
      summary.reason ? ('reason=' + summary.reason) : '',
    ].filter(Boolean).join(' ');

    日志.info('链路耗时', line);
    if (日志.记录链路) 日志.记录链路(JSON.stringify(summary));
    return trace;
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(trace));
  }

  const api = {
    id: trace.id,
    trace,
    setMeta,
    mark,
    markOnce,
    markUpstreamRequest,
    markUpstreamData,
    markDownstreamWrite,
    markToolEvent,
    finish,
    end: finish,
    snapshot,
  };
  return api;
}

module.exports = { 创建 };
