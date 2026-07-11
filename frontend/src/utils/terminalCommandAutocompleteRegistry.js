function createArg(provider, config = {}) {
  return {
    provider,
    repeat: false,
    ...config,
  }
}

function createNode(name, config = {}) {
  return {
    name,
    description: '',
    children: [],
    args: [],
    ...config,
  }
}

const CHMOD_MODE_ITEMS = [
  { value: '644', description: '普通文件常用：所有者可写，其余只读' },
  { value: '600', description: '私有文件常用：仅所有者可读写' },
  { value: '755', description: '目录常用：所有者可写，其余可读可执行' },
  { value: '700', description: '私有目录常用：仅所有者可访问' },
  { value: '775', description: '协作目录常用：同组可写' },
  { value: '664', description: '协作文件常用：同组可写' },
  { value: '666', description: '所有人可读写，通常不建议' },
  { value: '777', description: '所有人完全可写，风险较高' },
  { value: '1777', description: '共享临时目录常用：公开可写但受粘滞位保护' },
]

export const ROOT_COMMAND_REGISTRY = [
  createNode('cd', {
    description: '切换目录',
    args: [
      createArg('path', {
        directoryOnly: true,
      }),
    ],
  }),
  createNode('ls', {
    description: '列出目录内容',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('pwd', {
    description: '显示当前目录',
  }),
  createNode('cat', {
    description: '查看文件内容',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('less', {
    description: '分页查看文件',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('tail', {
    description: '查看文件尾部',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('grep', {
    description: '文本过滤',
  }),
  createNode('find', {
    description: '查找文件',
    args: [
      createArg('path'),
    ],
  }),
  createNode('chmod', {
    description: '修改权限',
    args: [
      createArg('literal', {
        badge: '权限',
        items: CHMOD_MODE_ITEMS,
      }),
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('chown', {
    description: '修改属主属组',
  }),
  createNode('cp', {
    description: '复制文件或目录',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('mv', {
    description: '移动或重命名',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('rm', {
    description: '删除文件或目录',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('mkdir', {
    description: '创建目录',
    args: [
      createArg('path', {
        directoryOnly: true,
        repeat: true,
      }),
    ],
  }),
  createNode('touch', {
    description: '创建空文件或更新时间戳',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('tar', {
    description: '归档打包',
  }),
  createNode('unzip', {
    description: '解压 zip',
  }),
  createNode('zip', {
    description: '创建 zip',
  }),
  createNode('systemctl', {
    description: 'systemd 服务管理',
    children: [
      createNode('status'),
      createNode('start'),
      createNode('stop'),
      createNode('restart'),
      createNode('reload'),
      createNode('enable'),
      createNode('disable'),
      createNode('daemon-reload'),
      createNode('list-units'),
      createNode('list-unit-files'),
    ],
  }),
  createNode('journalctl', {
    description: '查看 systemd 日志',
  }),
  createNode('ps', {
    description: '查看进程',
  }),
  createNode('top', {
    description: '进程监视器',
  }),
  createNode('htop', {
    description: '进程监视器',
  }),
  createNode('df', {
    description: '磁盘使用情况',
  }),
  createNode('du', {
    description: '目录占用统计',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('free', {
    description: '内存使用情况',
  }),
  createNode('uname', {
    description: '系统信息',
  }),
  createNode('ping', {
    description: '网络连通性测试',
  }),
  createNode('curl', {
    description: 'HTTP 请求工具',
  }),
  createNode('wget', {
    description: '下载工具',
  }),
  createNode('ssh', {
    description: 'SSH 客户端',
  }),
  createNode('scp', {
    description: '远程复制工具',
  }),
  createNode('vim', {
    description: '文本编辑器',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('nano', {
    description: '文本编辑器',
    args: [
      createArg('path', {
        repeat: true,
      }),
    ],
  }),
  createNode('git', {
    description: 'Git 命令集',
    children: [
      createNode('status'),
      createNode('checkout'),
      createNode('switch'),
      createNode('branch'),
      createNode('pull'),
      createNode('push'),
      createNode('fetch'),
      createNode('merge'),
      createNode('rebase'),
      createNode('diff'),
      createNode('log'),
      createNode('show'),
      createNode('add'),
      createNode('commit'),
      createNode('reset'),
      createNode('restore'),
      createNode('stash'),
      createNode('remote', {
        children: [
          createNode('add'),
          createNode('remove'),
          createNode('set-url'),
          createNode('show'),
          createNode('rename'),
          createNode('prune'),
          createNode('get-url'),
        ],
      }),
    ],
  }),
  createNode('docker', {
    description: 'Docker 命令集',
    children: [
      createNode('ps'),
      createNode('images'),
      createNode('logs'),
      createNode('exec'),
      createNode('run'),
      createNode('stop'),
      createNode('start'),
      createNode('restart'),
      createNode('rm'),
      createNode('rmi'),
      createNode('pull'),
      createNode('build'),
      createNode('inspect'),
      createNode('compose', {
        children: [
          createNode('up'),
          createNode('down'),
          createNode('ps'),
          createNode('logs'),
          createNode('exec'),
          createNode('build'),
          createNode('pull'),
          createNode('config'),
        ],
      }),
    ],
  }),
]

const ROOT_COMMAND_MAP = new Map(ROOT_COMMAND_REGISTRY.map((node) => [node.name, node]))

function resolveArgRule(node, argIndex) {
  if (!node || !Array.isArray(node.args) || argIndex < 0 || node.args.length === 0) {
    return null
  }

  if (argIndex < node.args.length) {
    return node.args[argIndex]
  }

  const lastArg = node.args[node.args.length - 1]
  return lastArg?.repeat ? lastArg : null
}

export function getBuiltinCommandNames() {
  return ROOT_COMMAND_REGISTRY.map((node) => node.name)
}

export function resolveAutocompletePlan(context) {
  if (!context || context.currentTokenIndex === 0) {
    return {
      kind: 'root-command',
      chainPath: [],
      node: null,
    }
  }

  if (!context.commandLower) {
    return {
      kind: 'root-command',
      chainPath: [],
      node: null,
    }
  }

  const rootNode = ROOT_COMMAND_MAP.get(context.commandLower)
  if (!rootNode) {
    return {
      kind: 'none',
      chainPath: [context.commandLower],
      node: null,
    }
  }

  let activeNode = rootNode
  let resolvedDepth = 1
  const chainPath = [rootNode.name]

  while (resolvedDepth < context.currentTokenIndex && Array.isArray(activeNode.children) && activeNode.children.length > 0) {
    const token = context.tokens[resolvedDepth]
    const matchedChild = activeNode.children.find((child) => child.name === token?.lowerText)
    if (!matchedChild) {
      break
    }
    activeNode = matchedChild
    chainPath.push(matchedChild.name)
    resolvedDepth += 1
  }

  if (Array.isArray(activeNode.children) && activeNode.children.length > 0 && context.currentTokenIndex === resolvedDepth) {
    return {
      kind: 'child-command',
      node: activeNode,
      chainPath,
    }
  }

  const argIndex = context.currentTokenIndex - resolvedDepth
  const argRule = resolveArgRule(activeNode, argIndex)
  if (argRule) {
    return {
      kind: 'arg-provider',
      node: activeNode,
      argRule,
      argIndex,
      chainPath,
    }
  }

  return {
    kind: 'none',
    node: activeNode,
    chainPath,
  }
}