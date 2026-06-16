const 日志 = require('./日志');

/**
 * 配置验证工具
 * 在启动时验证配置完整性，防止配置错误导致运行时崩溃
 */

/**
 * 验证必需字段
 */
function 验证必需字段(配置) {
  const 错误 = [];

  // 验证端口
  if (!Number.isInteger(配置.端口) || 配置.端口 < 1 || 配置.端口 > 65535) {
    错误.push('端口必须是1-65535之间的整数，当前: ' + 配置.端口);
  }

  // 验证API Key
  if (!配置.apiKey || typeof 配置.apiKey !== 'string') {
    错误.push('apiKey必须是非空字符串');
  }

  // 验证xstech账号
  if (!Array.isArray(配置.xstech.账号列表) || 配置.xstech.账号列表.length === 0) {
    错误.push('xstech.账号列表必须是非空数组');
  } else {
    for (let i = 0; i < 配置.xstech.账号列表.length; i++) {
      const acc = 配置.xstech.账号列表[i];
      if (!acc.account || !acc.password) {
        错误.push(`xstech.账号列表[${i}] 缺少account或password字段`);
      }
    }
  }

  // 验证xstech基础地址
  if (!配置.xstech.基础地址 || typeof 配置.xstech.基础地址 !== 'string') {
    错误.push('xstech.基础地址必须是非空字符串');
  } else if (!/^https?:\/\/.+/.test(配置.xstech.基础地址)) {
    错误.push('xstech.基础地址必须是有效的HTTP/HTTPS URL，当前: ' + 配置.xstech.基础地址);
  }

  return 错误;
}

/**
 * 验证数值范围
 */
function 验证数值范围(配置) {
  const 警告 = [];

  // 会话池配置
  if (配置.会话池.池大小下限 < 1) {
    警告.push('会话池.池大小下限建议 >= 1，当前: ' + 配置.会话池.池大小下限);
  }
  if (配置.会话池.池大小上限 < 配置.会话池.池大小下限) {
    警告.push('会话池.池大小上限应 >= 池大小下限，当前上限: ' + 配置.会话池.池大小上限 + ', 下限: ' + 配置.会话池.池大小下限);
  }
  if (配置.会话池.池大小上限 > 10000) {
    警告.push('会话池.池大小上限过大（>' + 配置.会话池.池大小上限 + '），可能导致性能问题');
  }

  // 模型刷新间隔
  if (配置.模型刷新间隔秒 < 60) {
    警告.push('模型刷新间隔秒建议 >= 60，当前: ' + 配置.模型刷新间隔秒);
  }

  // token刷新配置
  if (配置.token提前刷新秒 < 60) {
    警告.push('token提前刷新秒建议 >= 60，当前: ' + 配置.token提前刷新秒);
  }
  if (配置.token刷新检查间隔秒 < 10) {
    警告.push('token刷新检查间隔秒建议 >= 10，当前: ' + 配置.token刷新检查间隔秒);
  }

  // 误判检测文本长度限制
  if (配置.误判检测?.文本长度限制) {
    if (配置.误判检测.文本长度限制 < 100) {
      警告.push('误判检测.文本长度限制过小（<100），可能遗漏误判词，当前: ' + 配置.误判检测.文本长度限制);
    }
    if (配置.误判检测.文本长度限制 > 50000) {
      警告.push('误判检测.文本长度限制过大（>50000），可能影响性能，当前: ' + 配置.误判检测.文本长度限制);
    }
  }

  return 警告;
}

/**
 * 验证文件路径
 */
function 验证文件路径(配置) {
  const 警告 = [];

  // 检查路径是否为绝对路径（不推荐）
  const 路径字段 = [
    { name: '会话池.文件路径', value: 配置.会话池.文件路径 },
    { name: '模型映射文件路径', value: 配置.模型映射文件路径 },
    { name: '模型价格文件路径', value: 配置.模型价格文件路径 },
    { name: 'xstech.账号Token文件路径', value: 配置.xstech.账号Token文件路径 },
    { name: 'xstech.账号列表文件路径', value: 配置.xstech.账号列表文件路径 },
  ];

  for (const 字段 of 路径字段) {
    if (字段.value && typeof 字段.value === 'string') {
      if (字段.value.startsWith('/') || /^[a-zA-Z]:/.test(字段.value)) {
        警告.push(`${字段.name} 使用了绝对路径，建议使用相对路径: ${字段.value}`);
      }
    }
  }

  return 警告;
}

/**
 * 验证日志级别
 */
function 验证日志级别(配置) {
  const 合法级别 = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  if (!合法级别.includes(配置.日志级别)) {
    return [`日志级别必须是 ${合法级别.join('/')} 之一，当前: ${配置.日志级别}`];
  }
  return [];
}

/**
 * 主验证函数
 */
function 验证配置(配置) {
  const 错误 = [];
  const 警告 = [];

  // 必需字段验证（错误）
  错误.push(...验证必需字段(配置));

  // 数值范围验证（警告）
  警告.push(...验证数值范围(配置));

  // 文件路径验证（警告）
  警告.push(...验证文件路径(配置));

  // 日志级别验证（错误）
  错误.push(...验证日志级别(配置));

  return { 错误, 警告 };
}

/**
 * 打印验证结果并决定是否终止
 */
function 验证并报告(配置) {
  console.log('[配置验证] 开始验证配置...');
  
  const { 错误, 警告 } = 验证配置(配置);

  // 打印警告
  if (警告.length > 0) {
    console.warn('[配置验证] 发现 ' + 警告.length + ' 个警告:');
    警告.forEach((msg, i) => console.warn(`  ${i + 1}. ${msg}`));
  }

  // 打印错误
  if (错误.length > 0) {
    console.error('[配置验证] 发现 ' + 错误.length + ' 个错误:');
    错误.forEach((msg, i) => console.error(`  ${i + 1}. ${msg}`));
    console.error('[配置验证] 配置验证失败，请修复上述错误后重启');
    return false;
  }

  if (警告.length === 0) {
    console.log('[配置验证] 配置验证通过 ✓');
  } else {
    console.log('[配置验证] 配置验证通过（有警告）⚠');
  }
  
  return true;
}

module.exports = { 验证配置, 验证并报告 };
