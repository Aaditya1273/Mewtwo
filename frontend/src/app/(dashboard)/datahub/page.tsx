'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Database, Search, GitBranch, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, Boxes, Tags, Users, ExternalLink, Layers } from 'lucide-react'

interface DHStatus {
  configured: boolean
  status: string
  endpoint?: string
  mutation_enabled?: boolean
  plugins?: string[]
  message?: string
}

interface Asset {
  urn: string
  name: string
  type: string
  description?: string
  tags?: string[]
  glossary_terms?: string[]
  owners?: string[]
  deprecated?: boolean
  quality_score?: number
  platform?: string
}

interface LineageNode {
  urn: string
  type: string
  name: string
  tags: string[]
  platform: string
}

interface LineageGraph {
  root_urn: string
  direction: string
  upstream: LineageNode[]
  downstream: LineageNode[]
}

interface GovEvent {
  timestamp: string
  agent_id: string
  session_id: string
  tool_call: string
  dataset_urn: string
  decision: string // ALLOW | WARN | BLOCK
  reason: string
  plugin: string
  severity: string
  action: string
}

const shortURN = (u: string) => {
  if (!u) return '—'
  const parts = u.split(':')
  const tail = parts[parts.length - 1]
  return decodeURIComponent(tail).replace(/[\\(\\)\\[\\]]/g, '').split(',').slice(0, 2).join('/')
}

const typeIcon = (t: string) => {
  const lower = (t || '').toLowerCase()
  if (lower.includes('model')) return <Boxes className="w-4 h-4" />
  if (lower.includes('metric') || lower.includes('dashboard')) return <Layers className="w-4 h-4" />
  return <Database className="w-4 h-4" />
}

const decisionBadge = (d: string) => {
  switch (d) {
    case 'BLOCK': return <span className="pill pill-red"><XCircle className="w-3 h-3" /> BLOCKED</span>
    case 'WARN':  return <span className="pill pill-orange"><AlertTriangle className="w-3 h-3" /> WARN</span>
    default:      return <span className="pill pill-green"><CheckCircle2 className="w-3 h-3" /> ALLOW</span>
  }
}

export default function DataHubPage() {
  const [status, setStatus] = useState<DHStatus | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Asset[]>([])
  const [selected, setSelected] = useState<Asset | null>(null)
  const [lineage, setLineage] = useState<LineageGraph | null>(null)
  const [events, setEvents] = useState<GovEvent[]>([])
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadEvents = useCallback(async () => {
    try {
      const r = await fetch('/api/argus/datahub/governance/events')
      if (r.ok) { const d = await r.json(); setEvents(d.events || []) }
    } catch { /* keep last */ }
  }, [])

  const loadAsset = useCallback(async (urn: string) => {
    setSelected(null); setLineage(null)
    const [assetRes, lineageRes] = await Promise.all([
      fetch(`/api/argus/datahub/asset?urn=${encodeURIComponent(urn)}`),
      fetch(`/api/argus/datahub/lineage?urn=${encodeURIComponent(urn)}&direction=BOTH`),
    ])
    const [asset, graph] = await Promise.all([assetRes.json(), lineageRes.json()])
    if (asset && asset.urn) setSelected(asset)
    if (graph && (graph.upstream || graph.downstream)) setLineage(graph)
  }, [])

  useEffect(() => {
    const load = async () => {
      try { const r = await fetch('/api/argus/datahub/status'); if (r.ok) setStatus(await r.json()) } catch { setStatus({ configured: false, status: 'unreachable' }) }
    }
    load()
    loadEvents()
    const t = setInterval(loadEvents, 15000)
    return () => { clearInterval(t); if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [loadEvents])

  const onSearch = (value: string) => {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!value.trim()) { setResults([]); setError(''); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true); setError('')
      try {
        const r = await fetch(`/api/argus/datahub/search?q=${encodeURIComponent(value.trim())}`)
        const d = await r.json()
        if (d.error) setError(d.error)
        setResults(Array.isArray(d.results) ? d.results : [])
      } catch { setError('Search failed') } finally { setSearching(false) }
    }, 400)
  }

  const decisionCounts = {
    block: events.filter(e => e.decision === 'BLOCK').length,
    warn: events.filter(e => e.decision === 'WARN').length,
    allow: events.filter(e => e.decision === 'ALLOW').length,
  }

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fadeIn">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">DataHub Context</h1>
          <p className="text-sm text-gray-500 mt-1">Metadata-aware governance — every MCP tool call is checked against DataHub lineage, ownership &amp; tags before execution.</p>
        </div>
        {status && (
          status.configured
            ? <span className="pill pill-green"><span className="pill-dot" /> Connected</span>
            : <span className="pill pill-gray"><span className="pill-dot" /> Not configured</span>
        )}
      </div>

      {/* Status strip */}
      <div className="grid grid-cols-12 gap-5 mb-6">
        <div className="col-span-12 lg:col-span-7 card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-orange-600" /> Integration Status</h2>
            {status?.configured && <span className="text-xs text-gray-400 mono">{status.endpoint}</span>}
          </div>
          {status?.configured ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">Mutation write-back</p>
                  <p className={`text-lg font-bold mt-0.5 ${status.mutation_enabled ? 'text-green-600' : 'text-gray-400'}`}>{status.mutation_enabled ? 'Enabled' : 'Read-only'}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">Governance plugins</p>
                  <p className="text-lg font-bold mt-0.5 text-gray-900">{status.plugins?.length ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">Mode</p>
                  <p className="text-lg font-bold mt-0.5 text-gray-900">Fail-closed</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(status.plugins || []).map(p => <span key={p} className="pill pill-orange text-[11px]">{p}</span>)}
              </div>
            </>
          ) : (
            <div className="p-6 text-center">
              <ShieldAlert className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">{status?.message || 'DataHub MCP server not configured.'}</p>
              <p className="text-xs text-gray-400 mt-1 mono mt-2">DATAHUB_MCP_URL=https://&lt;tenant&gt;.acryl.io/integrations/ai/mcp · DATAHUB_TOKEN=...</p>
            </div>
          )}
        </div>

        {/* Decision counts */}
        <div className="col-span-12 lg:col-span-5 card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Governance Decisions</h2>
          <div className="space-y-3">
            {[
              { label: 'Blocked', n: decisionCounts.block, cls: 'text-red-600', bar: 'bg-red-500' },
              { label: 'Warned',  n: decisionCounts.warn,  cls: 'text-orange-600', bar: 'bg-orange-500' },
              { label: 'Allowed', n: decisionCounts.allow, cls: 'text-green-600', bar: 'bg-green-500' },
            ].map(row => {
              const total = Math.max(events.length, 1)
              const pct = (row.n / total) * 100
              return (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500 font-medium">{row.label}</span>
                    <span className={`font-bold ${row.cls}`}>{row.n}</span>
                  </div>
                  <div className="progress-track">
                    <div className={`h-full rounded-full ${row.bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* Search + results */}
        <div className="col-span-12 lg:col-span-5 space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Search className="w-4 h-4 text-orange-600" /> Search DataHub Catalog</h2>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={e => onSearch(e.target.value)}
                placeholder="e.g. customer, orders, churn_model…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 transition-all"
              />
            </div>
            {searching && <div className="flex items-center gap-2 mt-3 text-xs text-gray-400"><div className="w-3 h-3 rounded-full border-2 border-orange-600 border-t-transparent animate-spin" /> Searching DataHub…</div>}
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Assets ({results.length})</h2>
            </div>
            {results.length === 0 ? (
              <div className="p-8 text-center">
                <Database className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Search the catalog to inspect assets.</p>
                <p className="text-xs text-gray-300 mt-1">Results come live from the DataHub MCP Server.</p>
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                {results.map(a => (
                  <button
                    key={a.urn}
                    onClick={() => loadAsset(a.urn)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selected?.urn === a.urn ? 'bg-orange-50 border-l-2 border-l-orange-500' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-orange-600 flex-shrink-0">{typeIcon(a.type)}</span>
                        <span className="text-sm font-medium text-gray-800 truncate">{a.name || shortURN(a.urn)}</span>
                      </div>
                      {a.deprecated && <span className="pill pill-gray text-[10px]">deprecated</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-1">
                      <span className="mono truncate">{shortURN(a.urn)}</span>
                      <span className="text-gray-300">·</span>
                      <span className="uppercase tracking-wide">{a.type || 'asset'}</span>
                    </div>
                    {(a.tags?.length || 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {a.tags!.slice(0, 4).map(t => (
                          <span key={t} className={`pill text-[10px] ${/pii|sensitive|hipaa|gdpr|phi/i.test(t) ? 'pill-red' : 'pill-gray'}`}>{t}</span>
                        ))}
                        {a.tags!.length > 4 && <span className="pill pill-gray text-[10px]">+{a.tags!.length - 4}</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Governance events */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Governance Event Log</h2>
              <span className="text-xs text-gray-400">{events.length} events</span>
            </div>
            {events.length === 0 ? (
              <div className="p-6 text-center">
                <ShieldAlert className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-400">No metadata-aware decisions yet.</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Violations are written back to DataHub and logged here in real time.</p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {events.map((e, i) => (
                  <div key={i} className="px-4 py-2.5 border-b border-gray-50 flex items-start gap-3">
                    {decisionBadge(e.decision)}
                    <div className="min-w-0">
                      <p className="text-xs text-gray-700 truncate">{e.reason}</p>
                      <p className="text-[10px] text-gray-400 mono mt-0.5 truncate">
                        {e.plugin} · {e.tool_call} · {shortURN(e.dataset_urn)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Asset detail + lineage */}
        <div className="col-span-12 lg:col-span-7 space-y-5">
          {!selected ? (
            <div className="card p-12 text-center">
              <GitBranch className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Select an asset to inspect its metadata &amp; lineage.</p>
              <p className="text-xs text-gray-400 mt-1">ARGUS evaluates ownership, lineage-PII, policies, quality &amp; deprecation before every tool call.</p>
            </div>
          ) : (
            <>
              {/* Asset header */}
              <div className="card p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 flex-shrink-0">
                      {typeIcon(selected.type)}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                        {selected.name || shortURN(selected.urn)}
                        {selected.deprecated && <span className="pill pill-gray text-[10px]">deprecated</span>}
                      </h3>
                      <p className="text-xs text-gray-400 mono mt-0.5">{selected.urn}</p>
                    </div>
                  </div>
                  <span className="pill pill-gray uppercase tracking-wide text-[10px]">{selected.type || 'asset'}</span>
                </div>

                {selected.description && <p className="text-sm text-gray-600 mb-4">{selected.description}</p>}

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[11px] text-gray-400 font-medium mb-1 flex items-center gap-1"><Tags className="w-3 h-3" /> Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {(selected.tags?.length || 0) === 0
                        ? <span className="text-xs text-gray-400">—</span>
                        : selected.tags!.map(t => (
                            <span key={t} className={`pill text-[10px] ${/pii|sensitive|hipaa|gdpr|phi/i.test(t) ? 'pill-red' : 'pill-gray'}`}>{t}</span>
                          ))}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[11px] text-gray-400 font-medium mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Owners</p>
                    <div className="flex flex-wrap gap-1">
                      {(selected.owners?.length || 0) === 0
                        ? <span className="text-xs text-gray-400">—</span>
                        : selected.owners!.map(o => <span key={o} className="pill pill-gray text-[10px]">{shortURN(o)}</span>)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[11px] text-gray-400 font-medium">Quality score</p>
                    <p className={`text-lg font-bold mt-0.5 ${selected.quality_score != null && selected.quality_score < 0.6 ? 'text-red-600' : 'text-gray-900'}`}>
                      {selected.quality_score != null ? `${(selected.quality_score * 100).toFixed(0)}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[11px] text-gray-400 font-medium">Platform</p>
                    <p className="text-lg font-bold mt-0.5 text-gray-900 capitalize">{selected.platform || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[11px] text-gray-400 font-medium">Glossary terms</p>
                    <p className="text-lg font-bold mt-0.5 text-gray-900">{selected.glossary_terms?.length ?? 0}</p>
                  </div>
                </div>
              </div>

              {/* Lineage */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><GitBranch className="w-4 h-4 text-orange-600" /> Lineage</h3>
                {!lineage || ((lineage.upstream?.length || 0) === 0 && (lineage.downstream?.length || 0) === 0) ? (
                  <p className="text-sm text-gray-400 text-center py-6">No lineage found for this asset.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {(['upstream', 'downstream'] as const).map(dir => {
                      const nodes = lineage[dir]
                      return (
                        <div key={dir}>
                          <p className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${dir === 'upstream' ? 'text-orange-600' : 'text-green-600'}`}>
                            {dir === 'upstream' ? '↑ Upstream (sources)' : '↓ Downstream (consumers)'}
                          </p>
                          <div className="space-y-1.5">
                            {(nodes || []).map(n => (
                              <div key={n.urn} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                                <span className="text-orange-600 flex-shrink-0">{typeIcon(n.type)}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-gray-700 truncate">{n.name || shortURN(n.urn)}</p>
                                  <p className="text-[10px] text-gray-400 mono truncate">{shortURN(n.urn)}</p>
                                </div>
                                {(n.tags || []).filter(t => /pii|sensitive|hipaa|gdpr|phi/i.test(t)).length > 0 && (
                                  <span className="pill pill-red text-[9px] flex-shrink-0">PII</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="card p-5 flex items-start gap-3">
                <ExternalLink className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-gray-500">
                  ARGUS evaluates this asset's metadata against <span className="font-medium">ownership</span>, <span className="font-medium">lineage-PII</span>, <span className="font-medium">GDPR/HIPAA policies</span>, <span className="font-medium">data quality</span> and <span className="font-medium">deprecation</span> on every governed tool call — blocking access before the agent sees sensitive data.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
