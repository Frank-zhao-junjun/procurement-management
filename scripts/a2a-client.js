/**
 * A2A Agent 间通知服务
 * 
 * 当业务事件发生时，通过 A2A Scheduler 主动通知相关 Agent
 */

const http = require('http');

const SCHEDULER_URL = process.env.A2A_SCHEDULER_URL || 'http://localhost:8000';
const TIMEOUT = 10000;

// 调用 A2A Scheduler API
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
        'User-Agent': 'ProcurementSystem-A2A/1.0',
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

    req.on('error', reject);
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
 * 向指定 Agent 发送通知
 * 
 * @param {string} agentName - 目标 Agent 名称
 * @param {string} skill - 技能名称（用于路由）
 * @param {object} payload - 通知内容
 */
async function notifyAgent(agentName, skill, payload) {
  try {
    const result = await callScheduler('/tasks/send', 'POST', {
      agent: agentName,
      skill: skill,
      input: {
        type: 'notification',
        ...payload,
      },
    });
    
    console.log(`[A2A] Notification sent to ${agentName}:`, result);
    return { success: true, result };
  } catch (error) {
    console.error(`[A2A] Failed to notify ${agentName}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 向指定角色的所有 Agent 广播通知
 * 
 * @param {string} role - 角色名称 (manager/buyer/requester)
 * @param {string} skill - 技能名称
 * @param {object} payload - 通知内容
 */
async function broadcastToRole(role, skill, payload) {
  try {
    // 获取所有 Agent
    const agents = await callScheduler('/registry/agents', 'GET');
    
    if (!Array.isArray(agents)) {
      console.log('[A2A] No agents registered');
      return { success: false, error: 'No agents registered' };
    }

    // 查找对应角色的 Agent
    const roleAgents = agents.filter(a => 
      a.name.includes(role) || 
      a.description?.includes(`role:${role}`)
    );

    if (roleAgents.length === 0) {
      console.log(`[A2A] No agents found for role: ${role}`);
      return { success: false, error: `No agents for role: ${role}` };
    }

    // 广播通知
    const results = await Promise.all(
      roleAgents.map(agent => 
        notifyAgent(agent.name, skill, {
          ...payload,
          targetRole: role,
        })
      )
    );

    return { success: true, results };
  } catch (error) {
    console.error(`[A2A] Broadcast failed:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 执行链式通知
 * 
 * @param {string[]} agents - Agent 名称数组
 * @param {string} skill - 技能名称
 * @param {object} payload - 初始通知内容
 */
async function chainNotification(agents, skill, payload) {
  try {
    const result = await callScheduler('/workflow/chain', 'POST', {
      agents: agents,
      input: {
        type: 'chain_notification',
        ...payload,
      },
    });
    
    console.log(`[A2A] Chain notification completed:`, result);
    return { success: true, result };
  } catch (error) {
    console.error(`[A2A] Chain notification failed:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 检查 A2A Scheduler 是否可用
 */
async function checkSchedulerHealth() {
  try {
    const result = await callScheduler('/health', 'GET');
    return result.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * 获取所有已注册的 Agent
 */
async function listAgents() {
  try {
    const agents = await callScheduler('/registry/agents', 'GET');
    return Array.isArray(agents) ? agents : [];
  } catch (error) {
    console.error('[A2A] Failed to list agents:', error.message);
    return [];
  }
}

module.exports = {
  notifyAgent,
  broadcastToRole,
  chainNotification,
  checkSchedulerHealth,
  listAgents,
};
