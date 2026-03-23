-- Agent-first 绑定表（适用于已有库且包含飞书字段的情况）
-- 如果是新库，直接执行 0001_agent_bindings.sql
-- 此脚本用于：已有 users/suppliers 表且包含 feishu_* 字段的库

CREATE TABLE IF NOT EXISTS "agent_bindings" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" varchar(100) NOT NULL UNIQUE,
  "role" "user_role" NOT NULL,
  "feishu_user_id" varchar(100),
  "feishu_open_id" varchar(100),
  "feishu_app_id" varchar(50),
  "feishu_union_id" varchar(100),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "ab_agent_idx" ON "agent_bindings" ("agent_id");
CREATE INDEX IF NOT EXISTS "ab_role_idx" ON "agent_bindings" ("role");
CREATE INDEX IF NOT EXISTS "ab_feishu_user_idx" ON "agent_bindings" ("feishu_user_id");
