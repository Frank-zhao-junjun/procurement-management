'use client';

import { useEffect, useState, useCallback } from 'react';
import { auditLogsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useIdentityChange } from '@/hooks/use-identity-change';

const actionMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  create: { label: '创建', variant: 'default' },
  update: { label: '更新', variant: 'outline' },
  delete: { label: '删除', variant: 'destructive' },
  submit: { label: '提交', variant: 'outline' },
  approve: { label: '批准', variant: 'default' },
  reject: { label: '拒绝', variant: 'destructive' },
  receive: { label: '收货', variant: 'default' },
  return: { label: '退货', variant: 'destructive' },
};

const entityMap: Record<string, string> = {
  material: '物料',
  supplier: '供应商',
  purchase_request: '采购申请',
  purchase_request_line: '采购申请行',
  purchase_order: '采购订单',
  purchase_order_line: '采购订单行',
  sourcing_task: '寻源任务',
  quote: '报价单',
  framework_agreement: '框架协议',
  goods_receipt: '收货单',
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await auditLogsApi.list({ page, pageSize });
      setLogs(data.data || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 监听身份变化，自动刷新
  useIdentityChange(fetchLogs);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">审计日志</h1>
        <p className="text-gray-500 mt-1">查看所有系统操作记录</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>操作日志</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无审计日志
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>操作者</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>实体类型</TableHead>
                    <TableHead>实体ID</TableHead>
                    <TableHead>操作</TableHead>
                    <TableHead>详情</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        {log.created_at ? new Date(log.created_at).toLocaleString('zh-CN') : '-'}
                      </TableCell>
                      <TableCell className="font-medium">{log.actor}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{log.actor_role || '-'}</Badge>
                      </TableCell>
                      <TableCell>{entityMap[log.entity_type] || log.entity_type}</TableCell>
                      <TableCell>{log.entity_id}</TableCell>
                      <TableCell>
                        <Badge variant={actionMap[log.action]?.variant || 'secondary'}>
                          {actionMap[log.action]?.label || log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-gray-500">
                        {log.detail ? JSON.stringify(log.detail) : '-'}
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
