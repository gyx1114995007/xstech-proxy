function pushSchemaScalar(lines, indent, key, value) {
  if (value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    lines.push(indent + key + ': ' + String(value));
    return;
  }
  lines.push(indent + key + ': ' + JSON.stringify(value));
}

function compileSchemaNodeToLines(schema, indent = '') {
  if (schema === null) return [indent + String(null)];
  if (schema === undefined) return [indent + 'undefined'];
  if (typeof schema !== 'object') return [indent + String(schema)];

  const node = schema;
  const lines = [];
  const scalarKeys = [
    'type', 'description', 'default', 'format', 'title', 'const', 'nullable',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems',
    'uniqueItems', 'minProperties', 'maxProperties', 'additionalProperties'
  ];

  for (const key of scalarKeys) {
    if (Object.prototype.hasOwnProperty.call(node, key)) pushSchemaScalar(lines, indent, key, node[key]);
  }

  const arrayKeys = ['required', 'enum', 'examples'];
  for (const key of arrayKeys) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    lines.push(indent + key + ':');
    for (const item of value) {
      if (item && typeof item === 'object') {
        lines.push(indent + '  -');
        lines.push(...compileSchemaNodeToLines(item, indent + '    '));
      } else {
        lines.push(indent + '  - ' + String(item));
      }
    }
  }

  const objectKeys = ['properties', '$defs', 'definitions'];
  for (const key of objectKeys) {
    const value = node[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    lines.push(indent + key + ':');
    for (const [childKey, childValue] of Object.entries(value)) {
      lines.push(indent + '  ' + childKey + ':');
      lines.push(...compileSchemaNodeToLines(childValue, indent + '    '));
    }
  }

  if (Object.prototype.hasOwnProperty.call(node, 'items')) {
    lines.push(indent + 'items:');
    lines.push(...compileSchemaNodeToLines(node.items, indent + '  '));
  }

  const compositionKeys = ['oneOf', 'anyOf', 'allOf'];
  for (const key of compositionKeys) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    lines.push(indent + key + ':');
    value.forEach((item, index) => {
      lines.push(indent + '  - variant_' + (index + 1) + ':');
      lines.push(...compileSchemaNodeToLines(item, indent + '      '));
    });
  }

  const known = new Set([...scalarKeys, ...arrayKeys, ...objectKeys, 'items', ...compositionKeys]);
  for (const key of Object.keys(node).filter(k => !known.has(k))) {
    const value = node[key];
    if (value && typeof value === 'object') {
      lines.push(indent + key + ':');
      lines.push(...compileSchemaNodeToLines(value, indent + '  '));
    } else {
      pushSchemaScalar(lines, indent, key, value);
    }
  }

  return lines.length > 0 ? lines : [indent + '{}'];
}

function compileGenericStructureToLines(value, indent = '') {
  return compileSchemaNodeToLines(value, indent);
}

module.exports = { compileSchemaNodeToLines, compileGenericStructureToLines };
