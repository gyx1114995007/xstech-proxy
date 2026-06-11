
const 日志 = require('./日志');
class 内存锁 {
  constructor() { this.锁表 = {}; }
  acquire(key, 超时秒 = 600) {
    if (this.锁表[key] && this.锁表[key].locked) return false;
    this.锁表[key] = { locked: true, timer: setTimeout(() => { if (this.锁表[key] && this.锁表[key].locked) { 日志.warn('内存锁', '超时自动释放: ' + key); this.release(key); } }, 超时秒 * 1000) };
    日志.debug('内存锁', '锁已获取: ' + key); return true;
  }
  release(key) { if (this.锁表[key]) { clearTimeout(this.锁表[key].timer); this.锁表[key].locked = false; 日志.debug('内存锁', '锁已释放: ' + key); } }
  isLocked(key) { return !!(this.锁表[key] && this.锁表[key].locked); }
}
module.exports = new 内存锁();
