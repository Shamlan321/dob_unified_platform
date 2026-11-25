'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ContentItem, Department } from '@/lib/schema'

type Tab = 'overview' | 'scraper' | 'webhooks' | 'content' | 'ai'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Notification / Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Overview Data ────────────────────────────────────────────────────────
  const [totalNotices, setTotalNotices] = useState<number>(0)
  const [totalAnnouncements, setTotalAnnouncements] = useState<number>(0)

  // ── Scraper Data ─────────────────────────────────────────────────────────
  const [scraperEnabled, setScraperEnabled] = useState<boolean>(true)
  const [scraperInterval, setScraperInterval] = useState<number>(24)
  const [scraperRunning, setScraperRunning] = useState<boolean>(false)
  const [scraperLog, setScraperLog] = useState<string>('')
  const [lastScraperRun, setLastScraperRun] = useState<string>('')
  const [lastScraperStatus, setLastScraperStatus] = useState<string>('idle')

  // ── Departments / Webhooks Data ──────────────────────────────────────────
  const [departments, setDepartments] = useState<Department[]>([])
  const [newDeptName, setNewDeptName] = useState<string>('')
  const [newDeptSlug, setNewDeptSlug] = useState<string>('')
  const [creatingDept, setCreatingDept] = useState<boolean>(false)

  // ── Content Manager Data ─────────────────────────────────────────────────
  const [contentItems, setContentItems] = useState<ContentItem[]>([])
  const [contentTotal, setContentTotal] = useState<number>(0)
  const [contentPage, setContentPage] = useState<number>(1)
  const [contentTotalPages, setContentTotalPages] = useState<number>(1)
  const [contentSource, setContentSource] = useState<string>('')
  const [contentSearch, setContentSearch] = useState<string>('')
  const [contentLoading, setContentLoading] = useState<boolean>(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── AI Knowledge Base Data ───────────────────────────────────────────────
  const [aiDocCount, setAiDocCount] = useState<number>(0)
  const [aiStorageReady, setAiStorageReady] = useState<boolean>(false)
  const [aiBuilding, setAiBuilding] = useState<boolean>(false)
  const [aiBuildLog, setAiBuildLog] = useState<string>('')

  // ── Fetch Functions ──────────────────────────────────────────────────────
  const fetchScraperStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/scraper')
      if (!res.ok) return
      const data = await res.json()
      if (data.settings) {
        setScraperEnabled(data.settings.scraper_enabled === 'true')
        setScraperInterval(Number(data.settings.scraper_interval_hours) || 24)
        setLastScraperRun(data.settings.scraper_last_run || '')
        setLastScraperStatus(data.settings.scraper_last_status || 'idle')
      }
      setScraperRunning(Boolean(data.isRunning))
      if (data.currentLog) setScraperLog(data.currentLog)
    } catch {}
  }, [])

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/departments')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.departments)) {
        setDepartments(data.departments)
        const totalAnn = data.departments.reduce((acc: number, d: Department) => acc + (d.count || 0), 0)
        setTotalAnnouncements(totalAnn)
      }
    } catch {}
  }, [])

  const fetchContent = useCallback(async (page = 1, source = contentSource, q = contentSearch) => {
    setContentLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '15')
      if (source) params.set('source', source)
      if (q) params.set('q', q)

      const res = await fetch(`/api/admin/content?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      setContentItems(data.items || [])
      setContentTotal(data.total || 0)
      setContentPage(data.page || 1)
      setContentTotalPages(data.totalPages || 1)

      if (!source && !q) {
        // Find total notices count if unfiltered
        const noticesRes = await fetch('/api/admin/content?source=bic_notices&limit=1')
        if (noticesRes.ok) {
          const nData = await noticesRes.json()
          setTotalNotices(nData.total || 0)
        }
      }
    } catch {} finally {
      setContentLoading(false)
    }
  }, [contentSource, contentSearch])

  const fetchAiStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai')
      if (!res.ok) return
      const data = await res.json()
      setAiDocCount(data.docCount || 0)
      setAiStorageReady(Boolean(data.docstoreExists))
      setAiBuilding(Boolean(data.isBuilding))
      if (data.buildLog) setAiBuildLog(data.buildLog)
    } catch {}
  }, [])

  // Initial load
  useEffect(() => {
    queueMicrotask(() => {
      fetchScraperStatus()
      fetchDepartments()
      fetchContent(1)
      fetchAiStatus()
    })
  }, [fetchScraperStatus, fetchDepartments, fetchContent, fetchAiStatus])

  // Poll scraper if running
  useEffect(() => {
    if (!scraperRunning) return
    const interval = setInterval(fetchScraperStatus, 2000)
    return () => clearInterval(interval)
  }, [scraperRunning, fetchScraperStatus])

  // Poll AI if building
  useEffect(() => {
    if (!aiBuilding) return
    const interval = setInterval(fetchAiStatus, 3000)
    return () => clearInterval(interval)
  }, [aiBuilding, fetchAiStatus])

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleSaveScraperSettings() {
    try {
      const res = await fetch('/api/admin/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_settings',
          enabled: scraperEnabled,
          intervalHours: scraperInterval,
        }),
      })
      if (!res.ok) throw new Error('Failed to save settings')
      showToast('Scraper schedule settings saved!')
      fetchScraperStatus()
    } catch (e) {
      showToast((e as Error).message, 'error')
    }
  }

  async function handleRunScraperNow(upsert = false) {
    try {
      const res = await fetch('/api/admin/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', upsert }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to start scraper')
      }
      setScraperRunning(true)
      showToast('Scraper pipeline started in background!')
      fetchScraperStatus()
    } catch (e) {
      showToast((e as Error).message, 'error')
    }
  }

  async function handleCreateDepartment(e: React.FormEvent) {
    e.preventDefault()
    if (!newDeptName.trim()) return
    setCreatingDept(true)
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDeptName.trim(), slug: newDeptSlug.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create department')
      showToast(`Department "${data.department.name}" created!`)
      setNewDeptName('')
      setNewDeptSlug('')
      fetchDepartments()
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setCreatingDept(false)
    }
  }

  async function handleDeleteDepartment(slug: string, name: string) {
    if (!confirm(`Are you sure you want to delete department "${name}" (${slug})?`)) return
    try {
      const res = await fetch(`/api/admin/departments/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete department')
      showToast(`Department "${name}" deleted.`)
      fetchDepartments()
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  async function handleDeleteContent(id: string, title: string) {
    if (!confirm(`Permanently delete this item?\n"${title.slice(0, 60)}..."`)) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/content?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete item')
      showToast('Item deleted successfully')
      fetchContent(contentPage)
      fetchDepartments()
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRebuildAiIndex() {
    if (!confirm('Rebuild BIC AI vector index now? This will synchronize all notices and announcements into LlamaIndex.')) return
    try {
      const res = await fetch('/api/admin/ai', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to start AI build')
      }
      setAiBuilding(true)
      showToast('AI vector index build started in background!')
      fetchAiStatus()
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    showToast('Copied to clipboard!')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 9999,
            background: toast.type === 'success' ? 'var(--yellow)' : '#FF4D4D',
            color: 'var(--ink)',
            border: '2.5px solid var(--ink)',
            boxShadow: 'var(--shadow)',
            padding: '12px 20px',
            fontWeight: 700,
            fontSize: '13.5px',
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header
        style={{
          borderBottom: 'var(--border)',
          background: 'var(--card)',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link
            href="/"
            style={{
              textDecoration: 'none',
              background: 'var(--ink)',
              color: 'var(--yellow)',
              padding: '6px 12px',
              fontWeight: 700,
              fontSize: '13px',
              border: '1.5px solid var(--ink)',
            }}
          >
            ← Back to BIC Pulse
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                background: 'var(--yellow)',
                border: '1.5px solid var(--ink)',
                padding: '2px 8px',
                fontWeight: 700,
                fontSize: '11px',
              }}
            >
              ADMIN
            </span>
            <h1 style={{ fontSize: '20px', margin: 0 }}>BIC Pulse Centralized Dashboard</h1>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav
        style={{
          display: 'flex',
          borderBottom: 'var(--border)',
          background: 'var(--card)',
          overflowX: 'auto',
          padding: '0 24px',
        }}
      >
        {[
          { key: 'overview', label: '📊 System Overview' },
          { key: 'scraper', label: '🕷️ Notice Scraper' },
          { key: 'webhooks', label: '💬 Kakao Webhooks' },
          { key: 'content', label: '🗂️ Content Manager' },
          { key: 'ai', label: '🤖 BIC AI Index' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as Tab)}
            style={{
              background: activeTab === t.key ? 'var(--yellow)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === t.key ? '3px solid var(--ink)' : '3px solid transparent',
              padding: '14px 18px',
              fontWeight: 700,
              fontSize: '13.5px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Main Container */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 80px' }}>
        {/* ===================== TAB: OVERVIEW ===================== */}
        {activeTab === 'overview' && (
          <div>
            <h2 style={{ fontSize: 22, marginBottom: 16 }}>Platform Overview</h2>
            <div className="stat-row">
              <div className="stat">
                <div className="num">{totalNotices}</div>
                <div className="lbl">UNIVERSITY NOTICES</div>
              </div>
              <div className="stat">
                <div className="num">{totalAnnouncements}</div>
                <div className="lbl">KAKAO ANNOUNCEMENTS</div>
              </div>
              <div className="stat">
                <div className="num">{departments.length}</div>
                <div className="lbl">DEPARTMENT CHANNELS</div>
              </div>
              <div className="stat">
                <div className="num" style={{ color: scraperRunning ? 'var(--blue)' : 'inherit' }}>
                  {scraperRunning ? 'RUNNING' : lastScraperStatus.toUpperCase()}
                </div>
                <div className="lbl">SCRAPER STATUS</div>
              </div>
              <div className="stat">
                <div className="num">{aiDocCount}</div>
                <div className="lbl">AI VECTOR DOCS</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginTop: 24 }}>
              {/* Card 1: Scraper Quick Controller */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>🕷️ Notice Scraper</h3>
                  <span className="tag tag-notice">{scraperEnabled ? 'AUTOMATED' : 'DISABLED'}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                  Scrapes 9 pages of official announcements from <code>tu.ac.kr</code> and syncs new notices.
                </p>
                <div style={{ fontSize: 12, marginBottom: 12 }}>
                  <strong>Interval:</strong> Every {scraperInterval} hour(s) |{' '}
                  <strong>Last run:</strong> {lastScraperRun ? new Date(lastScraperRun).toLocaleString() : 'Never'}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    disabled={scraperRunning}
                    onClick={() => handleRunScraperNow(false)}
                  >
                    {scraperRunning ? '⏳ Scraping in progress...' : '⚡ Run Scraper Now'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setActiveTab('scraper')}>
                    Configure →
                  </button>
                </div>
              </div>

              {/* Card 2: Kakao Relays */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>💬 KakaoTalk Relay Channels</h3>
                  <span className="tag tag-announce">{departments.length} Depts</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                  Webhooks configured to receive decrypted messages from the KakaoDump2 Android app.
                </p>
                <div style={{ fontSize: 12, marginBottom: 12 }}>
                  <strong>Total Messages Ingested:</strong> {totalAnnouncements}
                </div>
                <button className="btn btn-primary" onClick={() => setActiveTab('webhooks')}>
                  Manage Webhook Slugs →
                </button>
              </div>

              {/* Card 3: BIC AI Status */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>🤖 BIC AI Vector Knowledge Base</h3>
                  <span className="tag" style={{ background: aiStorageReady ? 'var(--yellow)' : 'var(--locked)' }}>
                    {aiStorageReady ? 'INDEX READY' : 'NEEDS BUILD'}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                  Subprocess bridge to LlamaIndex + Gemini. Merges handbook, notices, and department chats.
                </p>
                <div style={{ fontSize: 12, marginBottom: 12 }}>
                  <strong>Indexed Documents:</strong> {aiDocCount} nodes
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    disabled={aiBuilding}
                    onClick={handleRebuildAiIndex}
                  >
                    {aiBuilding ? '⏳ Indexing...' : '🔄 Sync / Rebuild Index'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setActiveTab('ai')}>
                    Logs →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================== TAB: SCRAPER ===================== */}
        {activeTab === 'scraper' && (
          <div>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>Notice Scraper Scheduler & Settings</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 }}>
              Configure automatic background notice scraping or trigger immediate sync runs.
            </p>

            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, marginBottom: 14 }}>Automation Configuration</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
                <div>
                  <label>Automatic Scraping</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <input
                      type="checkbox"
                      id="scraper-toggle"
                      checked={scraperEnabled}
                      onChange={e => setScraperEnabled(e.target.checked)}
                      style={{ width: 22, height: 22, accentColor: 'var(--ink)', cursor: 'pointer' }}
                    />
                    <label htmlFor="scraper-toggle" style={{ margin: 0, cursor: 'pointer' }}>
                      {scraperEnabled ? 'Enabled (runs periodically)' : 'Disabled (manual only)'}
                    </label>
                  </div>
                </div>

                <div>
                  <label>Interval (Hours between runs)</label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={scraperInterval}
                    onChange={e => setScraperInterval(Math.max(1, parseInt(e.target.value, 10) || 24))}
                    style={{ maxWidth: 160 }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4, display: 'block' }}>
                    Standard: 24 hours (once per day)
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" onClick={handleSaveScraperSettings}>
                  💾 Save Schedule Settings
                </button>
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 style={{ fontSize: 16, margin: 0 }}>Execution & Output Console</h3>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                    Status:{' '}
                    <strong style={{ color: scraperRunning ? 'var(--blue)' : 'inherit' }}>
                      {scraperRunning ? '⏳ RUNNING PIPELINE' : lastScraperStatus.toUpperCase()}
                    </strong>
                    {lastScraperRun && ` • Last started: ${new Date(lastScraperRun).toLocaleString()}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    disabled={scraperRunning}
                    onClick={() => handleRunScraperNow(false)}
                  >
                    {scraperRunning ? '⏳ Running...' : '⚡ Run Scraper Now'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={scraperRunning}
                    onClick={() => handleRunScraperNow(true)}
                    title="Re-scrape and overwrite existing records"
                  >
                    Force Upsert Run
                  </button>
                </div>
              </div>

              <pre
                style={{
                  background: '#0D0D0D',
                  color: '#00FF66',
                  fontFamily: 'Consolas, monospace',
                  fontSize: 12.5,
                  padding: 16,
                  borderRadius: 0,
                  border: '2px solid var(--ink)',
                  maxHeight: 360,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {scraperLog || 'No recent execution logs. Click "Run Scraper Now" to run.'}
              </pre>
            </div>
          </div>
        )}

        {/* ===================== TAB: WEBHOOKS ===================== */}
        {activeTab === 'webhooks' && (
          <div>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>KakaoTalk Department Webhooks</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 }}>
              Create webhook slugs for departments. Enter these slugs and URLs into the KakaoDump2 Android app.
            </p>

            {/* Create Department Form */}
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>➕ Create New Department Webhook</h3>
              <form onSubmit={handleCreateDepartment}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  <div>
                    <label>Department Display Name</label>
                    <input
                      placeholder="e.g. Artificial Intelligence"
                      value={newDeptName}
                      onChange={e => setNewDeptName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label>Webhook Slug (Optional)</label>
                    <input
                      placeholder="e.g. artificial_intelligence (auto-generated if blank)"
                      value={newDeptSlug}
                      onChange={e => setNewDeptSlug(e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ marginTop: 16 }}
                  disabled={creatingDept}
                >
                  {creatingDept ? 'Creating...' : 'Create Department Channel'}
                </button>
              </form>
            </div>

            {/* Department List */}
            <div className="card">
              <h3 style={{ fontSize: 16, marginBottom: 14 }}>Active Department Channels ({departments.length})</h3>
              {departments.length === 0 ? (
                <div className="locked">No departments registered yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {departments.map(d => (
                    <div
                      key={d.id}
                      style={{
                        border: '2px solid var(--ink)',
                        padding: '14px 16px',
                        background: 'var(--paper)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</span>
                          <span className="tag tag-announce">{d.slug}</span>
                          <span className="tag" style={{ background: 'var(--yellow)' }}>
                            {d.count || 0} messages
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, wordBreak: 'break-all' }}>
                          Webhook URL: <code>{d.webhook_url || `/api/ingest/kakao/${d.slug}`}</code>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '7px 12px', fontSize: 12 }}
                          onClick={() => copyToClipboard(d.webhook_url || `${window.location.origin}/api/ingest/kakao/${d.slug}`)}
                        >
                          📋 Copy Webhook URL
                        </button>
                        <button
                          className="btn"
                          style={{ padding: '7px 12px', fontSize: 12, background: '#FFF0F0', color: '#D00' }}
                          onClick={() => handleDeleteDepartment(d.slug, d.name)}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TAB: CONTENT ===================== */}
        {activeTab === 'content' && (
          <div>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>Content Management & Deletion</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 }}>
              Search, inspect, and delete individual notices or Kakao announcements from the database.
            </p>

            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  placeholder="Search notices or announcements by title or keywords..."
                  value={contentSearch}
                  onChange={e => setContentSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') fetchContent(1, contentSource, contentSearch) }}
                  style={{ flex: 1, minWidth: 240 }}
                />
                <select
                  value={contentSource}
                  onChange={e => {
                    setContentSource(e.target.value)
                    fetchContent(1, e.target.value, contentSearch)
                  }}
                  style={{ width: 'auto', minWidth: 180 }}
                >
                  <option value="">All Sources</option>
                  <option value="bic_notices">University Notices</option>
                  <option value="kakao_announcement">Kakao Announcements</option>
                </select>
                <button
                  className="btn btn-primary"
                  onClick={() => fetchContent(1, contentSource, contentSearch)}
                >
                  🔍 Search
                </button>
              </div>
            </div>

            {/* Content List Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '2px solid var(--ink)', background: 'var(--paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Results ({contentTotal} items)</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  Page {contentPage} of {contentTotalPages}
                </span>
              </div>

              {contentLoading ? (
                <div style={{ padding: 30, textAlign: 'center' }}>Loading content...</div>
              ) : contentItems.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center' }} className="locked">
                  No items found matching your filter.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {contentItems.map(item => (
                    <div
                      key={item.id}
                      style={{
                        padding: '14px 18px',
                        borderBottom: '1.5px solid var(--ink)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 16,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <span className={`tag ${item.source === 'bic_notices' ? 'tag-notice' : 'tag-announce'}`}>
                            {item.source === 'bic_notices' ? 'NOTICE' : 'KAKAO'}
                          </span>
                          {item.department && <span className="tag">{item.department}</span>}
                          <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                            {item.published_at || item.scraped_at}
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>
                          {item.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12.5,
                            color: 'var(--ink-soft)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {item.raw_text}
                        </div>
                      </div>

                      <button
                        className="btn"
                        style={{
                          background: '#FFF0F0',
                          color: '#D00',
                          padding: '7px 12px',
                          fontSize: 12,
                          flexShrink: 0,
                        }}
                        disabled={deletingId === item.id}
                        onClick={() => handleDeleteContent(item.id, item.title)}
                      >
                        {deletingId === item.id ? 'Deleting...' : '🗑️ Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {contentTotalPages > 1 && (
                <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <button
                    className="btn"
                    disabled={contentPage <= 1}
                    onClick={() => fetchContent(contentPage - 1)}
                  >
                    ← Prev
                  </button>
                  <span style={{ alignSelf: 'center', fontWeight: 700, fontSize: 13 }}>
                    {contentPage} / {contentTotalPages}
                  </span>
                  <button
                    className="btn"
                    disabled={contentPage >= contentTotalPages}
                    onClick={() => fetchContent(contentPage + 1)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== TAB: AI ===================== */}
        {activeTab === 'ai' && (
          <div>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>BIC AI Knowledge Base & Vector Index</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 20 }}>
              Manage the unified vector store index. When new notices or announcements are ingested or deleted,
              the index synchronizes them automatically.
            </p>

            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>Vector Store Status</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label>Storage Status</label>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {aiStorageReady ? '✅ Initialized & Ready' : '⚠️ Unbuilt (Needs Indexing)'}
                  </div>
                </div>
                <div>
                  <label>Indexed Documents</label>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {aiDocCount} document nodes
                  </div>
                </div>
                <div>
                  <label>Models</label>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                    LLM: <code>gemini-2.5-flash</code><br />
                    Embeddings: <code>models/gemini-embedding-001</code>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                <button
                  className="btn btn-primary"
                  disabled={aiBuilding}
                  onClick={handleRebuildAiIndex}
                >
                  {aiBuilding ? '⏳ Building Vector Index...' : '🔄 Rebuild / Sync Vector Index'}
                </button>
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: 16, marginBottom: 10 }}>Index Build Logs</h3>
              <pre
                style={{
                  background: '#0D0D0D',
                  color: '#00FF66',
                  fontFamily: 'Consolas, monospace',
                  fontSize: 12.5,
                  padding: 16,
                  border: '2px solid var(--ink)',
                  maxHeight: 300,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {aiBuildLog || 'No active build log. Click "Rebuild / Sync Vector Index" to run.'}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
