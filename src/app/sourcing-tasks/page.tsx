'use client';

import { useEffect, useState, useCallback } from 'react';
import { sourcingTasksApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus } from 'lucide-react';
import { useIdentityChange } from '@/hooks/use-identity-change';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '待处理', variant: 'secondary' },
  in_progress: { label: '进行中', variant: 'outline' },
  completed: { label: '已完成', variant: 'default' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

export default function SourcingTasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    async function fetchTasks() {
      try {
        setLoading(true);
        const data = await sourcingTasksApi.list({
          status: statusFilter || undefined,
          page,
          pageSize,
        });
        setTasks(data.data || []);
        setTotal(data.total || 0);
      } catch (error) {
        console.error('Failed to fetch tasks:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchTasks();
  }, [statusFilter, page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">寻源任务</h1>
          <p className="text-gray-500 mt-1">管理寻源任务和报价</p>
        </div>
        <Button asChild>
          <a href="/sourcing-tasks/new">
            <Plus className="w-4 h-4 mr-2" />
            新建寻源任务
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>寻源任务列表</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('')}
              >
                全部
              </Button>
              <Button
                variant={statusFilter === 'pending' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('pending')}
              >
                待处理
              </Button>
              <Button
                variant={statusFilter === 'in_progress' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('in_progress')}
              >
                进行中
              </Button>
              <Button
                variant={statusFilter === 'completed' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('completed')}
              >
                已完成
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无寻源任务
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>任务号</TableHead>
                    <TableHead>关联PR</TableHead>
                    <TableHead>物料</TableHead>
                    <TableHead>目标供应商</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>截止日期</TableHead>
                    <TableHead>创建人</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{task.task_number}</TableCell>
                      <TableCell>{task.purchase_requests?.pr_number || task.pr_id}</TableCell>
                      <TableCell>{task.material_snapshot || '-'}</TableCell>
                      <TableCell>{task.target_supplier_snapshot || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={statusMap[task.status]?.variant || 'secondary'}>
                          {statusMap[task.status]?.label || task.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{task.due_date || '-'}</TableCell>
                      <TableCell>{task.created_by}</TableCell>
                      <TableCell>
                        {task.created_at ? new Date(task.created_at).toLocaleDateString('zh-CN') : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-gray-500">
                    共 {total} 条记录，第 {page}/{totalPages} 页
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
