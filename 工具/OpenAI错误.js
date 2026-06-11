function 错误对象({
  message = '请求失败',
  type = 'server_error',
  code = 'internal_error',
  param = undefined,
  status = undefined,
  detail = undefined,
} = {}) {
  const error = { message, type, code };
  if (param !== undefined && param !== null) error.param = param;
  if (status !== undefined && status !== null) error.status = status;
  if (detail !== undefined && detail !== null) error.detail = detail;
  return { error };
}

function 返回错误(res, status, opts = {}) {
  const body = 错误对象({ ...opts, status });
  return res.status(status).json(body);
}

function SSE错误(opts = {}) {
  return 'data: ' + JSON.stringify(错误对象(opts)) + '\n\n';
}

function 写SSE错误(res, opts = {}) {
  res.write(SSE错误(opts));
  res.write('data: [DONE]\n\n');
}

function 安全错误消息(err, fallback = '请求失败') {
  if (!err) return fallback;
  return err.safeMessage || err.publicMessage || err.message || fallback;
}

module.exports = {
  错误对象,
  返回错误,
  SSE错误,
  写SSE错误,
  安全错误消息,
};
