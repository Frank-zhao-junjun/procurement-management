# A2A Scheduler 🦞

轻量级 A2A (Agent-to-Agent) 调度台，支持跨平台 Agent 注册、任务分发和工作流编排。

## 快速开始

### 1. 安装依赖

```bash
cd a2a-scheduler
pip install -r requirements.txt
```

### 2. 启动服务

需要开 **3 个终端窗口**：

**终端 1 - 启动 Scheduler (调度台后端):**
```bash
python -m scheduler.main
# 服务运行在 http://localhost:8000
```

**终端 2 - 启动示例 Agent A:**
```bash
python agents/agent_a.py
# 服务运行在 http://localhost:8001
```

**终端 3 - 启动示例 Agent B:**
```bash
python agents/agent_b.py
# 服务运行在 http://localhost:8002
```

### 3. 启动 Web UI

```bash
streamlit run webui.py
# 自动打开浏览器，访问 http://localhost:8501
```

## 使用 Web UI

### 1. 注册 Agent
- 点击左侧菜单 **"➕ 注册 Agent"**
- 填写 Agent 信息：
  - 名称: `agent-a`
  - Endpoint: `http://localhost:8001`
  - 技能: `translate, summarize, uppercase`
- 同样方式注册 `agent-b`

### 2. 发送单任务
- 点击 **"📤 发送任务"**
- 选择 Agent 和技能
- 输入 JSON 参数，点击发送

### 3. 工作流编排
- 点击 **"🔗 工作流编排"**
- **链式执行**: 选择多个 Agent 按顺序执行
- **自定义工作流**: 灵活定义每一步的输入输出映射

### 4. 查看历史
- 所有执行记录保存在 **"📊 执行历史"** 中

## 项目结构

```
a2a-scheduler/
├── scheduler/           # 调度台核心代码
│   ├── main.py         # FastAPI 服务
│   ├── registry.py     # Agent 注册表
│   ├── client.py       # A2A Client
│   └── workflow.py     # 编排引擎
├── agents/             # 示例 Agent
│   ├── agent_a.py      # 文本处理 Agent
│   └── agent_b.py      # 数据处理 Agent
├── webui.py            # Streamlit Web UI
├── registry.json       # Agent 注册信息（自动生成）
└── requirements.txt
```

## API 文档

启动 Scheduler 后访问: http://localhost:8000/docs

### 主要接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/registry/agents` | POST | 注册 Agent |
| `/registry/agents` | GET | 列出所有 Agent |
| `/tasks/send` | POST | 发送单任务 |
| `/workflow/chain` | POST | 链式工作流 |
| `/workflow/run` | POST | 自定义工作流 |

## 自定义 Agent

只需要实现两个接口即可接入调度台：

```python
@app.post("/a2a/v1/tasks/send")
async def handle_task(task: Task):
    # 处理任务
    return {
        "id": task.id,
        "status": "completed",
        "output": {"result": "处理结果"}
    }

@app.get("/.well-known/agent.json")
def agent_card():
    # 返回 Agent 元数据
    return {
        "name": "my-agent",
        "endpoint": "http://localhost:8003",
        "skills": ["skill1", "skill2"]
    }
```

## 扩展建议

- **流式响应**: 实现 `/tasks/sendSubscribe` 接口支持 SSE
- **持久化**: 使用 PostgreSQL 替代 JSON 文件
- **认证**: 添加 API Key 或 JWT 认证
- **监控**: 集成 Prometheus 监控任务执行情况
