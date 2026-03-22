'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { purchaseRequestsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';

interface LineItem {
  requirementText: string;
  quantity: string;
  estUnitPrice: string;
  expectedDeliveryDate: string;
  note: string;
}

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineItem[]>([
    {
      requirementText: '',
      quantity: '',
      estUnitPrice: '',
      expectedDeliveryDate: '',
      note: '',
    },
  ]);

  const addLine = () => {
    setLines([
      ...lines,
      {
        requirementText: '',
        quantity: '',
        estUnitPrice: '',
        expectedDeliveryDate: '',
        note: '',
      },
    ]);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: keyof LineItem, value: string) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lines.length === 0) {
      alert('至少需要一行明细');
      return;
    }

    const validLines = lines.filter((l) => l.requirementText && l.quantity);
    if (validLines.length === 0) {
      alert('至少需要填写一行完整的明细（需求描述和数量必填）');
      return;
    }

    try {
      setLoading(true);
      const result = await purchaseRequestsApi.create(
        {
          reason,
          lines: lines.map((l) => ({
            requirementText: l.requirementText,
            quantity: parseFloat(l.quantity) || 0,
            estUnitPrice: l.estUnitPrice ? parseFloat(l.estUnitPrice) : null,
            expectedDeliveryDate: l.expectedDeliveryDate || null,
            note: l.note || null,
          })),
        },
        'agent:user'
      );
      router.push(`/purchase-requests/${result.data.id}`);
    } catch (error: any) {
      alert(error.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">新建采购申请</h1>
          <p className="text-gray-500 mt-1">填写采购申请信息</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="reason">申请原因</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="请输入采购申请原因"
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>采购明细</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="w-4 h-4 mr-2" />
              添加行
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid grid-cols-12 gap-4 p-4 border rounded-lg bg-gray-50"
                >
                  <div className="col-span-4">
                    <Label htmlFor={`line-${index}-desc`}>需求描述 *</Label>
                    <Input
                      id={`line-${index}-desc`}
                      value={line.requirementText}
                      onChange={(e) => updateLine(index, 'requirementText', e.target.value)}
                      placeholder="如：M3 螺丝"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor={`line-${index}-qty`}>数量 *</Label>
                    <Input
                      id={`line-${index}-qty`}
                      type="number"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => updateLine(index, 'quantity', e.target.value)}
                      placeholder="0"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor={`line-${index}-price`}>预估单价</Label>
                    <Input
                      id={`line-${index}-price`}
                      type="number"
                      step="0.01"
                      value={line.estUnitPrice}
                      onChange={(e) => updateLine(index, 'estUnitPrice', e.target.value)}
                      placeholder="0.00"
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor={`line-${index}-date`}>期望交货日期</Label>
                    <Input
                      id={`line-${index}-date`}
                      type="date"
                      value={line.expectedDeliveryDate}
                      onChange={(e) => updateLine(index, 'expectedDeliveryDate', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div className="col-span-1 flex items-end">
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(index)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                  <div className="col-span-12">
                    <Label htmlFor={`line-${index}-note`}>备注</Label>
                    <Input
                      id={`line-${index}-note`}
                      value={line.note}
                      onChange={(e) => updateLine(index, 'note', e.target.value)}
                      placeholder="可选备注"
                      className="mt-1"
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? '创建中...' : '创建采购申请'}
          </Button>
        </div>
      </form>
    </div>
  );
}
