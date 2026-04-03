/**
 * MCP Server - 采购管理系统
 * 
 * 基于 Model Context Protocol (MCP) 的工具服务
 * 供 Coze Agent 调用
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

// 导入工具实现
import * as procurementTools from './tools/procurement';

// MCP Server 配置
const MCP_PORT = parseInt(process.env.MCP_SERVER_PORT || '5001', 10);
const MCP_HOST = process.env.MCP_SERVER_HOST || '0.0.0.0';

// 创建 MCP Server
const server = new McpServer({
  name: 'procurement-mcp',
  version: '1.0.0',
});

// ============ 注册工具 ============

// 物料工具
server.registerTool('match_material', {
  description: '检查物料是否已存在，返回匹配结果和建议操作',
  inputSchema: z.object({
    text: z.string().describe('物料名称或描述'),
  }),
}, async ({ text }: { text: string }) => {
  const result = await procurementTools.matchMaterial(text);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('list_materials', {
  description: '查询物料列表',
  inputSchema: z.object({
    search: z.string().optional().describe('搜索关键词'),
    isActive: z.boolean().optional().describe('是否只查询启用状态'),
  }),
}, async ({ search, isActive }: { search?: string; isActive?: boolean }) => {
  const result = await procurementTools.listMaterials({ search, isActive });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('create_material', {
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
server.registerTool('list_suppliers', {
  description: '查询供应商列表',
  inputSchema: z.object({
    search: z.string().optional().describe('搜索关键词'),
    isActive: z.boolean().optional().describe('是否只查询启用状态'),
  }),
}, async ({ search, isActive }: { search?: string; isActive?: boolean }) => {
  const result = await procurementTools.listSuppliers({ search, isActive });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('create_supplier', {
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
server.registerTool('create_purchase_request', {
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

server.registerTool('list_purchase_requests', {
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

server.registerTool('submit_purchase_request', {
  description: '提交采购申请',
  inputSchema: z.object({
    prId: z.number().describe('采购申请ID'),
  }),
}, async ({ prId }: { prId: number }) => {
  const result = await procurementTools.submitPurchaseRequest(prId);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 寻源任务工具
server.registerTool('create_sourcing_task', {
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

server.registerTool('list_sourcing_tasks', {
  description: '查询寻源任务列表',
  inputSchema: z.object({
    status: z.string().optional().describe('状态筛选'),
    prId: z.number().optional().describe('采购申请ID'),
  }),
}, async ({ status, prId }: { status?: string; prId?: number }) => {
  const result = await procurementTools.listSourcingTasks({ status, prId });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 报价单工具
server.registerTool('create_quote', {
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

server.registerTool('award_quote', {
  description: '授标报价单',
  inputSchema: z.object({
    quoteId: z.number().describe('报价单ID'),
  }),
}, async ({ quoteId }: { quoteId: number }) => {
  const result = await procurementTools.awardQuote(quoteId);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 采购订单工具
server.registerTool('create_purchase_order', {
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

server.registerTool('send_purchase_order', {
  description: '发送采购订单',
  inputSchema: z.object({
    poId: z.number().describe('采购订单ID'),
  }),
}, async ({ poId }: { poId: number }) => {
  const result = await procurementTools.sendPurchaseOrder(poId);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.registerTool('list_purchase_orders', {
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
server.registerTool('create_goods_receipt', {
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

server.registerTool('list_goods_receipts', {
  description: '查询收货单列表',
  inputSchema: z.object({
    poId: z.number().optional().describe('订单ID'),
  }),
}, async ({ poId }: { poId?: number }) => {
  const result = await procurementTools.listGoodsReceipts({ poId });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

// 框架协议工具
server.registerTool('match_framework_agreement', {
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

// 存储活跃的 transports 和已连接的 transports
const transports: Record<string, StreamableHTTPServerTransport> = {};
const connectedTransports = new Set<string>();

// 创建 HTTP Server
const httpServer = http.createServer(async (req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcpsessionid, mcp-session-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST 请求处理
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          // 已有会话
          transport = transports[sessionId];
        } else {
          // 创建新会话
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          transports[transport.sessionId!] = transport;
          
          // 清理关闭的 transport
          transport.onclose = () => {
            delete transports[transport.sessionId!];
            connectedTransports.delete(transport.sessionId!);
          };
        }

        // 只在第一次连接时连接服务器
        if (!connectedTransports.has(transport.sessionId!)) {
          await server.connect(transport);
          connectedTransports.add(transport.sessionId!);
        }

        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (error as Error).message }));
      }
    });
    return;
  }

  // GET 请求处理 (SSE)
  if (req.method === 'GET') {
    const sessionId = req.headers['mcp-session-id'] as string;
    
    if (!sessionId || !transports[sessionId]) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing session ID');
      return;
    }

    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      console.error('Error handling GET request:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end((error as Error).message);
    }
    return;
  }

  // DELETE 请求处理
  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id'] as string;
    
    if (!sessionId || !transports[sessionId]) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing session ID');
      return;
    }

    try {
      await transports[sessionId].handleRequest(req, res);
      delete transports[sessionId];
    } catch (error) {
      console.error('Error handling DELETE request:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end((error as Error).message);
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method not allowed');
});

httpServer.listen(MCP_PORT, MCP_HOST, () => {
  console.log(`MCP Server running on ${MCP_HOST}:${MCP_PORT}`);
  console.log('Available tools: match_material, list_materials, create_material, list_suppliers, create_supplier, create_purchase_request, list_purchase_requests, submit_purchase_request, create_sourcing_task, list_sourcing_tasks, create_quote, award_quote, create_purchase_order, send_purchase_order, list_purchase_orders, create_goods_receipt, list_goods_receipts, match_framework_agreement');
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
