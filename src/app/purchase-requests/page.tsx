'use client';

import { useEffect, useState } from 'react';
import { purchaseRequestsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus } from 'lucide-react';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  submitted: { label: '待审批', variant: 'outline' },
  approved: { label: '已批准', variant: 'default' },
  rejected: { label: '已拒绝', variant: 'destructive' },
};

const progressMap: Record<string, string> = {
  pending: '未审批',
  approved: '已审批',
  matched_protocol: '已匹配协议',
  sourced: '已寻源',
  quoted: '已报价',
  awarded: '已授标',
  ordered: '已下单',
  partial_received: '部分收货',
  received: '已收货',
  return_pending: '退货待补货',
};

export default function PurchaseRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    async function fetchRequests() {
      try {
        setLoading(true);
        const data = await purchaseRequestsApi.list({
          status: statusFilter || undefined,
          page,
          pageSize,
        });
        setRequests(data.data || []);
        setTotal(data.total || 0);
      } catch (error) {
        console.error('Failed to fetch requests:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchRequests();
  }, [statusFilter, page]);

  const totalPages = Math.ceil(total / pageSize);

  const handleSubmit = async (id: number) => {
    try {
      await purchaseRequestsApi.submit(id, 'agent:user');
      setRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: 'submitted' } : r))
      );
    } catch (error) {
      alert('提交失败');
    }
  };

  const handleApprove = async (id: number, approved: boolean) => {
    try {
      const result = await purchaseRequestsApi.approve(id, approved, undefined, 'agent:manager', 'manager');
      setRequests((prev) =>
        prev.map((r) => (r.id === id ? result.data : r))
      );
    } catch (error) {
      alert(approved ? '审批失败' : '拒绝失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">采购申请</h1>
          <p className="text-gray-500 mt-1">管理采购申请</p>
        </div>
        <Button asChild>
          <a href="/purchase-requests/new">
            <Plus className="w-4 h-4 mr-2" />
            新建采购申请
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>采购申请列表</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('')}
              >
                全部
              </Button>
              <Button
                variant={statusFilter === 'draft' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('draft')}
              >
                草稿
              </Button>
              <Button
                variant={statusFilter === 'submitted' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('submitted')}
              >
                待审批
              </Button>
              <Button
                variant={statusFilter === 'approved' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('approved')}
              >
                已批准
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : requests.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无采购申请
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>申请号</TableHead>
                    <TableHead>申请人</TableHead>
                    <TableHead>申请原因</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>行数</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">{request.pr_number}</TableCell>
                      <TableCell>{request.applicant}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {request.reason || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusMap[request.status]?.variant || 'secondary'}>
                          {statusMap[request.status]?.label || request.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{request.purchase_request_lines?.length || 0}</TableCell>
                      <TableCell>
                        {request.created_at ? new Date(request.created_at).toLocaleString('zh-CN') : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/purchase-requests/${request.id}`}>
                              查看
                            </a>
                          </Button>
                          {request.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSubmit(request.id)}
                            >
                              提交
                            </Button>
                          )}
                          {request.status === 'submitted' && (
                            <>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => handleApprove(request.id, true)}
                              >
                                批准
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleApprove(request.id, false)}
                              >
                                拒绝
                              </Button>
                            </>
                          )}
                        </div>
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
