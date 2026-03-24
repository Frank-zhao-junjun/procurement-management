/**
 * 统一日期时间处理工具
 * 所有日期时间均使用北京时间 (UTC+8)
 * 格式约定：
 *   - 日期格式: YYYY-MM-DD (如: 2026-03-24)
 *   - 时间格式: HH:mm:ss (如: 14:30:00)
 *   - 日期时间格式: ISO 8601 (如: 2026-03-24T14:30:00+08:00)
 */

// 北京时区偏移量
const BEIJING_OFFSET = 8 * 60 * 60 * 1000; // 8小时转毫秒

/**
 * 获取当前北京时间
 */
export function getBeijingNow(): Date {
  const now = new Date();
  // 转换为北京时间
  return new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + BEIJING_OFFSET);
}

/**
 * 获取北京日期字符串 (YYYY-MM-DD)
 * @param date 可选，指定日期，默认为今天
 */
export function getBeijingDateString(date?: Date | string): string {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : getBeijingNow();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取北京时间字符串 (HH:mm:ss)
 * @param date 可选，指定时间，默认为当前时间
 */
export function getBeijingTimeString(date?: Date): string {
  const d = date || getBeijingNow();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * 获取完整的北京时间 ISO 字符串
 */
export function getBeijingISOString(date?: Date): string {
  const d = date || getBeijingNow();
  return d.toISOString();
}

/**
 * 解析日期字符串，转换为北京时间
 * 支持格式: YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss, ISO 8601
 */
export function parseBeijingDate(dateStr: string | undefined | null): string {
  if (!dateStr) {
    return getBeijingDateString();
  }
  
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      return getBeijingDateString();
    }
    return getBeijingDateString(d);
  } catch {
    return getBeijingDateString();
  }
}

/**
 * 解析时间字符串
 * 支持格式: HH:mm:ss, HH:mm
 */
export function parseBeijingTime(timeStr: string | undefined | null): string {
  if (!timeStr) {
    return getBeijingTimeString();
  }
  
  try {
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const hours = String(parseInt(parts[0], 10)).padStart(2, '0');
      const minutes = String(parseInt(parts[1], 10)).padStart(2, '0');
      const seconds = parts[2] ? String(parseInt(parts[2], 10)).padStart(2, '0') : '00';
      return `${hours}:${minutes}:${seconds}`;
    }
  } catch {
    // ignore
  }
  
  return getBeijingTimeString();
}

/**
 * 验证日期格式 (YYYY-MM-DD)
 */
export function isValidDateFormat(dateStr: string): boolean {
  if (!dateStr) return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

/**
 * 验证时间格式 (HH:mm:ss 或 HH:mm)
 */
export function isValidTimeFormat(timeStr: string): boolean {
  if (!timeStr) return false;
  const regex = /^(\d{1,2}:\d{2}(:\d{2})?)$/;
  return regex.test(timeStr);
}
