import { NextResponse } from 'next/server'
import { backendApi } from '@/lib/config'

const BACKEND_URL = backendApi('/api/v1/argus/datahub/status')

export async function GET() {
  try {
    const res = await fetch(BACKEND_URL, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ configured: false, status: 'error' }, { status: res.status })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ configured: false, status: 'unreachable' }, { status: 200 })
  }
}
