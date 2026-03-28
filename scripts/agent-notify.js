/**
 * Agent 通知服务（Node.js 客户端）
 * 
 * 在业务事件发生时，通过 A2A Scheduler 通知相关 Agent
 */

const http = require('http');

const SCHEDULER_URL = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';
const TIMEOUT = 10000;

/**
 * 调用 A2A Scheduler API
 */
async function callScheduler(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SCHEDULER_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ProcurementSystem/1.0',
      },
      timeout: TIMEOUT,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * 检查 Scheduler 是否可用
 */
async function isSchedulerAvailable() {
  try {
    const result = await callScheduler('/health', 'GET');
    return result.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * 向指定 Agent 发送通知
 * @param {string} agentName - Agent 名称
 * @param {object} notification - 通知内容
 */
async function notifyAgent(agentName, notification) {
  try {
    const result = await callScheduler('/tasks/send', 'POST', {
      agent: agentName,
      skill: 'receive_notification',
      input: {
        ...notification,
        _timestamp: new Date().toISOString(),
      },
    });
    
    console.log(`[AgentNotify] Sent to ${agentName}:`, result.taskId || 'OK');
    return { success: true };
  } catch (error) {
    console.error(`[AgentNotify] Failed to notify ${agentName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 获取所有 Agent
 */
async function getAllAgents() {
  try {
    const agents = await callScheduler('/registry/agents', 'GET');
    return Array.isArray(agents) ? agents : [];
  } catch (error) {
    console.error('[AgentNotify] Failed to get agents:', error.message);
    return [];
  }
}

/**
 * 按名称模式查找 Agent
 */
async function findAgentsByName(pattern) {
  const agents = await getAllAgents();
  return agents.filter(a => a.name.includes(pattern));
}

/**
 * 向所有 Manager Agent 发送通知
 */
async function notifyAllManagers(notification) {
  const managers = await findAgentsByName('manager');
  
  if (managers.length === 0) {
    console.log('[AgentNotify] No manager agents found');
    return { success: false, reason: 'No managers' };
  }

  const results = await Promise.all(
    managers.map(m => notifyAgent(m.name, {
      ...notification,
      _targetRole: 'manager',
    }))
  );

  return { success: true, notified: results.filter(r => r.success).length };
}

/**
 * 向所有 Requester Agent 发送通知
 */
async function notifyAllRequesters(notification) {
  const requesters = await findAgentsByName('requester');
  
  if (requesters.length === 0) {
    console.log('[AgentNotify] No requester agents found');
    return { success: false, reason: 'No requesters' };
  }

  const results = await Promise.all(
    requesters.map(a => notifyAgent(a.name, {
      ...notification,
      _targetRole: 'requester',
    }))
  );

  return { success: true, notified: results.filter(r => r.success).length };
}

/**
 * 向所有 Buyer Agent 发送通知
 */
async function notifyAllBuyers(notification) {
  const buyers = await findAgentsByName('buyer');
  
  if (buyers.length === 0) {
    console.log('[AgentNotify] No buyer agents found');
    return { success: false, reason: 'No buyers' };
  }

  const results = await Promise.all(
    buyers.map(b => notifyAgent(b.name, {
      ...notification,
      _targetRole: 'buyer',
    }))
  );

  return { success: true, notified: results.filter(r => r.success).length };
}

/**
 * 链式通知：按顺序通知多个 Agent
 */
async function chainNotify(agentNames, notification) {
  try {
    const result = await callScheduler('/workflow/chain', 'POST', {
      agents: agentNames,
      input: {
        ...notification,
        _type: 'chain_notification',
      },
    });
    
    console.log('[AgentNotify] Chain completed:', result.taskId);
    return { success: true, result };
  } catch (error) {
    console.error('[AgentNotify] Chain failed:', error.message);
    return { success: false, error: error.message };
  }
}

// 导出函数
module.exports = {
  isSchedulerAvailable,
  notifyAgent,
  getAllAgents,
  findAgentsByName,
  notifyAllManagers,
  notifyAllRequesters,
  notifyAllBuyers,
  chainNotify,
};
