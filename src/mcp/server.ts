/**
 * MCP Server - 采购管理系统
 * 
 * 基于 Model Context Protocol (MCP) 的工具服务
 * 供 Coze Agent 调用
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { loadEnv } from '@/storage/database/supabase-client';
import { runWithMcpIdentity, getMcpIdentity } from './context';
import {
  verifyMcpBearer,
  isMcpAuthConfigured,
  MCP_DEV_FALLBACK,
  type McpAuthContext,
} from './auth';
import { canInvokeTool } from './tool-policy';
import { logMcpToolCall } from './audit';

// 导入工具实现
import * as procurementTools from './tools/procurement';

loadEnv();

// MCP Server 配置
const MCP_PORT = parseInt(process.env.MCP_SERVER_PORT || '5001', 10);
const MCP_HOST = process.env.MCP_SERVER_HOST || '0.0.0.0';

// 创建 MCP Server
const server = new McpServer({
  name: 'procurement-mcp',
  version: '1.0.0',
});

function registerProcurementTool(
  name: string,
  config: { description: string; inputSchema: z.ZodType },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<{ content: Array<{ type: string; text: string }> }>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(name, config, async (args: any) => {
    const id = getMcpIdentity();
    if (!id) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'mcp_identity_missing' }) }],
      };
    }
    const ctx: McpAuthContext = {
      agentId: id.agentId,
      role: id.role,
      bindingId: id.bindingId,
    };
    if (!canInvokeTool(ctx.role, name)) {
      await logMcpToolCall({
        ctx,
        toolName: name,
        ok: false,
        detail: { reason: 'forbidden' },
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'forbidden', tool: name }) }],
      };
    }
    try {
      const out = await handler(args);
      await logMcpToolCall({ ctx, toolName: name, ok: true, detail: {} });
      return out;
    } catch (e) {
      await logMcpToolCall({
        ctx,
        toolName: name,
        ok: false,
        detail: { message: (e as Error).message },
      });
      throw e;
    }
  });
}

// ============ 注册工具 ============

// 物料工具
registerProcurementTool('match_material', {
  description: '检查物料是否已存在，返回匹配结果和建议操作',
  inputSchema: z.object({
    text: z.string().describe('物料名称或描述'),
  }),
}, async ({ text }: { text: string }) => {
  const result = await procurementTools.matchMaterial(text);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('list_materials', {
  description: '查询物料列表',
  inputSchema: z.object({
    search: z.string().optional().describe('搜索关键词'),
    isActive: z.boolean().optional().describe('是否只查询启用状态'),
  }),
}, async ({ search, isActive }: { search?: string; isActive?: boolean }) => {
  const result = await procurementTools.listMaterials({ search, isActive });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('create_material', {
  description: '创建新物料',
  inputSchema: z.object({
    code: z.string().describe('物料编码'),
    name: z.string().describe('物料名称'),
    unit: z.string().describe('单位'),
    isActive: z.boolean().optional().describe('是否启用'),
    actor: z.string().optional().describe('操作人'),
  }),
}, async (args: { code: string; name: string; unit: string; isActive?: boolean; actor?: string }) => {
  const result = await procurementTools.createMaterial(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 供应商工具
registerProcurementTool('list_suppliers', {
  description: '查询供应商列表',
  inputSchema: z.object({
    search: z.string().optional().describe('搜索关键词'),
    isActive: z.boolean().optional().describe('是否只查询启用状态'),
  }),
}, async ({ search, isActive }: { search?: string; isActive?: boolean }) => {
  const result = await procurementTools.listSuppliers({ search, isActive });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('create_supplier', {
  description: '创建新供应商',
  inputSchema: z.object({
    code: z.string().describe('供应商编码'),
    name: z.string().describe('供应商名称'),
    contact: z.string().optional().describe('联系人'),
    email: z.string().optional().describe('邮箱'),
    phone: z.string().optional().describe('电话'),
    address: z.string().optional().describe('地址'),
    note: z.string().optional().describe('备注'),
    isActive: z.boolean().optional().describe('是否启用'),
    actor: z.string().optional().describe('操作人'),
  }),
}, async (args: { code: string; name: string; contact?: string; email?: string; phone?: string; address?: string; note?: string; isActive?: boolean; actor?: string }) => {
  const result = await procurementTools.createSupplier(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 采购申请工具
registerProcurementTool('create_purchase_request', {
  description: '创建采购申请',
  inputSchema: z.object({
    reason: z.string().describe('采购原因'),
    lines: z.array(z.object({
      requirementText: z.string().describe('需求描述'),
      quantity: z.number().describe('数量'),
      estUnitPrice: z.number().optional().describe('预估单价'),
    })).describe('采购行列表'),
    actor: z.string().optional().describe('申请人'),
  }),
}, async (args: { reason: string; lines: Array<{ requirementText: string; quantity: number; estUnitPrice?: number }>; actor?: string }) => {
  const result = await procurementTools.createPurchaseRequest(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('list_purchase_requests', {
  description: '查询采购申请列表',
  inputSchema: z.object({
    status: z.string().optional().describe('状态筛选'),
    page: z.number().optional().describe('页码'),
    pageSize: z.number().optional().describe('每页数量'),
  }),
}, async ({ status, page, pageSize }: { status?: string; page?: number; pageSize?: number }) => {
  const result = await procurementTools.listPurchaseRequests({ status, page, pageSize });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('submit_purchase_request', {
  description: '提交采购申请',
  inputSchema: z.object({
    prId: z.number().describe('采购申请ID'),
  }),
}, async ({ prId }: { prId: number }) => {
  const result = await procurementTools.submitPurchaseRequest(prId);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 寻源任务工具
registerProcurementTool('create_sourcing_task', {
  description: '创建寻源任务',
  inputSchema: z.object({
    prId: z.number().describe('采购申请ID'),
    prLineId: z.number().optional().describe('采购申请行ID'),
    requirementText: z.string().describe('需求描述'),
    dueDate: z.string().optional().describe('截止日期'),
    actor: z.string().optional().describe('操作人'),
  }),
}, async (args: { prId: number; prLineId?: number; requirementText: string; dueDate?: string; actor?: string }) => {
  const result = await procurementTools.createSourcingTask(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('list_sourcing_tasks', {
  description: '查询寻源任务列表',
  inputSchema: z.object({
    status: z.string().optional().describe('状态筛选'),
    prId: z.number().optional().describe('采购申请ID'),
  }),
}, async ({ status, prId }: { status?: string; prId?: number }) => {
  const result = await procurementTools.listSourcingTasks({ status, prId });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('get_pending_sourcing', {
  description: '获取待寻源的采购申请行（FA匹配失败或需要寻源的PR行）',
  inputSchema: z.object({
    page: z.number().optional().describe('页码'),
    pageSize: z.number().optional().describe('每页数量'),
  }),
}, async ({ page, pageSize }: { page?: number; pageSize?: number }) => {
  const result = await procurementTools.getPendingSourcing({ page, pageSize });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('get_sourcing_task', {
  description: '获取寻源任务详情',
  inputSchema: z.object({
    taskId: z.number().describe('寻源任务ID'),
  }),
}, async ({ taskId }: { taskId: number }) => {
  const result = await procurementTools.getSourcingTask(taskId);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('update_sourcing_task', {
  description: '更新寻源任务（分配供应商、完成寻源等）',
  inputSchema: z.object({
    taskId: z.number().describe('寻源任务ID'),
    supplierId: z.number().optional().describe('供应商ID'),
    supplierSnapshot: z.string().optional().describe('供应商名称（当供应商ID不存在时使用）'),
    requirementText: z.string().optional().describe('需求描述'),
    dueDate: z.string().optional().describe('截止日期'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().describe('状态'),
    result: z.string().optional().describe('寻源结果说明'),
    complete: z.boolean().optional().describe('快捷完成（需先指定供应商）'),
    actor: z.string().optional().describe('操作人'),
  }),
}, async (args: { taskId: number; supplierId?: number; supplierSnapshot?: string; requirementText?: string; dueDate?: string; status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'; result?: string; complete?: boolean; actor?: string }) => {
  const result = await procurementTools.updateSourcingTask(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 报价单工具
registerProcurementTool('create_quote', {
  description: '创建报价单',
  inputSchema: z.object({
    sourcingTaskId: z.number().optional().describe('寻源任务ID'),
    supplierId: z.number().describe('供应商ID'),
    unitPrice: z.number().describe('单价'),
    quantity: z.number().describe('数量'),
    materialSnapshot: z.string().optional().describe('物料快照'),
    actor: z.string().optional().describe('操作人'),
  }),
}, async (args: { sourcingTaskId?: number; supplierId: number; unitPrice: number; quantity: number; materialSnapshot?: string; actor?: string }) => {
  const result = await procurementTools.createQuote(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('award_quote', {
  description: '授标报价单',
  inputSchema: z.object({
    quoteId: z.number().describe('报价单ID'),
  }),
}, async ({ quoteId }: { quoteId: number }) => {
  const result = await procurementTools.awardQuote(quoteId);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 采购订单工具
registerProcurementTool('create_purchase_order', {
  description: '创建采购订单',
  inputSchema: z.object({
    supplierId: z.number().describe('供应商ID'),
    supplierSnapshot: z.string().describe('供应商名称'),
    lines: z.array(z.object({
      prLineId: z.number().optional().describe('采购申请行ID'),
      materialSnapshot: z.string().describe('物料快照'),
      quantity: z.number().describe('数量'),
      unitPrice: z.number().describe('单价'),
    })).describe('订单行列表'),
    actor: z.string().optional().describe('操作人'),
  }),
}, async (args: { supplierId: number; supplierSnapshot: string; lines: Array<{ prLineId?: number; materialSnapshot: string; quantity: number; unitPrice: number }>; actor?: string }) => {
  const result = await procurementTools.createPurchaseOrder(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('send_purchase_order', {
  description: '发送采购订单',
  inputSchema: z.object({
    poId: z.number().describe('采购订单ID'),
  }),
}, async ({ poId }: { poId: number }) => {
  const result = await procurementTools.sendPurchaseOrder(poId);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('list_purchase_orders', {
  description: '查询采购订单列表',
  inputSchema: z.object({
    status: z.string().optional().describe('状态筛选'),
    supplierId: z.number().optional().describe('供应商ID'),
  }),
}, async ({ status, supplierId }: { status?: string; supplierId?: number }) => {
  const result = await procurementTools.listPurchaseOrders({ status, supplierId });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 收货工具
registerProcurementTool('create_goods_receipt', {
  description: '创建收货单',
  inputSchema: z.object({
    poLineId: z.number().describe('订单行ID'),
    quantity: z.number().describe('收货数量'),
    receiptDate: z.string().optional().describe('收货日期'),
    notes: z.string().optional().describe('备注'),
    actor: z.string().optional().describe('收货人'),
  }),
}, async (args: { poLineId: number; quantity: number; receiptDate?: string; notes?: string; actor?: string }) => {
  const result = await procurementTools.createGoodsReceipt(args);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

registerProcurementTool('list_goods_receipts', {
  description: '查询收货单列表',
  inputSchema: z.object({
    poId: z.number().optional().describe('订单ID'),
  }),
}, async ({ poId }: { poId?: number }) => {
  const result = await procurementTools.listGoodsReceipts({ poId });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 框架协议工具
registerProcurementTool('match_framework_agreement', {
  description: '查询框架协议匹配',
  inputSchema: z.object({
    materialId: z.number().optional().describe('物料ID'),
    requirementText: z.string().optional().describe('需求描述'),
    topN: z.number().optional().describe('返回条数'),
  }),
}, async ({ materialId, requirementText, topN }: { materialId?: number; requirementText?: string; topN?: number }) => {
  const result = await procurementTools.matchFrameworkAgreement({ materialId, requirementText, topN });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// ============ HTTP Server ============

const transports: Record<string, StreamableHTTPServerTransport> = {};
const connectedTransports = new Set<string>();
const sessionContexts: Record<string, McpAuthContext> = {};

async function resolveSessionContext(req: http.IncomingMessage): Promise<McpAuthContext> {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  if (sid && sessionContexts[sid]) {
    return sessionContexts[sid];
  }
  if (!isMcpAuthConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MCP_API_KEY_SECRET is required in production');
    }
    console.warn('[MCP] MCP_API_KEY_SECRET not set; using dev fallback identity');
    return MCP_DEV_FALLBACK;
  }
  return verifyMcpBearer(req.headers.authorization);
}

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, mcpsessionid, mcp-session-id',
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;
        let ctx: McpAuthContext;

        if (sessionIdHeader && transports[sessionIdHeader]) {
          if (!sessionContexts[sessionIdHeader]) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized');
            return;
          }
          ctx = sessionContexts[sessionIdHeader];
        } else {
          ctx = await resolveSessionContext(req);
        }

        let transport: StreamableHTTPServerTransport;

        if (sessionIdHeader && transports[sessionIdHeader]) {
          transport = transports[sessionIdHeader];
        } else {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          transports[transport.sessionId!] = transport;
          sessionContexts[transport.sessionId!] = ctx;
          transport.onclose = () => {
            const id = transport.sessionId!;
            delete transports[id];
            delete sessionContexts[id];
            connectedTransports.delete(id);
          };
        }

        if (!connectedTransports.has(transport.sessionId!)) {
          await server.connect(transport);
          connectedTransports.add(transport.sessionId!);
        }

        await runWithMcpIdentity(ctx, async () => {
          await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
        });
      } catch (error) {
        const msg = (error as Error).message;
        const unauthorized =
          msg.includes('Missing') ||
          msg.includes('Invalid') ||
          msg.includes('not registered') ||
          msg.includes('Inactive') ||
          msg.includes('inactive') ||
          msg.includes('expired') ||
          msg.includes('Unauthorized');
        const code = unauthorized ? 401 : 500;
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: msg }));
        }
      }
    });
    return;
  }

  if (req.method === 'GET') {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (!sessionId || !transports[sessionId] || !sessionContexts[sessionId]) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
    const ctx = sessionContexts[sessionId];
    void runWithMcpIdentity(ctx, async () => {
      try {
        await transports[sessionId].handleRequest(req, res);
      } catch (error) {
        console.error('Error handling GET request:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end((error as Error).message);
        }
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id'] as string;
    if (!sessionId || !transports[sessionId] || !sessionContexts[sessionId]) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
    const ctx = sessionContexts[sessionId];
    void runWithMcpIdentity(ctx, async () => {
      try {
        await transports[sessionId].handleRequest(req, res);
        delete transports[sessionId];
        delete sessionContexts[sessionId];
        connectedTransports.delete(sessionId);
      } catch (error) {
        console.error('Error handling DELETE request:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end((error as Error).message);
        }
      }
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method not allowed');
});

httpServer.listen(MCP_PORT, MCP_HOST, () => {
  console.log(`MCP Server running on ${MCP_HOST}:${MCP_PORT}`);
  console.log('Available tools: match_material, list_materials, create_material, list_suppliers, create_supplier, create_purchase_request, list_purchase_requests, submit_purchase_request, create_sourcing_task, list_sourcing_tasks, get_pending_sourcing, get_sourcing_task, update_sourcing_task, create_quote, award_quote, create_purchase_order, send_purchase_order, list_purchase_orders, create_goods_receipt, list_goods_receipts, match_framework_agreement');
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('Shutting down MCP Server...');
  for (const sessionId in transports) {
    await transports[sessionId].close();
  }
  httpServer.close();
  process.exit(0);
});
