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
import { Plus, Trash2, RefreshCw } from 'lucide-react';

interface Agent {
  id: number;
  agent_id: string;
  role: 'requester' | 'buyer' | 'manager';
  webhook_url?: string;
  created_at: string;
}

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

export default function AgentManagementPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // 表单状态
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
        // 更新
        await agentsApi.update(editingAgent.id, {
          role: formData.role,
          webhookUrl: formData.webhookUrl || undefined,
        });
      } else {
        // 创建
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
    setFormData({
      agentId: '',
      role: 'requester',
      webhookUrl: '',
    });
  };

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Agent 管理</CardTitle>
            <CardDescription>
              管理已注册的 Agent 及其角色权限
            </CardDescription>
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
                    <DialogTitle>
                      {editingAgent ? '编辑 Agent' : '注册新 Agent'}
                    </DialogTitle>
                    <DialogDescription>
                      {editingAgent 
                        ? '修改 Agent 的角色和 Webhook 配置' 
                        : '为系统注册一个新的 Agent'}
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
                      <Select
                        value={formData.role}
                        onValueChange={(value) => setFormData({ ...formData, role: value as any })}
                      >
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
                        Manager Agent 可配置 Webhook 接收待审批通知
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      取消
                    </Button>
                    <Button type="submit">
                      {editingAgent ? '保存' : '注册'}
                    </Button>
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
            <div className="text-center py-8 text-muted-foreground">
              暂无注册的 Agent
            </div>
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
                      <Badge className={roleColors[agent.role]}>
                        {roleLabels[agent.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {agent.webhook_url || '-'}
                    </TableCell>
                    <TableCell>
                      {new Date(agent.created_at).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(agent)}
                        className="mr-2"
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(agent)}
                        className="text-red-600 hover:text-red-700"
                      >
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
    </div>
  );
}
