import { NextResponse } from 'next/server';
import { AGENT_ACTION_MANIFEST } from '@/lib/agent-actions';

// GET /api/agent-actions/manifest
export async function GET() {
  return NextResponse.json({
    success: true,
    actions: AGENT_ACTION_MANIFEST,
  });
}
