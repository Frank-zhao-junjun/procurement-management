-- 事件驱动架构数据库迁移
-- 运行: npx supabase db push 或手动执行

-- ============ 1. 事件表 ============
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  version VARCHAR(10) DEFAULT '1.0',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(100) NOT NULL,
  correlation_id VARCHAR(100),
  caused_by VARCHAR(100),
  data JSONB NOT NULL,
  routing JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);

-- ============ 2. 事件投递表 ============
CREATE TABLE IF NOT EXISTS event_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  agent_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'dead_letter')),
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 4,
  last_attempt_at TIMESTAMPTZ,
  response_status INT,
  response_body TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_deliveries_event ON event_deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_agent ON event_deliveries(agent_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON event_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_created ON event_deliveries(created_at);

-- ============ 3. Agent 订阅表 ============
CREATE TABLE IF NOT EXISTS agent_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_binding_id UUID REFERENCES agent_bindings(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  webhook_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_binding_id, event_type)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_subscriptions_binding ON agent_subscriptions(agent_binding_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_type ON agent_subscriptions(event_type);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON agent_subscriptions(is_active) WHERE is_active = TRUE;

-- ============ 4. 收货单增加状态 ============
-- 退货审批状态: pending_approval, approved, rejected
ALTER TABLE goods_receipts
  DROP CONSTRAINT IF EXISTS chk_gr_status;

ALTER TABLE goods_receipts
  ADD CONSTRAINT chk_gr_status
  CHECK (status IN ('pending', 'pending_approval', 'approved', 'rejected', 'completed', 'cancelled'));

-- ============ 5. 增加 attempts 增量函数 ============
CREATE OR REPLACE FUNCTION increment_attempts(row_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE event_deliveries
  SET attempts = attempts + 1
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============ 6. 触发器：Agent 注册时自动创建默认订阅 ============
CREATE OR REPLACE FUNCTION create_default_agent_subscriptions()
RETURNS TRIGGER AS $$
BEGIN
  -- 根据角色创建默认订阅
  IF NEW.role = 'manager' THEN
    INSERT INTO agent_subscriptions (agent_binding_id, event_type)
    VALUES
      (NEW.id, 'pr.submitted'),
      (NEW.id, 'gr.overdelivered'),
      (NEW.id, 'gr.return_requested'),
      (NEW.id, 'price.high'),
      (NEW.id, 'price.abnormal')
    ON CONFLICT (agent_binding_id, event_type) DO NOTHING;
  ELSIF NEW.role = 'buyer' THEN
    INSERT INTO agent_subscriptions (agent_binding_id, event_type)
    VALUES
      (NEW.id, 'pr.approved'),
      (NEW.id, 'sourcing.created'),
      (NEW.id, 'quote.awarded'),
      (NEW.id, 'gr.overdelivered'),
      (NEW.id, 'price.high'),
      (NEW.id, 'price.abnormal')
    ON CONFLICT (agent_binding_id, event_type) DO NOTHING;
  ELSIF NEW.role = 'requester' THEN
    INSERT INTO agent_subscriptions (agent_binding_id, event_type)
    VALUES
      (NEW.id, 'pr.approved'),
      (NEW.id, 'pr.rejected'),
      (NEW.id, 'gr.completed'),
      (NEW.id, 'gr.return_approved')
    ON CONFLICT (agent_binding_id, event_type) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建触发器（如果 agent_bindings 表存在）
-- 注意：需要根据实际情况调整触发器名称
-- DROP TRIGGER IF EXISTS trg_create_default_subscriptions ON agent_bindings;
-- CREATE TRIGGER trg_create_default_subscriptions
--   AFTER INSERT ON agent_bindings
--   FOR EACH ROW
--   EXECUTE FUNCTION create_default_agent_subscriptions();
