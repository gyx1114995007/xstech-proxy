function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tailPrefixLen(buffer, tags) {
  let best = 0;
  for (const tag of tags) {
    const maxLen = Math.min(tag.length - 1, buffer.length);
    for (let len = maxLen; len > 0; len--) {
      if (buffer.endsWith(tag.slice(0, len))) {
        best = Math.max(best, len);
        break;
      }
    }
  }
  return best;
}

function scanJsonEnd(buffer) {
  let depth = 0, inString = false, escaped = false, started = false;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') { depth++; started = true; }
    else if (ch === '}') {
      depth--;
      if (started && depth === 0) return i + 1;
    }
  }
  return -1;
}

module.exports = { escapeRegExp, tailPrefixLen, scanJsonEnd };