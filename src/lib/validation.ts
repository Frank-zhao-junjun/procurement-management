/**
 * 必输字段验证工具
 * 
 * 在 API 层统一验证必输字段，防止空值入库
 * 支持：
 * - 字符串必输
 * - 数组必输（非空）
 */

import { z } from 'zod';

// ============ 验证错误类型 ============

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface ValidationResult {
  success: boolean;
  errors: ValidationError[];
}

/**
 * 必输字符串（不能为空）
 */
export function requiredString(fieldName: string) {
  return z.string().min(1, `${fieldName} 不能为空`);
}

/**
 * 必输数组（非空）
 */
export function requiredArray(fieldName: string) {
  return z.array(z.any()).min(1, `${fieldName} 不能为空`);
}

/**
 * 可选字符串
 */
export function optionalString() {
  return z.string().optional();
}

/**
 * 验证对象
 */
export function validateObject<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  data: unknown
): ValidationResult {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, errors: [] };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    value: issue.code === 'invalid_type' ? data : undefined,
  }));

  return { success: false, errors };
}

// ============ 常用业务验证 Schema ============

// 物料验证
export const materialSchema = z.object({
  code: optionalString().optional(),
  name: requiredString('物料名称'),
  unit: optionalString().optional(),
});

// 供应商验证
export const supplierSchema = z.object({
  code: optionalString().optional(),
  name: requiredString('供应商名称'),
  contact: optionalString().optional(),
  email: optionalString().optional(),
  phone: optionalString().optional(),
  address: optionalString().optional(),
  note: optionalString().optional(),
});

// ============ 辅助函数 ============

/**
 * 创建验证失败的响应
 */
export function createValidationErrorResponse(result: ValidationResult) {
  return {
    error: '请求参数验证失败',
    details: result.errors.map((e) => `${e.field}: ${e.message}`),
    fields: result.errors,
  };
}

/**
 * 清理字符串字段（去除首尾空格）
 */
export function trimStrings<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value.trim();
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'object' && item !== null ? trimStrings(item as Record<string, unknown>) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = trimStrings(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  
  return result as T;
}

/**
 * 检查必输字段是否为空
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}
