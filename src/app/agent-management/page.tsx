'use client';

import { useState, useEffect } from 'react';
import { agentsApi, a2aAgentsApi, a2aTasksApi, a2aWorkflowApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, RefreshCw, Send, GitBranch, AlertCircle, CheckCircle, Bell } from 'lucide-react';

// ========== 类型定义 ==========

interface Agent {
  id: number;
  agent_id: string;
  role: 'requester' | 'buyer' | 'manager';
  webhook_url?: string;
  created_at: string;
}

interface RemoteAgent {
  name: string;
  endpoint: string;
  skills: string[];
  description?: string;
}

// ========== 角色配置 ==========

const roleColors: Record<string, string> = {
  requester: 'bg-blue-100 text-blue-800',
  buyer: 'bg-green-100 text-green-800',
  manager: 'bg-purple-100 text-purple-800',
};

const roleLabels: Record<string, string> = {
  requester: '需求人',
  buyer: '采购员',
  manager: '审批经理',
};

// ========== Agent 列表 Tab ==========

function AgentListTab() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const [formData, setFormData] = useState({
    agentId: '',
    role: 'requester' as 'requester' | 'buyer' | 'manager',
    webhookUrl: '',
  });

  const fetchAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await agentsApi.list();
      setAgents(res.data || []);
    } catch (err: any) {
      setError(err.message || '获取 Agent 列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingAgent) {
        await agentsApi.update(editingAgent.id, {
          role: formData.role,
          webhookUrl: formData.webhookUrl || undefined,
        });
      } else {
        await agentsApi.create({
          agentId: formData.agentId,
          role: formData.role,
          webhookUrl: formData.webhookUrl || undefined,
        });
      }
      setDialogOpen(false);
      setEditingAgent(null);
      resetForm();
      fetchAgents();
    } catch (err: any) {
      alert(err.message || '操作失败');
    }
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`确定要删除 Agent "${agent.agent_id}" 吗？`)) return;
    try {
      await agentsApi.delete(agent.id);
      fetchAgents();
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  const testNotification = async (agent: Agent) => {
    if (!agent.webhook_url) return;
    
    const testPayload = {
      event: 'test_notification',
      message: '这是一条测试通知，用于验证 Webhook 配置是否正确',
      agent: agent.agent_id,
      role: agent.role,
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetch(agent.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      });
      
      if (response.ok) {
        alert('测试通知发送成功！');
      } else {
        alert(`测试通知发送失败: HTTP ${response.status}`);
      }
    } catch (err: any) {
      alert(`测试通知发送失败: ${err.message}`);
    }
  };

  const openEditDialog = (agent: Agent) => {
    setEditingAgent(agent);
    setFormData({
      agentId: agent.agent_id,
      role: agent.role,
      webhookUrl: agent.webhook_url || '',
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({ agentId: '', role: 'requester', webhookUrl: '' });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>采购系统 Agent</CardTitle>
          <CardDescription>管理已注册到采购系统的 Agent</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAgents} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-2" />
            刷新
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { resetForm(); setEditingAgent(null); }}>
                <Plus className="w-4 h-4 mr-2" />
                注册新 Agent
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>{editingAgent ? '编辑 Agent' : '注册新 Agent'}</DialogTitle>
                  <DialogDescription>
                    {editingAgent ? '修改 Agent 的角色和 Webhook 配置' : '为系统注册一个新的 Agent'}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="agentId">Agent ID</Label>
                    <Input
                      id="agentId"
                      value={formData.agentId}
                      onChange={(e) => setFormData({ ...formData, agentId: e.target.value })}
                      placeholder="例如: coze_agent_001"
                      disabled={!!editingAgent}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="role">角色</Label>
                    <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v as any })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="requester">需求人 (requester)</SelectItem>
                        <SelectItem value="buyer">采购员 (buyer)</SelectItem>
                        <SelectItem value="manager">审批经理 (manager)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="webhookUrl">Webhook URL (可选)</Label>
                    <Input
                      id="webhookUrl"
                      value={formData.webhookUrl}
                      onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                      placeholder="https://your-server.com/webhook"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                  <Button type="submit">{editingAgent ? '保存' : '注册'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">加载中...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">{error}</div>
        ) : agents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">暂无注册的 Agent</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent ID</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>Webhook URL</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">{agent.agent_id}</TableCell>
                  <TableCell>
                    <Badge className={roleColors[agent.role]}>{roleLabels[agent.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{agent.webhook_url || '-'}</TableCell>
                  <TableCell>
                    {new Date(agent.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                  </TableCell>
                  <TableCell className="text-right">
                    {agent.webhook_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => testNotification(agent)}
                        className="mr-2"
                        title="测试通知"
                      >
                        <Bell className="w-4 h-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(agent)} className="mr-2">编辑</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(agent)} className="text-red-600 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ========== 任务发送 Tab ==========

function TaskSendTab() {
  const [remoteAgents, setRemoteAgents] = useState<RemoteAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [schedulerAvailable, setSchedulerAvailable] = useState(true);
  
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedSkill, setSelectedSkill] = useState<string>('');
  const [taskInput, setTaskInput] = useState('{}');
  const [result, setResult] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const res = await a2aAgentsApi.listRemote();
      if (res.error && !res.available) {
        setSchedulerAvailable(false);
      } else {
        setRemoteAgents(Array.isArray(res) ? res : res.data || []);
        setSchedulerAvailable(true);
      }
    } catch {
      setSchedulerAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleSend = async () => {
    if (!selectedAgent || !selectedSkill) {
      alert('请选择 Agent 和技能');
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const input = JSON.parse(taskInput);
      const res = await a2aTasksApi.send(selectedAgent, selectedSkill, input);
      setResult(res);
      setHistory([{ agent: selectedAgent, skill: selectedSkill, input, result: res, time: new Date() }, ...history.slice(0, 9)]);
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setSending(false);
    }
  };

  const currentAgent = remoteAgents.find((a) => a.name === selectedAgent);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent 任务发送</CardTitle>
        <CardDescription>向外部 Agent 发送任务并获取执行结果</CardDescription>
      </CardHeader>
      <CardContent>
        {!schedulerAvailable ? (
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 mx-auto text-yellow-500 mb-4" />
            <h3 className="text-lg font-medium mb-2">A2A Scheduler 未连接</h3>
            <p className="text-muted-foreground mb-4">请确保 A2A Scheduler 服务正在运行</p>
            <code className="text-sm bg-muted px-2 py-1 rounded">python -m scheduler.main</code>
          </div>
        ) : loading ? (
          <div className="text-center py-8 text-muted-foreground">加载中...</div>
        ) : remoteAgents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            暂无注册的外部 Agent
          </div>
        ) : (
          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>选择 Agent</Label>
                <Select value={selectedAgent} onValueChange={(v) => { setSelectedAgent(v); setSelectedSkill(''); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {remoteAgents.map((agent) => (
                      <SelectItem key={agent.name} value={agent.name}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentAgent && (
                  <p className="text-xs text-muted-foreground">{currentAgent.description}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>选择技能</Label>
                <Select value={selectedSkill} onValueChange={setSelectedSkill} disabled={!selectedAgent}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择技能" />
                  </SelectTrigger>
                  <SelectContent>
                    {currentAgent?.skills.map((skill) => (
                      <SelectItem key={skill} value={skill}>
                        {skill}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>任务输入 (JSON)</Label>
              <Textarea
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                className="font-mono h-32"
                placeholder='{"text": "Hello World"}'
              />
            </div>

            <Button onClick={handleSend} disabled={sending || !selectedAgent || !selectedSkill} className="w-full">
              {sending ? (
                <>发送中...</>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  发送任务
                </>
              )}
            </Button>

            {result && (
              <div className="mt-4">
                <Label>执行结果</Label>
                <div className={`mt-2 p-4 rounded-lg ${result.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                  {result.error ? (
                    <div className="text-red-600">
                      <AlertCircle className="w-4 h-4 inline mr-1" />
                      {result.error}
                    </div>
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap font-mono">{JSON.stringify(result, null, 2)}</pre>
                  )}
                </div>
              </div>
            )}

            {history.length > 0 && (
              <div className="mt-6">
                <Label>执行历史</Label>
                <div className="mt-2 space-y-2">
                  {history.map((item, i) => (
                    <div key={i} className="p-3 bg-muted rounded-lg text-sm">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-medium">
                          {item.agent} → {item.skill}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item.time.toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <code className="text-xs">{JSON.stringify(item.input)}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ========== 工作流编排 Tab ==========

function WorkflowTab() {
  const [remoteAgents, setRemoteAgents] = useState<RemoteAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [schedulerAvailable, setSchedulerAvailable] = useState(true);
  
  const [chainAgents, setChainAgents] = useState<string[]>([]);
  const [chainInput, setChainInput] = useState('{}');
  const [chainResult, setChainResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  // 自定义工作流
  const [wfSteps, setWfSteps] = useState<Array<{ agent: string; skill: string }>>([]);
  const [wfContext, setWfContext] = useState('{}');
  const [wfResult, setWfResult] = useState<any>(null);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const res = await a2aAgentsApi.listRemote();
      if (res.error && !res.available) {
        setSchedulerAvailable(false);
      } else {
        setRemoteAgents(Array.isArray(res) ? res : res.data || []);
        setSchedulerAvailable(true);
      }
    } catch {
      setSchedulerAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleChain = async () => {
    if (chainAgents.length < 2) {
      alert('链式执行至少需要 2 个 Agent');
      return;
    }
    setRunning(true);
    setChainResult(null);
    try {
      const input = JSON.parse(chainInput);
      const res = await a2aWorkflowApi.chain(chainAgents, input);
      setChainResult(res);
    } catch (err: any) {
      setChainResult({ error: err.message });
    } finally {
      setRunning(false);
    }
  };

  const handleCustomWorkflow = async () => {
    if (wfSteps.length === 0) {
      alert('请添加至少一个步骤');
      return;
    }
    setRunning(true);
    setWfResult(null);
    try {
      const context = JSON.parse(wfContext);
      const res = await a2aWorkflowApi.run(wfSteps, context);
      setWfResult(res);
    } catch (err: any) {
      setWfResult({ error: err.message });
    } finally {
      setRunning(false);
    }
  };

  const addStep = (agent: string, skill: string) => {
    if (agent && skill) {
      setWfSteps([...wfSteps, { agent, skill }]);
    }
  };

  if (!schedulerAvailable) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-yellow-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">A2A Scheduler 未连接</h3>
          <p className="text-muted-foreground mb-4">请确保 A2A Scheduler 服务正在运行</p>
          <code className="text-sm bg-muted px-2 py-1 rounded">python -m scheduler.main</code>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {/* 链式执行 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            链式执行
          </CardTitle>
          <CardDescription>Agent A → Agent B → Agent C (依次执行，上一步输出作为下一步输入)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>选择 Agent 链（按执行顺序）</Label>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {remoteAgents.map((agent) => (
                    <Button
                      key={agent.name}
                      variant={chainAgents.includes(agent.name) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        if (chainAgents.includes(agent.name)) {
                          setChainAgents(chainAgents.filter((a) => a !== agent.name));
                        } else {
                          setChainAgents([...chainAgents, agent.name]);
                        }
                      }}
                    >
                      {agent.name}
                    </Button>
                  ))}
                </div>
                {chainAgents.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    执行顺序: {chainAgents.join(' → ')}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>初始输入 (JSON)</Label>
                <Textarea
                  value={chainInput}
                  onChange={(e) => setChainInput(e.target.value)}
                  className="font-mono h-24"
                  placeholder='{"text": "Hello"}'
                />
              </div>

              <Button onClick={handleChain} disabled={running || chainAgents.length < 2} className="w-full">
                {running ? '执行中...' : '▶️ 执行链式工作流'}
              </Button>

              {chainResult && (
                <div className={`mt-4 p-4 rounded-lg ${chainResult.error ? 'bg-red-50' : 'bg-green-50'}`}>
                  {chainResult.error ? (
                    <div className="text-red-600">{chainResult.error}</div>
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap font-mono">{JSON.stringify(chainResult, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 自定义工作流 */}
      <Card>
        <CardHeader>
          <CardTitle>自定义工作流</CardTitle>
          <CardDescription>灵活定义每一步的 Agent、输入输出映射</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Select onValueChange={(v) => (document.getElementById('wf-agent') as any && ((document.getElementById('wf-agent') as any).value = v))}>
                <SelectTrigger id="wf-agent" className="flex-1">
                  <SelectValue placeholder="选择 Agent" />
                </SelectTrigger>
                <SelectContent>
                  {remoteAgents.map((agent) => (
                    <SelectItem key={agent.name} value={agent.name}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="技能名称" className="flex-1" id="wf-skill" />
              <Button
                onClick={() => {
                  const agent = (document.getElementById('wf-agent') as HTMLSelectElement)?.value;
                  const skill = (document.getElementById('wf-skill') as HTMLInputElement)?.value;
                  addStep(agent, skill);
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {wfSteps.length > 0 && (
              <div>
                <Label>执行步骤</Label>
                <div className="mt-2 space-y-2">
                  {wfSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span className="font-medium">{step.agent}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{step.skill}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setWfSteps(wfSteps.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>工作流输入 (JSON)</Label>
              <Textarea
                value={wfContext}
                onChange={(e) => setWfContext(e.target.value)}
                className="font-mono h-24"
                placeholder='{"input": "test"}'
              />
            </div>

            <Button onClick={handleCustomWorkflow} disabled={running || wfSteps.length === 0} className="w-full">
              {running ? '执行中...' : '▶️ 执行自定义工作流'}
            </Button>

            {wfResult && (
              <div className={`mt-4 p-4 rounded-lg ${wfResult.error ? 'bg-red-50' : 'bg-green-50'}`}>
                {wfResult.error ? (
                  <div className="text-red-600">{wfResult.error}</div>
                ) : (
                  <pre className="text-sm whitespace-pre-wrap font-mono">{JSON.stringify(wfResult, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ========== 主页面 ==========

export default function AgentManagementPage() {
  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Agent 管理</h1>
        <p className="text-muted-foreground">管理 Agent 注册、任务分发和工作流编排</p>
      </div>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="list">📋 Agent 列表</TabsTrigger>
          <TabsTrigger value="task">📤 任务发送</TabsTrigger>
          <TabsTrigger value="workflow">🔗 工作流编排</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <AgentListTab />
        </TabsContent>

        <TabsContent value="task">
          <TaskSendTab />
        </TabsContent>

        <TabsContent value="workflow">
          <WorkflowTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
