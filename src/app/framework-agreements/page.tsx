'use client';

import { useEffect, useState, useCallback } from 'react';
import { frameworkAgreementsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus } from 'lucide-react';
import { useIdentityChange } from '@/hooks/use-identity-change';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active: { label: '生效中', variant: 'default' },
  expired: { label: '已过期', variant: 'secondary' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

export default function FrameworkAgreementsPage() {
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const fetchAgreements = useCallback(async () => {
    try {
      setLoading(true);
      const data = await frameworkAgreementsApi.list({ page, pageSize });
      setAgreements(data.data || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch agreements:', error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchAgreements();
  }, [fetchAgreements]);

  // 监听身份变化，自动刷新
  useIdentityChange(fetchAgreements);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">框架协议</h1>
          <p className="text-gray-500 mt-1">管理框架协议（无审批流）</p>
        </div>
        <Button asChild>
          <a href="/framework-agreements/new">
            <Plus className="w-4 h-4 mr-2" />
            新建框架协议
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>框架协议列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : agreements.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无框架协议
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>协议号</TableHead>
                    <TableHead>供应商</TableHead>
                    <TableHead>物料</TableHead>
                    <TableHead>单价</TableHead>
                    <TableHead>有效期</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建人</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agreements.map((agreement) => (
                    <TableRow key={agreement.id}>
                      <TableCell className="font-medium">{agreement.fa_number}</TableCell>
                      <TableCell>{agreement.supplier_snapshot || '-'}</TableCell>
                      <TableCell>{agreement.material_snapshot || agreement.material_original_text || '-'}</TableCell>
                      <TableCell>{agreement.unit_price}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {agreement.valid_from} ~ {agreement.valid_to}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusMap[agreement.status]?.variant || 'secondary'}>
                          {statusMap[agreement.status]?.label || agreement.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{agreement.created_by}</TableCell>
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
