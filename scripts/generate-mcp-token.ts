/**
 * 生成 MCP Bearer Token（与 src/mcp/auth.ts 算法一致）
 * 用法: MCP_API_KEY_SECRET=xxx pnpm exec tsx scripts/generate-mcp-token.ts <agent_id> [ttl_seconds]
 */
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';

config({ path: '.env.local' });

const agentId = process.argv[2];
const ttlSec = parseInt(process.argv[3] || '86400', 10);
const secret = process.env.MCP_API_KEY_SECRET;

if (!secret || !agentId) {
  console.error('Usage: MCP_API_KEY_SECRET=<secret> pnpm exec tsx scripts/generate-mcp-token.ts <agent_id> [ttl_seconds]');
  process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + ttlSec;
const payloadB64 = Buffer.from(JSON.stringify({ a: agentId, exp })).toString('base64url');
const sig = createHmac('sha256', secret).update(`v1.${payloadB64}`).digest('hex');
const token = `v1.${payloadB64}.${sig}`;
console.log(token);
console.error(`(expires in ${ttlSec}s, agent_id=${agentId})`);
