const net = require('net');
const { execFileSync } = require('child_process');
const 配置 = require('../启动/配置');

function shell(cmd, args = []) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 1500 }).trim();
  } catch {
    return '';
  }
}

function 检测端口可绑定(host, port) {
  return new Promise(resolve => {
    const server = net.createServer();
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      try { server.close(); } catch {}
      resolve(result);
    };
    server.once('error', err => {
      finish({ bindable: false, code: err.code, message: err.message });
    });
    server.once('listening', () => {
      finish({ bindable: true });
    });
    try {
      server.listen(port, host === '0.0.0.0' ? undefined : host);
    } catch (err) {
      finish({ bindable: false, code: err.code, message: err.message });
    }
    setTimeout(() => finish({ bindable: false, code: 'CHECK_TIMEOUT', message: '端口检测超时' }), 1800).unref?.();
  });
}

function 端口占用信息(port) {
  const outputs = [];
  const ss = shell('bash', ['-lc', 'ss -ltnp 2>/dev/null | grep -E ":' + port + '\\b" || true']);
  if (ss) outputs.push({ command: 'ss -ltnp', output: ss });
  const lsof = shell('bash', ['-lc', 'lsof -i :' + port + ' -P -n 2>/dev/null || true']);
  if (lsof) outputs.push({ command: 'lsof -i', output: lsof });
  return outputs;
}

async function 获取部署状态() {
  const host = 配置.主机;
  const port = 配置.端口;
  const bind = await 检测端口可绑定(host, port);
  // 当前服务正在运行时，目标端口通常不可再次绑定；这不一定是异常。
  const occupied = !bind.bindable;
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      ppid: process.ppid,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSec: Math.floor(process.uptime()),
      cwd: process.cwd(),
      argv: process.argv,
      execPath: process.execPath,
      memory: process.memoryUsage(),
    },
    config: {
      host,
      port,
      panelUrl: 'http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + port + '/panel',
      healthUrl: 'http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + port + '/health',
    },
    port: {
      host,
      port,
      occupied,
      bindable: bind.bindable,
      code: bind.code,
      message: bind.message,
      note: occupied ? '端口当前不可绑定。若本服务正在运行，这通常是正常现象；若启动失败，则可能是端口被其他进程占用。' : '端口当前可绑定。',
      owners: occupied ? 端口占用信息(port) : [],
    },
    commands: {
      currentPid: String(process.pid),
      stopCurrent: 'kill ' + process.pid,
      checkPort: 'ss -ltnp | grep :' + port,
      start: 'npm start',
    },
  };
}

module.exports = { 获取部署状态 };