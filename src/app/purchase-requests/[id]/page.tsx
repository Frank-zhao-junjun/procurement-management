'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { purchaseRequestsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useIdentityChange } from '@/hooks/use-identity-change';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  submitted: { label: '待审批', variant: 'outline' },
  approved: { label: '已批准', variant: 'default' },
  rejected: { label: '已拒绝', variant: 'destructive' },
};

const progressMap: Record<string, string> = {
  pending: '未审批',
  sourced: '已寻源',
  quoted: '已报价',
  awarded: '已授标',
  ordered: '已下单',
  partial_received: '部分收货',
  received: '已收货',
  return_pending: '退货待补货',
};

interface PRLine {
  id: number;
  line_number: number;
  material_id: number | null;
  material_snapshot: string;
  requirement_text: string;
  quantity: number;
  est_unit_price: number | null;
  expected_delivery_date: string | null;
  note: string | null;
  progress: string;
  fa_id: number | null;
  purchase_order_id: number | null;
  po_line_number: number | null;
}

interface PurchaseRequest {
  id: number;
  pr_number: string;
  applicant: string;
  applicant_role: string;
  reason: string;
  status: string;
  lines_snapshot: string | null;
  created_at: string;
  updated_at: string | null;
  purchase_request_lines?: PRLine[];
}

export default function PurchaseRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<PRLine[]>([]);

  const fetchRequest = async () => {
    try {
      setLoading(true);
      setError(null);
      const id = params.id as string;
      const data = await purchaseRequestsApi.get(parseInt(id, 10));
      
      if (data.data) {
        setRequest(data.data);
        // 如果有行项目数据，使用行项目；否则解析快照
        if (data.data.purchase_request_lines && data.data.purchase_request_lines.length > 0) {
          setLines(data.data.purchase_request_lines);
        } else if (data.data.lines_snapshot) {
          try {
            const parsed = JSON.parse(data.data.lines_snapshot);
            if (Array.isArray(parsed)) {
              setLines(parsed.map((l: any, i: number) => ({
                id: i + 1,
                line_number: l.line_number || i + 1,
                material_id: l.material_id || null,
                material_snapshot: l.material_snapshot || l.material_name || l.requirementText || '',
                requirement_text: l.requirement_text || l.requirementText || l.description || '',
                quantity: l.quantity || l.qty || 0,
                est_unit_price: l.est_unit_price || l.estUnitPrice || null,
                expected_delivery_date: l.expected_delivery_date || l.expectedDeliveryDate || null,
                note: l.note || null,
                progress: l.progress || 'pending',
                fa_id: l.fa_id || null,
                purchase_order_id: l.purchase_order_id || null,
                po_line_number: l.po_line_number || null,
              })));
            }
          } catch (e) {
            console.error('Failed to parse lines_snapshot:', e);
          }
        }
      } else {
        setError('采购申请不存在');
      }
    } catch (err: any) {
      setError(err.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequest();
  }, [params.id]);

  // 监听身份变化，自动刷新
  useIdentityChange(fetchRequest);

  const handleSubmit = async () => {
    if (!request) return;
    try {
      await purchaseRequestsApi.submit(request.id);
      fetchRequest();
    } catch (err: any) {
      alert(err.message || '提交失败');
    }
  };

  const handleApprove = async (approved: boolean) => {
    if (!request) return;
    try {
      await purchaseRequestsApi.approve(request.id, approved);
      fetchRequest();
    } catch (err: any) {
      alert(err.message || (approved ? '审批失败' : '拒绝失败'));
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center py-8 text-gray-500">加载中...</div>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center py-8">
          <p className="text-red-500 mb-4">{error || '采购申请不存在'}</p>
          <Button variant="outline" onClick={() => router.push('/purchase-requests')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回列表
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* 返回按钮 */}
      <Button variant="ghost" onClick={() => router.push('/purchase-requests')}>
        <ArrowLeft className="w-4 h-4 mr-2" />
        返回列表
      </Button>

      {/* 基本信息 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">采购申请详情</CardTitle>
              <p className="text-muted-foreground mt-1">申请号: {request.pr_number}</p>
            </div>
            <Badge variant={statusMap[request.status]?.variant || 'secondary'} className="text-base px-4 py-1">
              {statusMap[request.status]?.label || request.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-muted-foreground">申请人</p>
              <p className="font-medium">{request.applicant}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">申请人角色</p>
              <p className="font-medium">{request.applicant_role}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">申请原因</p>
              <p className="font-medium">{request.reason || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">创建时间</p>
              <p className="font-medium">
                {request.created_at ? new Date(request.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      {request.status === 'draft' && (
        <div className="flex justify-end gap-2">
          <Button onClick={handleSubmit}>
            提交审批
          </Button>
        </div>
      )}

      {request.status === 'submitted' && (
        <div className="flex justify-end gap-2">
          <Button variant="destructive" onClick={() => handleApprove(false)}>
            <X className="w-4 h-4 mr-2" />
            拒绝
          </Button>
          <Button onClick={() => handleApprove(true)}>
            <Check className="w-4 h-4 mr-2" />
            批准
          </Button>
        </div>
      )}

      {/* 物料行项目 */}
      <Card>
        <CardHeader>
          <CardTitle>物料清单</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无物料信息
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">行号</TableHead>
                  <TableHead>物料编码</TableHead>
                  <TableHead>物料描述</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">预估单价</TableHead>
                  <TableHead className="text-right">预估总价</TableHead>
                  <TableHead>期望交货日期</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.line_number}</TableCell>
                    <TableCell className="font-mono">
                      {line.material_id ? `MAT-${String(line.material_id).padStart(6, '0')}` : '-'}
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={line.material_snapshot || line.requirement_text}>
                      {line.material_snapshot || line.requirement_text || '-'}
                    </TableCell>
                    <TableCell className="text-right">{Number(line.quantity).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      {line.est_unit_price ? `¥${Number(line.est_unit_price).toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.est_unit_price && line.quantity 
                        ? `¥${(Number(line.est_unit_price) * Number(line.quantity)).toLocaleString()}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {line.expected_delivery_date 
                        ? new Date(line.expected_delivery_date).toLocaleDateString('zh-CN')
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={line.progress === 'received' ? 'default' : 'outline'}>
                        {progressMap[line.progress] || line.progress || '未处理'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {line.note || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 汇总信息 */}
      {lines.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex justify-end gap-8">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">物料行数</p>
                <p className="text-xl font-bold">{lines.length}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">预估总金额</p>
                <p className="text-xl font-bold">
                  ¥{lines.reduce((sum, l) => {
                    const price = Number(l.est_unit_price) || 0;
                    const qty = Number(l.quantity) || 0;
                    return sum + price * qty;
                  }, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
