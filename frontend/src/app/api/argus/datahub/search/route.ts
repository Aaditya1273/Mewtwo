import { NextResponse } from 'next/server'
import { backendApi } from '@/lib/config'

const BACKEND_URL = backendApi('/api/v1/argus/datahub/search')

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  try {
    const res = await fetch(`${BACKEND_URL}?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ results: [], count: 0, error: `Backend returned ${res.status}` }, { status: 200 })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ results: [], count: 0, error: 'DataHub backend unreachable' }, { status: 200 })
  }
}
