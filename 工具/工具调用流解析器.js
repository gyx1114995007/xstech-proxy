const { escapeRegExp, tailPrefixLen, scanJsonEnd } = require('./工具调用解析辅助');

class 工具调用流解析器 {
  constructor(nonce) {
    this.nonce = nonce;
    this.openPrefix = '<tool_call:' + nonce;
    this.openRegex = new RegExp('<tool_call:' + escapeRegExp(nonce) + '\\s+name="([^"]*)">', 'i');
    this.close = '</tool_call:' + nonce + '>';
    this.altClose = '</tool_call>';
    this.buffer = '';
    this.mode = 'text';
    this.toolIndex = 0;
    this.currentId = '';
  }

  push(text) {
    this.buffer += text || '';
    const events = [];
    let again = true;
    while (again) again = this.mode === 'text' ? this.handleText(events) : this.handleTool(events);
    return events;
  }

  end() {
    const events = [];
    if (this.buffer && this.mode === 'text') events.push({ type: 'delta', text: this.buffer });
    if (this.buffer && this.mode === 'tool') events.push({ type: 'tool_delta', id: this.currentId, index: this.toolIndex, arguments: this.buffer });
    this.buffer = '';
    return events;
  }

  handleText(events) {
    const match = this.openRegex.exec(this.buffer);
    if (match) {
      const before = this.buffer.slice(0, match.index);
      if (before) events.push({ type: 'delta', text: before });
      this.currentId = 'call_' + Date.now() + '_' + this.toolIndex;
      events.push({ type: 'tool_start', id: this.currentId, index: this.toolIndex, name: match[1] || 'unknown_tool' });
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.mode = 'tool';
      return true;
    }
    const pending = this.buffer.indexOf(this.openPrefix);
    if (pending >= 0) {
      const before = this.buffer.slice(0, pending);
      if (before) events.push({ type: 'delta', text: before });
      this.buffer = this.buffer.slice(pending);
      return false;
    }
    const keep = tailPrefixLen(this.buffer, [this.openPrefix, '<tool_call']);
    const emit = this.buffer.slice(0, this.buffer.length - keep);
    if (emit) events.push({ type: 'delta', text: emit });
    this.buffer = this.buffer.slice(this.buffer.length - keep);
    return false;
  }

  handleTool(events) {
    const nonceCloseIndex = this.buffer.indexOf(this.close);
    const altCloseIndex = this.buffer.indexOf(this.altClose);
    let closeIndex = -1;
    let closeLen = 0;
    if (nonceCloseIndex >= 0 && (altCloseIndex < 0 || nonceCloseIndex <= altCloseIndex)) {
      closeIndex = nonceCloseIndex;
      closeLen = this.close.length;
    } else if (altCloseIndex >= 0) {
      closeIndex = altCloseIndex;
      closeLen = this.altClose.length;
    }

    if (closeIndex >= 0) {
      const args = this.buffer.slice(0, closeIndex);
      if (args) events.push({ type: 'tool_delta', id: this.currentId, index: this.toolIndex, arguments: args });
      events.push({ type: 'tool_done', id: this.currentId, index: this.toolIndex });
      this.buffer = this.buffer.slice(closeIndex + closeLen);
      this.toolIndex++;
      this.currentId = '';
      this.mode = 'text';
      return true;
    }

    const keep = this.findSafeJsonCutPoint(this.buffer);
    if (keep < this.buffer.length) {
      const emit = this.buffer.slice(0, this.buffer.length - keep);
      if (emit) events.push({ type: 'tool_delta', id: this.currentId, index: this.toolIndex, arguments: emit });
      this.buffer = this.buffer.slice(this.buffer.length - keep);
    }
    return false;
  }

  findSafeJsonCutPoint(buf) {
    if (buf.length < 20) return buf.length;
    let inString = false;
    let escaped = false;
    let lastSafe = 0;
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        if (!inString) lastSafe = i + 1;
        continue;
      }
      if (!inString && (ch === ',' || ch === ']' || ch === '}')) {
        lastSafe = i + 1;
      }
    }
    const keep = buf.length - lastSafe;
    return Math.min(keep, 200);
  }
}

module.exports = { 工具调用流解析器 };