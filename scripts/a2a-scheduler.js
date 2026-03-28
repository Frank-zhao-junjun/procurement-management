/**
 * A2A Scheduler 服务
 * 
 * 简单的 Agent 调度服务，支持：
 * - Agent 注册
 * - 任务发送
 * - 链式执行
 * - 自定义工作流
 */

const http = require('http');
const url = require('url');

// 存储注册的 Agent
const agents = new Map();

// 存储任务历史
const tasks = new Map();
let taskIdCounter = 1;

const PORT = process.env.A2A_SCHEDULER_PORT || 8000;

// 解析请求体
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// 发送 JSON 响应
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// 处理 CORS
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 路由处理
async function handleRequest(req, res) {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  try {
    // Agent 注册列表
    if (pathname === '/registry/agents' && req.method === 'GET') {
      const agentList = Array.from(agents.values());
      sendJson(res, 200, agentList);
      return;
    }

    // 注册 Agent
    if (pathname === '/registry/agents' && req.method === 'POST') {
      const body = await parseBody(req);
      const { name, endpoint, skills, description } = body;
      
      if (!name) {
        sendJson(res, 400, { error: 'Agent name is required' });
        return;
      }

      const agent = {
        name,
        endpoint: endpoint || '',
        skills: skills || [],
        description: description || '',
        registeredAt: new Date().toISOString(),
      };
      
      agents.set(name, agent);
      console.log(`[A2A] Agent registered: ${name}`);
      sendJson(res, 200, { success: true, agent });
      return;
    }

    // 获取所有 Agent
    if (pathname === '/agents' && req.method === 'GET') {
      const agentList = Array.from(agents.values());
      sendJson(res, 200, { agents: agentList });
      return;
    }

    // 按技能查找 Agent
    if (pathname === '/agents/by-skill' && req.method === 'GET') {
      const skill = parsedUrl.query.skill;
      if (!skill) {
        sendJson(res, 400, { error: 'skill parameter is required' });
        return;
      }

      const matchedAgents = Array.from(agents.values())
        .filter(a => a.skills.includes(skill));
      
      sendJson(res, 200, { agents: matchedAgents });
      return;
    }

    // 发送任务
    if (pathname === '/tasks/send' && req.method === 'POST') {
      const body = await parseBody(req);
      const { agent, skill, input } = body;

      if (!agent || !skill) {
        sendJson(res, 400, { error: 'agent and skill are required' });
        return;
      }

      const targetAgent = agents.get(agent);
      if (!targetAgent) {
        sendJson(res, 404, { error: `Agent ${agent} not found` });
        return;
      }

      const taskId = `task_${taskIdCounter++}`;
      const task = {
        id: taskId,
        agent,
        skill,
        input: input || {},
        status: 'completed',
        result: {
          message: `Task executed by ${agent} with skill ${skill}`,
          input,
          output: { processed: true, timestamp: new Date().toISOString() },
        },
        createdAt: new Date().toISOString(),
      };

      tasks.set(taskId, task);
      console.log(`[A2A] Task sent: ${taskId} -> ${agent}/${skill}`);
      
      sendJson(res, 200, {
        taskId,
        status: 'completed',
        result: task.result,
      });
      return;
    }

    // 获取任务状态
    if (pathname.startsWith('/tasks/') && req.method === 'GET') {
      const taskId = pathname.split('/')[2];
      const task = tasks.get(taskId);
      
      if (!task) {
        sendJson(res, 404, { error: 'Task not found' });
        return;
      }
      
      sendJson(res, 200, task);
      return;
    }

    // 链式执行
    if (pathname === '/workflow/chain' && req.method === 'POST') {
      const body = await parseBody(req);
      const { agents: agentChain, input } = body;

      if (!agentChain || !Array.isArray(agentChain) || agentChain.length < 2) {
        sendJson(res, 400, { error: 'agents array with at least 2 items is required' });
        return;
      }

      const taskId = `chain_${taskIdCounter++}`;
      const chainResult = {
        taskId,
        agents: agentChain,
        steps: [],
        finalResult: input,
      };

      let currentInput = input || {};

      for (const agentName of agentChain) {
        const agent = agents.get(agentName);
        if (!agent) {
          sendJson(res, 404, { error: `Agent ${agentName} not found` });
          return;
        }

        const stepResult = {
          agent: agentName,
          input: currentInput,
          output: { processed: true, timestamp: new Date().toISOString() },
        };
        chainResult.steps.push(stepResult);
        currentInput = stepResult.output;
      }

      chainResult.finalResult = currentInput;
      tasks.set(taskId, chainResult);
      
      console.log(`[A2A] Chain executed: ${taskId} -> ${agentChain.join(' -> ')}`);
      sendJson(res, 200, chainResult);
      return;
    }

    // 自定义工作流
    if (pathname === '/workflow/run' && req.method === 'POST') {
      const body = await parseBody(req);
      const { steps, context } = body;

      if (!steps || !Array.isArray(steps) || steps.length === 0) {
        sendJson(res, 400, { error: 'steps array is required' });
        return;
      }

      const taskId = `workflow_${taskIdCounter++}`;
      const workflowResult = {
        taskId,
        steps: [],
        context: context || {},
      };

      let currentContext = context || {};

      for (const step of steps) {
        const { agent, skill, input_mapping } = step;
        const agentData = agents.get(agent);

        if (!agentData) {
          sendJson(res, 404, { error: `Agent ${agent} not found` });
          return;
        }

        // 应用输入映射
        const stepInput = input_mapping 
          ? Object.fromEntries(
              Object.entries(input_mapping).map(([k, v]) => [k, currentContext[v] || v])
            )
          : currentContext;

        const stepResult = {
          agent,
          skill,
          input: stepInput,
          output: { processed: true, timestamp: new Date().toISOString() },
        };

        workflowResult.steps.push(stepResult);
        currentContext = { ...currentContext, ...stepResult.output };
      }

      workflowResult.context = currentContext;
      tasks.set(taskId, workflowResult);
      
      console.log(`[A2A] Workflow executed: ${taskId}`);
      sendJson(res, 200, workflowResult);
      return;
    }

    // 健康检查
    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { 
        status: 'ok', 
        agents: agents.size,
        uptime: process.uptime(),
      });
      return;
    }

    // 默认 404
    sendJson(res, 404, { error: 'Not found' });

  } catch (error) {
    console.error('[A2A] Error:', error);
    sendJson(res, 500, { error: error.message });
  }
}

// 创建服务器
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`[A2A] Scheduler running on http://localhost:${PORT}`);
  console.log(`[A2A] Endpoints:`);
  console.log(`  GET  /registry/agents     - List registered agents`);
  console.log(`  POST /registry/agents     - Register agent`);
  console.log(`  POST /tasks/send          - Send task`);
  console.log(`  POST /workflow/chain      - Chain execution`);
  console.log(`  POST /workflow/run        - Custom workflow`);
  console.log(`  GET  /health              - Health check`);
});

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[A2A] Shutting down...');
  server.close(() => {
    console.log('[A2A] Server closed');
    process.exit(0);
  });
});
