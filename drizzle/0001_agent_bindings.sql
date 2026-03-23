-- Agent-first 绑定表
-- 一个 Agent ↔ 一个角色；飞书用户可选绑定
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
