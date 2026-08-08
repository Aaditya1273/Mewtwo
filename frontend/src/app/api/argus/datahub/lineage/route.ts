import { NextResponse } from 'next/server'
import { backendApi } from '@/lib/config'

const BACKEND_URL = backendApi('/api/v1/argus/datahub/lineage')

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const urn = searchParams.get('urn') || ''
  const direction = searchParams.get('direction') || 'BOTH'
  try {
    const res = await fetch(`${BACKEND_URL}?urn=${encodeURIComponent(urn)}&direction=${encodeURIComponent(direction)}`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ upstream: [], downstream: [], error: `Backend returned ${res.status}` }, { status: 200 })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ upstream: [], downstream: [], error: 'DataHub backend unreachable' }, { status: 200 })
  }
}
