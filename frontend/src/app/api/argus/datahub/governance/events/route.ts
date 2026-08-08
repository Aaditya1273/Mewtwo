import { NextResponse } from 'next/server'
import { backendApi } from '@/lib/config'

const BACKEND_URL = backendApi('/api/v1/argus/datahub/governance/events')

export async function GET() {
  try {
    const res = await fetch(BACKEND_URL, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ events: [], count: 0 }, { status: 200 })
    const data = await res.json()
    return NextResponse.json({ events: Array.isArray(data?.events) ? data.events : [], count: data?.count ?? 0 })
  } catch {
    return NextResponse.json({ events: [], count: 0 })
  }
}
