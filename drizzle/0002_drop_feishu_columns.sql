-- Agent-first 绑定表（适用于已有库且包含飞书字段的情况）
-- 如果是新库，直接执行 0001_agent_bindings.sql
-- 此脚本用于：已有 users/suppliers 表且包含 feishu_* 字段的库

-- 1. 创建 agent_bindings 表（如果不存在）
CREATE TABLE IF NOT EXISTS "agent_bindings" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" varchar(100) NOT NULL UNIQUE,
  "role" "user_role" NOT NULL,
  "feishu_user_id" varchar(100),
  "feishu_open_id" varchar(100),
  "feishu_app_id" varchar(50),
  "feishu_union_id" varchar(100),
  "webhook_url" varchar(500),           -- Webhook URL（用于 Manager 通知）
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "ab_agent_idx" ON "agent_bindings" ("agent_id");
CREATE INDEX IF NOT EXISTS "ab_role_idx" ON "agent_bindings" ("role");
CREATE INDEX IF NOT EXISTS "ab_feishu_user_idx" ON "agent_bindings" ("feishu_user_id");

-- 2. 添加 user_role 枚举的 'system' 值（如果不存在）
-- PostgreSQL 不支持直接 ALTER TYPE ADD VALUE IF NOT EXISTS，需要使用 DO 块
DO $$
BEGIN
    -- 检查 'system' 值是否已存在
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'system' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')) THEN
        ALTER TYPE "user_role" ADD VALUE 'system';
    END IF;
END
$$;

-- 3. 创建缺失的系统表（如果不存在）

-- PO 发送失败记录表
CREATE TABLE IF NOT EXISTS "po_send_failures" (
  "id" serial PRIMARY KEY NOT NULL,
  "po_id" integer NOT NULL REFERENCES "purchase_orders"("id"),
  "failure_reason" text,
  "retry_count" integer DEFAULT 0,
  "max_retries" integer DEFAULT 3,
  "status" varchar(20) DEFAULT 'pending',
  "next_retry_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "psf_po_idx" ON "po_send_failures" ("po_id");
CREATE INDEX IF NOT EXISTS "psf_status_idx" ON "po_send_failures" ("status");
CREATE INDEX IF NOT EXISTS "psf_next_retry_idx" ON "po_send_failures" ("next_retry_at");

-- 飞书通知记录表
CREATE TABLE IF NOT EXISTS "feishu_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" integer NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "recipient" varchar(100) NOT NULL,
  "message" text,
  "status" varchar(20) DEFAULT 'pending',
  "sent_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "fn_entity_idx" ON "feishu_notifications" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "fn_status_idx" ON "feishu_notifications" ("status");
CREATE INDEX IF NOT EXISTS "fn_created_idx" ON "feishu_notifications" ("created_at");
