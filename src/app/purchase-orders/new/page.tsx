'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { purchaseOrdersApi, suppliersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { getIdentityHeaders } from '@/lib/identity-store';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    supplierId: '',
    supplierSnapshot: '',
    deliveryDate: '',
    lines: [{ materialSnapshot: '', quantity: '', unitPrice: '' }],
  });

  useEffect(() => {
    async function fetchSuppliers() {
      try {
        const data = await suppliersApi.list({ pageSize: 100 });
        setSuppliers(data.data || []);
      } catch (error) {
        console.error('Failed to fetch suppliers:', error);
      }
    }
    fetchSuppliers();
  }, []);

  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find(s => s.id === parseInt(supplierId));
    setFormData(prev => ({
      ...prev,
      supplierId,
      supplierSnapshot: supplier?.name || '',
    }));
  };

  const handleLineChange = (index: number, field: string, value: string) => {
    setFormData(prev => {
      const lines = [...prev.lines];
      lines[index] = { ...lines[index], [field]: value };
      return { ...prev, lines };
    });
  };

  const addLine = () => {
    setFormData(prev => ({
      ...prev,
      lines: [...prev.lines, { materialSnapshot: '', quantity: '', unitPrice: '' }],
    }));
  };

  const removeLine = (index: number) => {
    if (formData.lines.length > 1) {
      setFormData(prev => ({
        ...prev,
        lines: prev.lines.filter((_, i) => i !== index),
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.supplierId) {
      alert('请选择供应商');
      return;
    }

    setLoading(true);
    try {
      const result = await purchaseOrdersApi.create({
        supplierId: parseInt(formData.supplierId),
        supplierSnapshot: formData.supplierSnapshot,
        deliveryDate: formData.deliveryDate || null,
        lines: formData.lines.map((line, index) => ({
          materialSnapshot: line.materialSnapshot,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          lineNumber: index + 1,
        })),
      });

      alert(`采购订单创建成功: ${result.data.po_number}`);
      router.push('/purchase-orders');
    } catch (error: any) {
      alert(error.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">新建采购订单</h1>
          <p className="text-gray-500 mt-1">手动创建采购订单（或通过授标报价单自动创建）</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">供应商 *</label>
                <select
                  className="w-full mt-1 px-3 py-2 border rounded"
                  value={formData.supplierId}
                  onChange={(e) => handleSupplierChange(e.target.value)}
                  required
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
                <label className="text-sm font-medium">到货日期</label>
                <Input
                  type="date"
                  value={formData.deliveryDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, deliveryDate: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>订单行项目</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                添加行
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {formData.lines.map((line, index) => (
                <div key={index} className="grid grid-cols-12 gap-4 items-end">
                  <div className="col-span-5">
                    <label className="text-sm font-medium">物料描述</label>
                    <Input
                      value={line.materialSnapshot}
                      onChange={(e) => handleLineChange(index, 'materialSnapshot', e.target.value)}
                      placeholder="物料名称或描述"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium">数量</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                      placeholder="数量"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium">单价</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => handleLineChange(index, 'unitPrice', e.target.value)}
                      placeholder="单价"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium">总价</label>
                    <div className="mt-1 px-3 py-2 bg-gray-50 rounded text-gray-600">
                      {((parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0)).toFixed(2)}
                    </div>
                  </div>
                  <div className="col-span-1">
                    {formData.lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(index)}
                        className="text-red-500"
                      >
                        删除
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4 mt-6">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? '创建中...' : '创建采购订单'}
          </Button>
        </div>
      </form>
    </div>
  );
}
