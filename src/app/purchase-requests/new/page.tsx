'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Trash2,
  ArrowLeft,
  Check,
  X,
  AlertCircle,
  Search,
} from 'lucide-react';

interface LineItem {
  id: number;
  requirementText: string;
  quantity: string;
  estUnitPrice: string;
  expectedDeliveryDate: string;
  note: string;
  // 物料确认相关
  checked?: {
    found: boolean;
    exactMatch?: { id: number; code: string; name: string; unit: string };
    suggestions?: Array<{ material: { id: number; code: string; name: string; unit: string }; similarity: number; matchType: string }>;
    action: string;
    message: string;
  };
  confirmedMaterialId?: number | null;
  confirmedMaterialName?: string;
  confirmedMaterialUnit?: string;
}

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineItem[]>([
    {
      id: Date.now(),
      requirementText: '',
      quantity: '',
      estUnitPrice: '',
      expectedDeliveryDate: '',
      note: '',
    },
  ]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [step, setStep] = useState<'input' | 'confirm'>('input');

  // 加载物料列表用于搜索
  useEffect(() => {
    const fetchMaterials = async () => {
      try {
        const res = await api.get<{ data: any[] }>('/materials', { pageSize: 100 });
        setMaterials(res.data || []);
      } catch (err) {
        console.error('Failed to fetch materials:', err);
      }
    };
    fetchMaterials();
  }, []);

  const addLine = () => {
    setLines([
      ...lines,
      {
        id: Date.now(),
        requirementText: '',
        quantity: '',
        estUnitPrice: '',
        expectedDeliveryDate: '',
        note: '',
      },
    ]);
  };

  const removeLine = (id: number) => {
    setLines(lines.filter((l) => l.id !== id));
  };

  const updateLine = (id: number, field: keyof LineItem, value: string) => {
    setLines(
      lines.map((l) =>
        l.id === id ? { ...l, [field]: value, checked: undefined } : l
      )
    );
  };

  // 检查物料
  const checkMaterials = async () => {
    const validLines = lines.filter((l) => l.requirementText && l.quantity);
    if (validLines.length === 0) {
      alert('至少需要填写一行完整的明细（需求描述和数量必填）');
      return;
    }

    setChecking(true);
    try {
      const res = await api.post<any>('/purchase-requests/check-materials', {
        lines: validLines.map((l) => ({
          requirementText: l.requirementText,
          quantity: parseFloat(l.quantity) || 0,
        })),
      });

      // 合并检查结果
      const checkedLines = lines.map((l) => {
        const checked = res.lines?.find(
          (c: any) => c.requirementText === l.requirementText
        );
        if (checked) {
          return {
            ...l,
            checked,
            confirmedMaterialId: checked.exactMatch?.id || null,
            confirmedMaterialName: checked.exactMatch?.name || l.requirementText,
            confirmedMaterialUnit: checked.exactMatch?.unit || '个',
          };
        }
        return l;
      });

      setLines(checkedLines);

      if (res.nextAction === 'confirm_materials') {
        setStep('confirm');
      } else {
        // 直接创建
        await createPR(checkedLines);
      }
    } catch (err: any) {
      alert(err.message || '检查物料失败');
    } finally {
      setChecking(false);
    }
  };

  // 确认物料选择
  const confirmMaterial = (lineId: number, materialId: number | null, name: string, unit: string) => {
    setLines(
      lines.map((l) =>
        l.id === lineId
          ? { ...l, confirmedMaterialId: materialId, confirmedMaterialName: name, confirmedMaterialUnit: unit }
          : l
      )
    );
  };

  // 创建采购申请
  const createPR = async (linesToUse?: LineItem[]) => {
    const activeLines = (linesToUse || lines).filter(
      (l) => l.requirementText && l.quantity
    );
    
    if (activeLines.length === 0) {
      alert('至少需要一行明细');
      return;
    }

    setLoading(true);
    try {
      const result = await api.post<any>('/purchase-requests/confirm-materials', {
        reason,
        lines: activeLines.map((l) => ({
          requirementText: l.requirementText,
          quantity: parseFloat(l.quantity) || 0,
          estUnitPrice: l.estUnitPrice ? parseFloat(l.estUnitPrice) : null,
          expectedDeliveryDate: l.expectedDeliveryDate || null,
          note: l.note || null,
          confirmedMaterialId: l.confirmedMaterialId || null,
          confirmedMaterialName: l.confirmedMaterialName || l.requirementText,
          confirmedMaterialUnit: l.confirmedMaterialUnit || '个',
        })),
      });

      if (result.created) {
        // 如果有新创建的物料，提示用户
        if (result.data.new_materials?.length > 0) {
          const names = result.data.new_materials.map((m: any) => m.name).join(', ');
          alert(`采购申请已创建，同时在物料主数据中新建了以下物料：${names}`);
        }
        router.push(`/purchase-requests/${result.data.id}`);
      } else {
        alert(result.message || '创建失败');
      }
    } catch (error: any) {
      alert(error.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {step === 'input' ? '新建采购申请' : '确认物料'}
          </h1>
          <p className="text-gray-500 mt-1">
            {step === 'input' ? '填写采购申请信息' : '确认或创建物料主数据'}
          </p>
        </div>
      </div>

      {/* 基本信息 */}
      <Card>
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

      {/* 采购明细 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>采购明细</CardTitle>
          {step === 'input' && (
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="w-4 h-4 mr-2" />
              添加行
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">行号</TableHead>
                <TableHead>需求描述 *</TableHead>
                <TableHead>物料</TableHead>
                <TableHead className="w-24">数量 *</TableHead>
                <TableHead className="w-28">预估单价</TableHead>
                <TableHead className="w-36">期望交货日期</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={line.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Input
                      value={line.requirementText}
                      onChange={(e) =>
                        updateLine(line.id, 'requirementText', e.target.value)
                      }
                      placeholder="如：无线鼠标"
                      disabled={step === 'confirm'}
                    />
                  </TableCell>
                  <TableCell>
                    {step === 'confirm' && line.checked ? (
                      <div className="space-y-2">
                        {line.checked.exactMatch ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="default" className="font-mono">
                              {line.checked.exactMatch.code}
                            </Badge>
                            <span>{line.checked.exactMatch.name}</span>
                          </div>
                        ) : line.checked.suggestions && line.checked.suggestions.length > 0 ? (
                          <Select
                            value={String(line.confirmedMaterialId || '')}
                            onValueChange={(v) => {
                              if (v === '__new__') {
                                confirmMaterial(line.id, null, line.requirementText, '个');
                              } else {
                                const m = line.checked!.suggestions!.find(
                                  (s) => String(s.material.id) === v
                                );
                                if (m) {
                                  confirmMaterial(line.id, m.material.id, m.material.name, m.material.unit);
                                }
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择物料" />
                            </SelectTrigger>
                            <SelectContent>
                              {line.checked.suggestions.map((s) => (
                                <SelectItem
                                  key={s.material.id}
                                  value={String(s.material.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant={
                                        s.matchType === 'high'
                                          ? 'default'
                                          : s.matchType === 'medium'
                                          ? 'secondary'
                                          : 'outline'
                                      }
                                      className="font-mono text-xs"
                                    >
                                      {s.matchType === 'high'
                                        ? '高'
                                        : s.matchType === 'medium'
                                        ? '中'
                                        : '低'}
                                    </Badge>
                                    <span>{s.material.name}</span>
                                    <span className="text-muted-foreground text-xs">
                                      ({s.material.code})
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                              <SelectItem value="__new__">
                                <div className="flex items-center gap-2 text-primary font-medium">
                                  <Plus className="w-4 h-4" />
                                  创建新物料: {line.requirementText}
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-yellow-50">
                              <Plus className="w-3 h-3 mr-1" />
                              将创建新物料
                            </Badge>
                            <Input
                              placeholder="物料单位"
                              value={line.confirmedMaterialUnit || '个'}
                              onChange={(e) =>
                                setLines(
                                  lines.map((l) =>
                                    l.id === line.id
                                      ? { ...l, confirmedMaterialUnit: e.target.value }
                                      : l
                                  )
                                )
                              }
                              className="w-24"
                            />
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          {line.checked.action === 'use_existing' && (
                            <Check className="w-3 h-3 text-green-500" />
                          )}
                          {line.checked.action === 'confirm' && (
                            <AlertCircle className="w-3 h-3 text-yellow-500" />
                          )}
                          {line.checked.action === 'create_new' && (
                            <Plus className="w-3 h-3 text-blue-500" />
                          )}
                          {line.checked.message}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          点击"下一步"自动匹配
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                      placeholder="0"
                      disabled={step === 'confirm'}
                      className="w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={line.estUnitPrice}
                      onChange={(e) => updateLine(line.id, 'estUnitPrice', e.target.value)}
                      placeholder="0.00"
                      disabled={step === 'confirm'}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={line.expectedDeliveryDate}
                      onChange={(e) =>
                        updateLine(line.id, 'expectedDeliveryDate', e.target.value)
                      }
                      disabled={step === 'confirm'}
                    />
                  </TableCell>
                  <TableCell>
                    {line.checked ? (
                      <Badge
                        variant={
                          line.checked.action === 'use_existing'
                            ? 'default'
                            : line.checked.action === 'confirm'
                            ? 'secondary'
                            : line.checked.action === 'create_new'
                            ? 'outline'
                            : 'destructive'
                        }
                      >
                        {line.checked.action === 'use_existing'
                          ? '已匹配'
                          : line.checked.action === 'confirm'
                          ? '待确认'
                          : line.checked.action === 'create_new'
                          ? '待创建'
                          : '无效'}
                      </Badge>
                    ) : (
                      <Badge variant="outline">待检查</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {lines.length > 1 && step === 'input' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(line.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-4">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          取消
        </Button>
        {step === 'input' ? (
          <Button onClick={checkMaterials} disabled={checking || lines.length === 0}>
            {checking ? '检查中...' : '下一步：确认物料'}
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setStep('input')}>
              上一步
            </Button>
            <Button onClick={() => createPR()} disabled={loading}>
              {loading ? '创建中...' : '创建采购申请'}
            </Button>
          </>
        )}
      </div>

      {/* 提示信息 */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">物料自动创建说明</p>
              <ul className="list-disc list-inside space-y-1 text-blue-600">
                <li>系统会自动检查您输入的需求描述是否已存在于物料主数据中</li>
                <li>如果找到精确匹配的物料，将自动关联</li>
                <li>如果找到相似物料，您可以手动选择使用现有物料或创建新物料</li>
                <li>如果未找到匹配物料，系统将在物料主数据中自动创建新物料</li>
                <li>创建的物料可以在「物料管理」页面查看和管理</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
