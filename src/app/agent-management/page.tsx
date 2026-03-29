'use client';

import { useState, useEffect } from 'react';
import { agentsApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, RefreshCw, Bell, AlertCircle } from 'lucide-react';

// ========== 类型定义 ==========

interface Agent {
  id: number;
  agent_id: string;
  role: 'requester' | 'buyer' | 'manager';
  webhook_url?: string;
  created_at: string;
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

// ========== Agent 列表 ==========

export default function AgentManagementPage() {
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
      schema_version: '1.0',
      event: 'test_notification',
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      data: {
        message: '这是一条测试通知，用于验证 Webhook 配置是否正确',
        agent: agent.agent_id,
        role: agent.role,
      },
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
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Agent 管理</h1>
        <p className="text-muted-foreground">管理已注册到采购系统的 Agent</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>采购系统 Agent</CardTitle>
            <CardDescription>管理已注册到采购系统的 Agent 及 Webhook 配置</CardDescription>
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
                      <p className="text-xs text-muted-foreground">
                        配置 Webhook URL 后，Agent 将接收系统事件通知
                      </p>
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

      {/* Webhook 配置说明 */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Webhook 通知说明
          </CardTitle>
          <CardDescription>
            通过 Webhook 接收系统事件通知
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">支持的事件类型</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>事件</TableHead>
                  <TableHead>触发时机</TableHead>
                  <TableHead>通知目标</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>pr_submitted</TableCell>
                  <TableCell>采购申请提交后</TableCell>
                  <TableCell>Manager</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>pr_approved / pr_rejected</TableCell>
                  <TableCell>采购申请审批后</TableCell>
                  <TableCell>Requester（详情）、Manager（摘要）</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>pr_processing_task</TableCell>
                  <TableCell>PR 审批后产生 PO/寻源任务</TableCell>
                  <TableCell>Buyer</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>po_created</TableCell>
                  <TableCell>手工创建采购订单后</TableCell>
                  <TableCell>Buyer</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>overdelivery_pending</TableCell>
                  <TableCell>超收待审批时</TableCell>
                  <TableCell>Manager</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>contract_pending</TableCell>
                  <TableCell>框架协议提交待审批后</TableCell>
                  <TableCell>Manager</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          
          <div>
            <h4 className="font-medium mb-2">统一 Payload 格式</h4>
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
{`{
  "schema_version": "1.0",
  "event": "event_type",
  "event_id": "uuid-v4",
  "timestamp": "2024-03-29T10:30:00+08:00",
  "data": {
    "entity_type": "purchase_request",
    "entity_id": 123,
    ...event_specific_fields
  }
}`}
            </pre>
          </div>

          <div>
            <h4 className="font-medium mb-2">安全特性</h4>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              <li><strong>幂等</strong>：每个事件带有唯一 event_id，接收方可据此去重</li>
              <li><strong>签名</strong>：可选 X-Webhook-Signature 头（HMAC-SHA256），密钥通过 WEBHOOK_SECRET 环境变量配置</li>
              <li><strong>重试</strong>：失败自动重试最多 3 次</li>
              <li><strong>审计</strong>：所有发送记录存入 webhook_logs 表</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
