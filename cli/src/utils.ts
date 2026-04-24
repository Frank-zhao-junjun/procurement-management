import chalk from 'chalk';
import Table from 'cli-table3';

export function printSuccess(message: string): void {
  console.log(chalk.green('✔'), message);
}

export function printError(message: string): void {
  console.error(chalk.red('✖'), message);
}

export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function printJSON(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(headers: string[], rows: (string | number | undefined)[][]): void {
  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: { border: [] },
    wordWrap: true,
  });
  table.push(...rows.map((row) => row.map((cell) => cell ?? '-')));
  console.log(table.toString());
}

export function truncate(str: string | undefined | null, maxLen = 40): string {
  if (!str) return '-';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('zh-CN');
}

export function formatCurrency(value: number | undefined | null): string {
  if (value == null) return '-';
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatStatus(status: string | undefined | null): string {
  if (!status) return chalk.gray('-');
  const colors: Record<string, (s: string) => string> = {
    draft: chalk.gray,
    pending: chalk.yellow,
    approved: chalk.green,
    rejected: chalk.red,
    completed: chalk.green,
    cancelled: chalk.gray,
    sent: chalk.blue,
    in_progress: chalk.cyan,
    overdelivery_pending: chalk.magenta,
    winner: chalk.green,
    out: chalk.red,
  };
  return (colors[status] || chalk.white)(status);
}

export function requireAuth(): void {
  // 实际检查在 client.ts 拦截器中处理
}
