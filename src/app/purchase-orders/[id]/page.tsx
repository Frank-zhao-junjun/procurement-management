'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Send, Package, X, Trash2, Edit } from 'lucide-react';
import { getIdentityHeaders } from '@/lib/identity-store';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  sent: { label: '已发送', variant: 'outline' },
  partial: { label: '部分收货', variant: 'outline' },
  received: { label: '已收货', variant: 'default' },
  cancelled: { label: '已取消', variant: 'destructive' },
};

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const poId = params.id as string;
  
  const [po, setPo] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    delivery_date: '',
    lines: [] as { material_snapshot: string; quantity: number; unit_price: number }[],
  });

  useEffect(() => {
    async function fetchPO() {
      try {
        setLoading(true);
        
        // 获取订单详情
        const poRes = await fetch(`/api/purchase-orders/${poId}`, {
          headers: getIdentityHeaders(),
        });
        const poData = await poRes.json();
        
        if (poData.data) {
          setPo(poData.data);
          setLines(poData.data.lines || []);
        }
      } catch (error) {
        console.error('Failed to fetch PO:', error);
      } finally {
        setLoading(false);
      }
    }

    if (poId) {
      fetchPO();
    }
  }, [poId]);

  const handleUpdateStatus = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getIdentityHeaders(),
        },
        body: JSON.stringify({ status: newStatus }),
      });
      
      if (res.ok) {
        // 刷新数据
        const poRes = await fetch(`/api/purchase-orders/${poId}`, {
          headers: getIdentityHeaders(),
        });
        const poData = await poRes.json();
        if (poData.data) {
          setPo(poData.data);
          setLines(poData.data.lines || []);
        }
      }
    } catch (error) {
      alert('更新状态失败');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确认删除采购订单 ${po.po_number}？此操作不可撤销。`)) {
      return;
    }
    
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, {
        method: 'DELETE',
        headers: getIdentityHeaders(),
      });
      
      const result = await res.json();
      
      if (result.success) {
        alert(result.message);
        router.push('/purchase-orders');
      } else {
        alert(result.error || '删除失败');
      }
    } catch (error: any) {
      alert(error.message || '删除失败');
    }
  };

  const startEditing = () => {
    setEditForm({
      delivery_date: po.delivery_date || '',
      lines: lines.map(l => ({
        material_snapshot: l.material_snapshot || '',
        quantity: l.quantity || 0,
        unit_price: l.unit_price || 0,
      })),
    });
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getIdentityHeaders(),
        },
        body: JSON.stringify(editForm),
      });
      
      const result = await res.json();
      
      if (result.success) {
        setPo(result.data);
        setLines(result.data.lines || []);
        setEditing(false);
      } else {
        alert(result.error || '更新失败');
      }
    } catch (error: any) {
      alert(error.message || '更新失败');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-gray-500">采购订单不存在</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 返回按钮 */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
      </div>

      {/* 订单基本信息 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">采购订单 {po.po_number}</CardTitle>
              <p className="text-gray-500 mt-1">
                创建于 {po.created_at ? new Date(po.created_at).toLocaleString('zh-CN') : '-'}
              </p>
            </div>
            <Badge variant={statusMap[po.status]?.variant || 'secondary'} className="text-sm px-3 py-1">
              {statusMap[po.status]?.label || po.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-500">供应商</p>
              <p className="text-lg font-medium">{po.supplier_snapshot || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">交货日期</p>
              <p className="text-lg font-medium">{po.delivery_date || '未设置'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">订单总金额</p>
              <p className="text-lg font-medium">
                ¥{lines.reduce((sum, l) => sum + (l.total_price || 0), 0).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">创建人</p>
              <p className="text-lg font-medium">{po.created_by || '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 订单行项目 */}
      <Card>
        <CardHeader>
          <CardTitle>订单行项目</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 && !editing ? (
            <div className="text-center py-8 text-gray-500">暂无订单行</div>
          ) : editing ? (
            <div className="space-y-4">
              {/* 编辑交货日期 */}
              <div>
                <label className="text-sm font-medium">交货日期</label>
                <input
                  type="date"
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={editForm.delivery_date}
                  onChange={(e) => setEditForm(f => ({ ...f, delivery_date: e.target.value }))}
                />
              </div>
              
              {/* 编辑订单行 */}
              <div className="border rounded p-4">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-medium">订单行</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditForm(f => ({
                      ...f,
                      lines: [...f.lines, { material_snapshot: '', quantity: 1, unit_price: 0 }]
                    }))}
                  >
                    + 添加行
                  </Button>
                </div>
                
                {editForm.lines.map((line, index) => (
                  <div key={index} className="flex gap-2 items-center mb-2">
                    <input
                      type="text"
                      placeholder="物料名称"
                      className="flex-1 px-3 py-2 border rounded"
                      value={line.material_snapshot}
                      onChange={(e) => {
                        const newLines = [...editForm.lines];
                        newLines[index].material_snapshot = e.target.value;
                        setEditForm(f => ({ ...f, lines: newLines }));
                      }}
                    />
                    <input
                      type="number"
                      placeholder="数量"
                      className="w-24 px-3 py-2 border rounded"
                      value={line.quantity}
                      onChange={(e) => {
                        const newLines = [...editForm.lines];
                        newLines[index].quantity = parseFloat(e.target.value) || 0;
                        setEditForm(f => ({ ...f, lines: newLines }));
                      }}
                    />
                    <input
                      type="number"
                      placeholder="单价"
                      className="w-32 px-3 py-2 border rounded"
                      value={line.unit_price}
                      onChange={(e) => {
                        const newLines = [...editForm.lines];
                        newLines[index].unit_price = parseFloat(e.target.value) || 0;
                        setEditForm(f => ({ ...f, lines: newLines }));
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      onClick={() => {
                        const newLines = editForm.lines.filter((_, i) => i !== index);
                        setEditForm(f => ({ ...f, lines: newLines }));
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                
                {editForm.lines.length > 0 && (
                  <div className="mt-4 pt-4 border-t text-right">
                    <span className="text-gray-500">订单总金额: </span>
                    <span className="font-medium text-lg">
                      ¥{editForm.lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>行号</TableHead>
                  <TableHead>物料</TableHead>
                  <TableHead>数量</TableHead>
                  <TableHead>单价</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>已收货</TableHead>
                  <TableHead>待收货</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={line.id || index}>
                    <TableCell>{line.line_number || index + 1}</TableCell>
                    <TableCell className="font-medium">{line.material_snapshot || '-'}</TableCell>
                    <TableCell>{line.quantity}</TableCell>
                    <TableCell>¥{line.unit_price?.toLocaleString() || 0}</TableCell>
                    <TableCell>¥{line.total_price?.toLocaleString() || 0}</TableCell>
                    <TableCell>{line.received_qty || 0}</TableCell>
                    <TableCell>{line.pending_qty || line.quantity}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{line.status || 'ordered'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3">
            {po.status === 'draft' && !editing && (
              <>
                <Button onClick={() => handleUpdateStatus('sent')}>
                  <Send className="w-4 h-4 mr-2" />
                  发送订单
                </Button>
                <Button variant="outline" onClick={startEditing}>
                  <Edit className="w-4 h-4 mr-2" />
                  编辑
                </Button>
                <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </Button>
              </>
            )}
            {po.status === 'draft' && editing && (
              <>
                <Button onClick={handleSaveEdit}>
                  保存修改
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)}>
                  取消
                </Button>
              </>
            )}
            {po.status === 'sent' && (
              <Button onClick={() => router.push(`/goods-receipts/new?poId=${poId}`)}>
                <Package className="w-4 h-4 mr-2" />
                创建收货单
              </Button>
            )}
            {po.status === 'draft' && !editing && (
              <Button variant="outline" onClick={() => handleUpdateStatus('cancelled')}>
                <X className="w-4 h-4 mr-2" />
                取消订单
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
