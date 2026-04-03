/**
 * MCP 工具类型定义
 */

export interface MCPConfig {
  port: number;
  host: string;
  authToken?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

// 采购相关类型
export interface PurchaseRequestLine {
  requirementText: string;
  quantity: number;
  estUnitPrice?: number;
  expectedDeliveryDate?: string;
  note?: string;
}

export interface CreatePurchaseRequestParams {
  reason: string;
  lines: PurchaseRequestLine[];
  actor?: string;
  role?: string;
}

export interface CreateSourcingTaskParams {
  prId: number;
  prLineId?: number;
  requirementText: string;
  materialSnapshot?: string;
  dueDate?: string;
  actor: string;
}

export interface CreateQuoteParams {
  sourcingTaskId?: number;
  supplierId: number;
  unitPrice: number;
  quantity: number;
  materialSnapshot?: string;
  validUntil?: string;
  actor: string;
}

export interface CreatePurchaseOrderParams {
  supplierId: number;
  supplierSnapshot: string;
  lines: {
    prLineId?: number;
    materialSnapshot: string;
    quantity: number;
    unitPrice: number;
  }[];
  actor: string;
}

export interface CreateGoodsReceiptParams {
  poLineId: number;
  quantity: number;
  receiptDate?: string;
  notes?: string;
  actor: string;
}

export interface CreateMaterialParams {
  code: string;
  name: string;
  unit: string;
  isActive?: boolean;
  actor: string;
}

export interface CreateSupplierParams {
  code: string;
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
  isActive?: boolean;
  actor: string;
}
