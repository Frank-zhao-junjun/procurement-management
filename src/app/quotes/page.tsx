'use client';

import { useEffect, useState, useCallback } from 'react';
import { quotesApi, sourcingTasksApi, suppliersApi, materialsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Award } from 'lucide-react';
import { getIdentityHeaders } from '@/lib/identity-store';
import { useIdentityChange } from '@/hooks/use-identity-change';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  submitted: { label: '已提交', variant: 'outline' },
  accepted: { label: '已接受', variant: 'default' },
  rejected: { label: '已拒绝', variant: 'destructive' },
};

const awardMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '待授标', variant: 'secondary' },
  awarded: { label: '已授标', variant: 'default' },
};

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // 新建报价相关状态
  const [showNewForm, setShowNewForm] = useState(false);
  const [sourcingTasks, setSourcingTasks] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [newQuote, setNewQuote] = useState({
    sourcingTaskId: '',
    supplierId: '',
    materialId: '',
    unitPrice: '',
    quantity: '',
    validUntil: '',
    notes: '',
  });

  const fetchQuotes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await quotesApi.list({ page, pageSize });
      setQuotes(data.data || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to fetch quotes:', error);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  useIdentityChange(fetchQuotes);

  useEffect(() => {
    async function fetchOptions() {
      try {
        const [tasksData, suppliersData, materialsData] = await Promise.all([
          sourcingTasksApi.list({ status: 'in_progress', pageSize: 100 }),
          suppliersApi.list({ pageSize: 100 }),
          materialsApi.list({ pageSize: 100 }),
        ]);
        setSourcingTasks(tasksData.data || []);
        setSuppliers(suppliersData.data || []);
        setMaterials(materialsData.data || []);
      } catch (error) {
        console.error('Failed to fetch options:', error);
      }
    }

    if (showNewForm) {
      fetchOptions();
    }
  }, [showNewForm]);

  const totalPages = Math.ceil(total / pageSize);

  const handleCreateQuote = async () => {
    try {
      await quotesApi.create({
        sourcingTaskId: parseInt(newQuote.sourcingTaskId),
        supplierId: parseInt(newQuote.supplierId),
        materialId: newQuote.materialId ? parseInt(newQuote.materialId) : null,
        unitPrice: parseFloat(newQuote.unitPrice),
        quantity: parseFloat(newQuote.quantity),
        validUntil: newQuote.validUntil || null,
        notes: newQuote.notes || null,
      });

      setShowNewForm(false);
      setNewQuote({
        sourcingTaskId: '',
        supplierId: '',
        materialId: '',
        unitPrice: '',
        quantity: '',
        validUntil: '',
        notes: '',
      });

      // 刷新列表
      const data = await quotesApi.list({ page, pageSize });
      setQuotes(data.data || []);
      setTotal(data.total || 0);
    } catch (error: any) {
      alert(error.message || '创建失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">报价单管理</h1>
          <p className="text-gray-500 mt-1">管理供应商报价</p>
        </div>
        <Button onClick={() => setShowNewForm(true)}>
          <Plus className="w-4 h-4 mr-2" />
          新建报价单
        </Button>
      </div>

      {/* 新建报价单表单 */}
      {showNewForm && (
        <Card>
          <CardHeader>
            <CardTitle>新建报价单</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">寻源任务 *</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={newQuote.sourcingTaskId}
                  onChange={(e) => setNewQuote((q) => ({ ...q, sourcingTaskId: e.target.value }))}
                >
                  <option value="">请选择寻源任务</option>
                  {sourcingTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.task_number} - {task.material_snapshot || '未指定物料'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">供应商 *</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={newQuote.supplierId}
                  onChange={(e) => setNewQuote((q) => ({ ...q, supplierId: e.target.value }))}
                >
                  <option value="">请选择供应商</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">物料</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={newQuote.materialId}
                  onChange={(e) => setNewQuote((q) => ({ ...q, materialId: e.target.value }))}
                >
                  <option value="">请选择物料（可选）</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name} ({material.code || '无编码'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">单价 *</label>
                <Input
                  type="number"
                  step="0.01"
                  value={newQuote.unitPrice}
                  onChange={(e) => setNewQuote((q) => ({ ...q, unitPrice: e.target.value }))}
                  placeholder="请输入单价"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">数量 *</label>
                <Input
                  type="number"
                  step="0.01"
                  value={newQuote.quantity}
                  onChange={(e) => setNewQuote((q) => ({ ...q, quantity: e.target.value }))}
                  placeholder="请输入数量"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">有效期至</label>
                <Input
                  type="date"
                  value={newQuote.validUntil}
                  onChange={(e) => setNewQuote((q) => ({ ...q, validUntil: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium">备注</label>
                <Input
                  value={newQuote.notes}
                  onChange={(e) => setNewQuote((q) => ({ ...q, notes: e.target.value }))}
                  placeholder="可选备注"
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowNewForm(false)}>
                取消
              </Button>
              <Button
                onClick={handleCreateQuote}
                disabled={!newQuote.sourcingTaskId || !newQuote.supplierId || !newQuote.unitPrice || !newQuote.quantity}
              >
                创建报价单
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>报价单列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : quotes.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无报价单
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>报价单号</TableHead>
                    <TableHead>寻源任务</TableHead>
                    <TableHead>供应商</TableHead>
                    <TableHead>物料名称</TableHead>
                    <TableHead>单价</TableHead>
                    <TableHead>数量</TableHead>
                    <TableHead>总价</TableHead>
                    <TableHead>有效期至</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>授标状态</TableHead>
                    <TableHead>创建人</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell className="font-medium">{quote.quote_number}</TableCell>
                      <TableCell>{quote.sourcing_tasks?.task_number || quote.sourcing_task_id}</TableCell>
                      <TableCell>{quote.supplier_snapshot || quote.suppliers?.name || '-'}</TableCell>
                      <TableCell>{quote.material_snapshot || quote.materials?.name || '-'}</TableCell>
                      <TableCell>{quote.unit_price}</TableCell>
                      <TableCell>{quote.quantity}</TableCell>
                      <TableCell>{quote.total_price || '-'}</TableCell>
                      <TableCell>{quote.valid_until || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={statusMap[quote.status]?.variant || 'secondary'}>
                          {statusMap[quote.status]?.label || quote.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={awardMap[quote.awarded]?.variant || 'secondary'}>
                          {awardMap[quote.awarded]?.label || quote.awarded}
                        </Badge>
                      </TableCell>
                      <TableCell>{quote.created_by}</TableCell>
                      <TableCell>
                        {quote.awarded === 'pending' && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={async () => {
                              if (confirm('确认授标给该供应商？授标后将自动创建采购订单。')) {
                                try {
                                  const response = await fetch(`/api/quotes/${quote.id}/award`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      ...getIdentityHeaders(),
                                    },
                                  });
                                  const result = await response.json();
                                  if (result.success) {
                                    alert(`授标成功！已创建采购订单: ${result.purchaseOrder.po_number}`);
                                    // 刷新列表
                                    const data = await quotesApi.list({ page, pageSize });
                                    setQuotes(data.data || []);
                                    setTotal(data.total || 0);
                                  } else {
                                    alert(result.error || '授标失败');
                                  }
                                } catch (error: any) {
                                  alert(error.message || '授标失败');
                                }
                              }
                            }}
                          >
                            <Award className="w-4 h-4 mr-1" />
                            授标
                          </Button>
                        )}
                        {quote.awarded === 'awarded' && (
                          <span className="text-green-600 text-sm">已中标</span>
                        )}
                        {quote.awarded === 'rejected' && (
                          <span className="text-gray-400 text-sm">未中标</span>
                        )}
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
