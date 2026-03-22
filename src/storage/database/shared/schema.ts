import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  serial,
  decimal,
  date,
  time,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createSchemaFactory } from "drizzle-zod";
import { z } from "zod";

// ============ Enums ============

// 采购申请状态
export const prStatusEnum = pgEnum("pr_status", [
  "draft",       // 草稿
  "submitted",   // 已提交待审批
  "approved",    // 已同意
  "rejected",    // 已拒绝
]);

// PR 行进度状态
export const prLineProgressEnum = pgEnum("pr_line_progress", [
  "pending",           // 未审批
  "approved",          // 已审批
  "pending_confirm",   // 待确认FA匹配
  "matched_protocol",  // 已匹配协议
  "sourced",          // 已寻源
  "quoted",           // 已报价
  "awarded",          // 已授标
  "ordered",          // 已下单
  "partial_received", // 部分收货
  "received",         // 已收货
  "return_pending",   // 退货待补货
]);

// PR 行匹配确认结果
export const matchConfirmEnum = pgEnum("match_confirm", [
  "pending",     // 待确认
  "confirmed",   // 已确认匹配
  "rejected",    // 拒绝匹配
]);

// 采购订单状态
export const poStatusEnum = pgEnum("po_status", [
  "draft",        // 草稿
  "sent",         // 已发送
  "partial",      // 部分收货
  "received",     // 已收货
  "cancelled",    // 已取消
]);

// PO 行状态
export const poLineStatusEnum = pgEnum("po_line_status", [
  "ordered",          // 已下单
  "partial_received", // 部分收货
  "received",        // 已收货
  "return_pending",   // 退货待补货
]);

// 寻源任务状态
export const sourcingStatusEnum = pgEnum("sourcing_status", [
  "pending",    // 待处理
  "in_progress",// 进行中
  "completed",  // 已完成
  "cancelled",  // 已取消
]);

// 报价单状态
export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",      // 草稿
  "submitted",  // 已提交
  "accepted",   // 已接受
  "rejected",   // 已拒绝
]);

// 授标状态
export const awardStatusEnum = pgEnum("award_status", [
  "pending",    // 待授标
  "awarded",    // 已授标
]);

// 框架协议状态
export const faStatusEnum = pgEnum("fa_status", [
  "active",     // 生效中
  "expired",    // 已过期
  "cancelled",  // 已取消
]);

// 收货单类型
export const grTypeEnum = pgEnum("gr_type", [
  "in",         // 收货
  "out",        // 退货
]);

// 用户角色
export const userRoleEnum = pgEnum("user_role", [
  "requester",  // 需求人
  "manager",    // 审批人/经理
  "buyer",      // 采购员
]);

// ============ 主数据表 ============

// 物料主数据
export const materials = pgTable(
  "materials",
  {
    id: serial().primaryKey(),
    code: varchar("code", { length: 50 }).unique(),        // 物料编码
    name: varchar("name", { length: 255 }).notNull(),     // 标准名称
    unit: varchar("unit", { length: 20 }).default("件"), // 单位
    isActive: boolean("is_active").default(true).notNull(), // 是否启用
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("materials_name_idx").on(table.name),
    index("materials_active_idx").on(table.isActive),
  ]
);

// 供应商主数据
export const suppliers = pgTable(
  "suppliers",
  {
    id: serial().primaryKey(),
    code: varchar("code", { length: 50 }).unique(),       // 供应商编码
    name: varchar("name", { length: 255 }).notNull().unique(), // 供应商名称
    contact: varchar("contact", { length: 100 }),         // 联系人
    email: varchar("email", { length: 100 }),
    phone: varchar("phone", { length: 50 }),
    address: text("address"),
    note: text("note"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("suppliers_name_idx").on(table.name),
    index("suppliers_active_idx").on(table.isActive),
  ]
);

// ============ 业务单据表 ============

// 采购申请主表
export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: serial().primaryKey(),
    prNumber: varchar("pr_number", { length: 30 }).unique(), // PR-YYYYMMDD-XX
    applicant: varchar("applicant", { length: 100 }).notNull(), // 申请人（Agent名称）
    applicantRole: userRoleEnum("applicant_role").default("requester"),
    reason: text("reason"),                                   // 申请原因
    status: prStatusEnum("status").default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("pr_number_idx").on(table.prNumber),
    index("pr_applicant_idx").on(table.applicant),
    index("pr_status_idx").on(table.status),
    index("pr_created_idx").on(table.createdAt),
  ]
);

// 采购申请行项目
export const purchaseRequestLines = pgTable(
  "purchase_request_lines",
  {
    id: serial().primaryKey(),
    requestId: integer("request_id").notNull().references(() => purchaseRequests.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),           // 行号 1,2,3...
    materialId: integer("material_id").references(() => materials.id), // 物料主数据ID
    materialSnapshot: varchar("material_snapshot", { length: 255 }), // 物料名称快照
    requirementText: text("requirement_text").notNull(),    // 需求原文（口语化描述）
    matchConfirm: matchConfirmEnum("match_confirm"),          // 匹配确认结果
    matchedFaId: integer("matched_fa_id").references(() => frameworkAgreements.id), // 匹配的FA ID
    quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(), // 数量
    estUnitPrice: decimal("est_unit_price", { precision: 15, scale: 4 }), // 预估单价
    expectedDeliveryDate: date("expected_delivery_date"),    // 期望交货日期
    progress: prLineProgressEnum("progress").default("pending"), // 最新进度
    sourcingTaskId: integer("sourcing_task_id"),             // 关联寻源任务ID
    purchaseOrderId: integer("purchase_order_id"),           // 关联采购订单ID
    poLineNumber: integer("po_line_number"),                 // 关联PO行号
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("prl_request_idx").on(table.requestId),
    index("prl_material_idx").on(table.materialId),
    index("prl_progress_idx").on(table.progress),
    index("prl_sourcing_idx").on(table.sourcingTaskId),
    index("prl_po_idx").on(table.purchaseOrderId),
  ]
);

// 寻源任务
export const sourcingTasks = pgTable(
  "sourcing_tasks",
  {
    id: serial().primaryKey(),
    taskNumber: varchar("task_number", { length: 30 }).unique(), // SC-YYYYMMDD-XX
    prId: integer("pr_id").notNull().references(() => purchaseRequests.id),
    prLineId: integer("pr_line_id").notNull().references(() => purchaseRequestLines.id),
    materialId: integer("material_id").references(() => materials.id),
    materialSnapshot: varchar("material_snapshot", { length: 255 }),
    requirementText: text("requirement_text"),
    targetSupplierId: integer("target_supplier_id").references(() => suppliers.id),
    targetSupplierSnapshot: varchar("target_supplier_snapshot", { length: 255 }),
    status: sourcingStatusEnum("status").default("pending"),
    dueDate: date("due_date"),
    result: text("result"),                                     // 寻源结果说明
    createdBy: varchar("created_by", { length: 100 }).notNull(), // 创建人
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("st_task_number_idx").on(table.taskNumber),
    index("st_pr_idx").on(table.prId),
    index("st_status_idx").on(table.status),
  ]
);

// 报价单
export const quotes = pgTable(
  "quotes",
  {
    id: serial().primaryKey(),
    quoteNumber: varchar("quote_number", { length: 30 }).unique(), // QT-YYYYMMDD-XX
    sourcingTaskId: integer("sourcing_task_id").notNull().references(() => sourcingTasks.id),
    supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
    supplierSnapshot: varchar("supplier_snapshot", { length: 255 }),
    materialId: integer("material_id").references(() => materials.id),
    materialSnapshot: varchar("material_snapshot", { length: 255 }),
    unitPrice: decimal("unit_price", { precision: 15, scale: 4 }).notNull(), // 报价单价
    quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(),
    totalPrice: decimal("total_price", { precision: 15, scale: 4 }),
    validUntil: date("valid_until"),                              // 有效期至
    status: quoteStatusEnum("status").default("draft"),
    awarded: awardStatusEnum("awarded").default("pending"),       // 是否已授标
    notes: text("notes"),
    createdBy: varchar("created_by", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("qt_task_idx").on(table.sourcingTaskId),
    index("qt_supplier_idx").on(table.supplierId),
    index("qt_status_idx").on(table.status),
  ]
);

// 框架协议
export const frameworkAgreements = pgTable(
  "framework_agreements",
  {
    id: serial().primaryKey(),
    faNumber: varchar("fa_number", { length: 30 }).unique(), // FA-YYYYMMDD-XX
    supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
    supplierSnapshot: varchar("supplier_snapshot", { length: 255 }),
    materialId: integer("material_id").references(() => materials.id),
    materialSnapshot: varchar("material_snapshot", { length: 255 }),
    materialOriginalText: text("material_original_text").notNull(), // 供应商原文
    matchConfirm: matchConfirmEnum("match_confirm"),
    unitPrice: decimal("unit_price", { precision: 15, scale: 4 }).notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to").notNull(),
    status: faStatusEnum("status").default("active"),
    createdBy: varchar("created_by", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("fa_number_idx").on(table.faNumber),
    index("fa_supplier_idx").on(table.supplierId),
    index("fa_material_idx").on(table.materialId),
    index("fa_status_idx").on(table.status),
    index("fa_validity_idx").on(table.validFrom, table.validTo),
  ]
);

// 采购订单主表
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: serial().primaryKey(),
    poNumber: varchar("po_number", { length: 30 }).unique(), // PO-YYYYMMDD-XX
    supplierId: integer("supplier_id").references(() => suppliers.id),
    supplierSnapshot: varchar("supplier_snapshot", { length: 255 }),
    deliveryDate: date("delivery_date"),                     // 到货日期（最晚日期）
    status: poStatusEnum("status").default("draft"),
    createdBy: varchar("created_by", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("po_number_idx").on(table.poNumber),
    index("po_supplier_idx").on(table.supplierId),
    index("po_status_idx").on(table.status),
    index("po_created_idx").on(table.createdAt),
  ]
);

// 采购订单行项目
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: serial().primaryKey(),
    orderId: integer("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    prId: integer("pr_id").notNull().references(() => purchaseRequests.id),
    prLineId: integer("pr_line_id").notNull().references(() => purchaseRequestLines.id),
    materialId: integer("material_id").references(() => materials.id),
    materialSnapshot: varchar("material_snapshot", { length: 255 }),
    quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(),
    unitPrice: decimal("unit_price", { precision: 15, scale: 4 }).notNull(),
    totalPrice: decimal("total_price", { precision: 15, scale: 4 }),
    receivedQty: decimal("received_qty", { precision: 15, scale: 4 }).default("0"), // 已净收货数量
    pendingQty: decimal("pending_qty", { precision: 15, scale: 4 }),               // 未收货数量
    status: poLineStatusEnum("status").default("ordered"),
    faId: integer("fa_id").references(() => frameworkAgreements.id),  // 来源框架协议
    sourcingTaskId: integer("sourcing_task_id").references(() => sourcingTasks.id), // 来源寻源
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("pol_order_idx").on(table.orderId),
    index("pol_pr_idx").on(table.prId),
    index("pol_pr_line_idx").on(table.prLineId),
    index("pol_status_idx").on(table.status),
  ]
);

// 收货单
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: serial().primaryKey(),
    grNumber: varchar("gr_number", { length: 30 }).unique(), // GR-YYYYMMDD-XX
    poId: integer("po_id").notNull().references(() => purchaseOrders.id),
    poLineId: integer("po_line_id").notNull().references(() => purchaseOrderLines.id),
    grType: grTypeEnum("gr_type").default("in"),             // 收货类型：in=收货, out=退货
    quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(),
    receiptDate: date("receipt_date").notNull(),
    receiptTime: time("receipt_time"),                        // 收货时间（系统生成）
    receiver: varchar("receiver", { length: 100 }).notNull(), // 收货人
    notes: text("notes"),
    // 超收相关字段
    status: varchar("status", { length: 20 }).default("completed"), // completed/pending_approval/approved/rejected
    isOverdelivery: boolean("is_overdelivery").default(false),
    overdeliveryRatio: decimal("overdelivery_ratio", { precision: 5, scale: 4 }).default("0"),
    approvedBy: varchar("approved_by", { length: 100 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("gr_number_idx").on(table.grNumber),
    index("gr_po_idx").on(table.poId),
    index("gr_po_line_idx").on(table.poLineId),
    index("gr_type_idx").on(table.grType),
    index("gr_date_idx").on(table.receiptDate),
  ]
);

// ============ 系统表 ============

// 审计日志
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial().primaryKey(),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // 实体类型
    entityId: integer("entity_id").notNull(),                    // 实体ID
    action: varchar("action", { length: 50 }).notNull(),          // 操作类型
    actor: varchar("actor", { length: 100 }).notNull(),           // 操作者
    actorRole: userRoleEnum("actor_role"),
    detail: jsonb("detail"),                                     // 详情JSON
    ipAddress: varchar("ip_address", { length: 50 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_actor_idx").on(table.actor),
    index("audit_action_idx").on(table.action),
    index("audit_created_idx").on(table.createdAt),
  ]
);

// 飞书绑定
export const feishuBindings = pgTable(
  "feishu_bindings",
  {
    id: serial().primaryKey(),
    feishuOpenId: varchar("feishu_open_id", { length: 100 }).notNull(),
    feishuAppId: varchar("feishu_app_id", { length: 50 }).notNull(), // 飞书应用ID
    agentId: varchar("agent_id", { length: 100 }).notNull(),         // Agent标识
    role: userRoleEnum("role").notNull(),                          // 绑定的业务角色
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("fsb_openid_idx").on(table.feishuOpenId),
    index("fsb_app_idx").on(table.feishuAppId),
    index("fsb_agent_idx").on(table.agentId),
    index("fsb_role_idx").on(table.role),
  ]
);

// 系统配置
export const systemConfigs = pgTable(
  "system_configs",
  {
    id: serial().primaryKey(),
    configKey: varchar("config_key", { length: 100 }).notNull().unique(),
    configValue: text("config_value"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  }
);

// ============ Zod Schemas ============

const { createInsertSchema: createCoercedInsertSchema } = createSchemaFactory({
  coerce: { date: true },
});

// Materials
export const insertMaterialSchema = createCoercedInsertSchema(materials).pick({
  code: true,
  name: true,
  unit: true,
  isActive: true,
});

export const updateMaterialSchema = createCoercedInsertSchema(materials)
  .pick({ code: true, name: true, unit: true, isActive: true })
  .partial();

// Suppliers
export const insertSupplierSchema = createCoercedInsertSchema(suppliers).pick({
  code: true,
  name: true,
  contact: true,
  email: true,
  phone: true,
  address: true,
  note: true,
  isActive: true,
});

export const updateSupplierSchema = createCoercedInsertSchema(suppliers)
  .pick({
    code: true,
    name: true,
    contact: true,
    email: true,
    phone: true,
    address: true,
    note: true,
    isActive: true,
  })
  .partial();

// Purchase Requests
export const insertPurchaseRequestSchema = createCoercedInsertSchema(purchaseRequests).pick({
  applicant: true,
  applicantRole: true,
  reason: true,
});

export const insertPurchaseRequestLineSchema = createCoercedInsertSchema(purchaseRequestLines).pick({
  materialId: true,
  materialSnapshot: true,
  requirementText: true,
  quantity: true,
  estUnitPrice: true,
  expectedDeliveryDate: true,
  note: true,
});

// Sourcing Tasks
export const insertSourcingTaskSchema = createCoercedInsertSchema(sourcingTasks).pick({
  prId: true,
  prLineId: true,
  materialId: true,
  materialSnapshot: true,
  requirementText: true,
  targetSupplierId: true,
  targetSupplierSnapshot: true,
  dueDate: true,
  result: true,
});

// Quotes
export const insertQuoteSchema = createCoercedInsertSchema(quotes).pick({
  sourcingTaskId: true,
  supplierId: true,
  supplierSnapshot: true,
  materialId: true,
  materialSnapshot: true,
  unitPrice: true,
  quantity: true,
  validUntil: true,
  notes: true,
});

// Framework Agreements
export const insertFrameworkAgreementSchema = createCoercedInsertSchema(frameworkAgreements).pick({
  supplierId: true,
  supplierSnapshot: true,
  materialId: true,
  materialSnapshot: true,
  materialOriginalText: true,
  unitPrice: true,
  validFrom: true,
  validTo: true,
});

// Purchase Orders
export const insertPurchaseOrderSchema = createCoercedInsertSchema(purchaseOrders).pick({
  supplierId: true,
  supplierSnapshot: true,
  deliveryDate: true,
});

// Goods Receipts
export const insertGoodsReceiptSchema = createCoercedInsertSchema(goodsReceipts).pick({
  poId: true,
  poLineId: true,
  grType: true,
  quantity: true,
  receiptDate: true,
  notes: true,
});

// ============ TypeScript Types ============

export type Material = typeof materials.$inferSelect;
export type InsertMaterial = z.infer<typeof insertMaterialSchema>;

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;

export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type InsertPurchaseRequest = z.infer<typeof insertPurchaseRequestSchema>;

export type PurchaseRequestLine = typeof purchaseRequestLines.$inferSelect;
export type InsertPurchaseRequestLine = z.infer<typeof insertPurchaseRequestLineSchema>;

export type SourcingTask = typeof sourcingTasks.$inferSelect;
export type InsertSourcingTask = z.infer<typeof insertSourcingTaskSchema>;

export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;

export type FrameworkAgreement = typeof frameworkAgreements.$inferSelect;
export type InsertFrameworkAgreement = z.infer<typeof insertFrameworkAgreementSchema>;

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;

export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;

export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type InsertGoodsReceipt = z.infer<typeof insertGoodsReceiptSchema>;

export type AuditLog = typeof auditLogs.$inferSelect;

export type FeishuBinding = typeof feishuBindings.$inferSelect;
