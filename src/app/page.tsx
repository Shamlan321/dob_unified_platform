'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { NoticeCard } from '@/components/NoticeCard'
import { AnnouncementCard } from '@/components/AnnouncementCard'
import { ContentItem, NoticesListResponse, AnnouncementsListResponse } from '@/lib/schema'
import { RagSource, AttachmentItem } from '@/lib/ai'

type View = 'landing' | 'app' | 'signup'
type Panel = 'dashboard' | 'notices' | 'announce' | 'ai' | 'profile'

interface AuthState {
  loggedIn: boolean
  dept: string
  studentId: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'ai' | 'error'
  text: string
  sources?: RagSource[]
  attachments?: AttachmentItem[]
  timing_ms?: number
  streaming?: boolean
  wordIdx?: number
}

const PANEL_NAMES: Panel[] = ['dashboard', 'notices', 'announce', 'ai', 'profile']
const DEPARTMENT_OPTIONS = [
  'Computer Engineering',
  'Business Administration',
  'Mechanical Engineering',
  'Nursing',
  'demo_dep',
]

const DEFAULT_AUTH: AuthState = { loggedIn: false, dept: 'Computer Engineering', studentId: '' }

function readStoredAuth(): AuthState {
  if (typeof window === 'undefined') return DEFAULT_AUTH
  const storedLoggedIn = localStorage.getItem('bp_loggedIn')
  const storedDept = localStorage.getItem('bp_dept')
  const storedStudentId = localStorage.getItem('bp_studentId')
  return {
    loggedIn: storedLoggedIn === 'true',
    dept: storedDept || 'Computer Engineering',
    studentId: storedStudentId || '',
  }
}

function useAuth() {
  const [auth, setAuth] = useState<AuthState>(DEFAULT_AUTH)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      const stored = readStoredAuth()
      if (stored.loggedIn !== DEFAULT_AUTH.loggedIn || stored.dept !== DEFAULT_AUTH.dept || stored.studentId !== DEFAULT_AUTH.studentId) {
        setAuth(stored)
      }
      setMounted(true)
    })
  }, [])

  const setLoggedIn = useCallback((v: boolean) => {
    localStorage.setItem('bp_loggedIn', String(v))
    setAuth(prev => ({ ...prev, loggedIn: v }))
  }, [])

  const setDept = useCallback((v: string) => {
    localStorage.setItem('bp_dept', v)
    setAuth(prev => ({ ...prev, dept: v }))
  }, [])

  const setStudentId = useCallback((v: string) => {
    localStorage.setItem('bp_studentId', v)
    setAuth(prev => ({ ...prev, studentId: v }))
  }, [])

  const signOut = useCallback(() => {
    localStorage.setItem('bp_loggedIn', 'false')
    setAuth(prev => ({ ...prev, loggedIn: false, studentId: '' }))
  }, [])

  return { auth, mounted, setLoggedIn, setDept, setStudentId, signOut }
}

async function fetchNoticesList(page: number, limit: number): Promise<{ notices: ContentItem[]; total: number; totalPages: number }> {
  const res = await fetch(`/api/notices?page=${page}&limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch notices')
  const data: NoticesListResponse = await res.json()
  return { notices: data.notices, total: data.total, totalPages: data.totalPages }
}

async function fetchAnnouncementsList(dept: string, page: number, limit: number): Promise<{ announcements: ContentItem[]; total: number; totalPages: number }> {
  const res = await fetch(`/api/announcements/${encodeURIComponent(dept)}?page=${page}&limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch announcements')
  const data: AnnouncementsListResponse = await res.json()
  return { announcements: data.announcements, total: data.total, totalPages: data.totalPages }
}

function CardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <div style={{ height: 12, width: '40%', background: 'var(--locked)', marginBottom: 10 }} />
      <div style={{ height: 14, width: '85%', background: 'var(--locked)', marginBottom: 8 }} />
      <div style={{ height: 12, width: '30%', background: 'var(--locked)' }} />
    </div>
  )
}

function LockedAnnounceCard({ onSignup }: { onSignup: () => void }) {
  return (
    <div className="locked">
      <div style={{ fontWeight: 700 }}>{"Sign in to view your department&apos;s announcements"}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '8px 0 12px' }}>
        {"Pulled from your department&apos;s KakaoTalk group."}
      </div>
      <button className="btn btn-primary" onClick={onSignup}>Sign up</button>
    </div>
  )
}

function EmptyNoticesCard() {
  return (
    <div className="locked">
      <div style={{ fontWeight: 700 }}>No notices yet</div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
        {"Check back soon \u2014 we&apos;re scraping the latest from the university."}
      </div>
    </div>
  )
}

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <div className="logo" onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="logo-box">BP</div>
      <b className="display">BIC Pulse</b>
    </div>
  )
}

export default function HomePage() {
  const { auth, mounted, setLoggedIn, setDept, setStudentId, signOut } = useAuth()

  const [view, setView] = useState<View>('landing')
  const [activePanel, setActivePanel] = useState<Panel>('dashboard')

  const [landingNotices, setLandingNotices] = useState<ContentItem[]>([])
  const [landingNoticesLoading, setLandingNoticesLoading] = useState(true)

  const [dashNotices, setDashNotices] = useState<ContentItem[]>([])
  const [dashNoticesLoading, setDashNoticesLoading] = useState(false)

  const [dashAnnounce, setDashAnnounce] = useState<ContentItem[]>([])
  const [dashAnnounceLoading, setDashAnnounceLoading] = useState(false)
  const [dashAnnounceTotal, setDashAnnounceTotal] = useState(0)

  const [fullNotices, setFullNotices] = useState<ContentItem[]>([])
  const [fullNoticesLoading, setFullNoticesLoading] = useState(false)
  const [fullNoticesPage, setFullNoticesPage] = useState(1)
  const [fullNoticesTotalPages, setFullNoticesTotalPages] = useState(1)
  const [fullNoticesTotal, setFullNoticesTotal] = useState(0)

  const [announceList, setAnnounceList] = useState<ContentItem[]>([])
  const [announceLoading, setAnnounceLoading] = useState(false)
  const [announcePage, setAnnouncePage] = useState(1)
  const [announceTotalPages, setAnnounceTotalPages] = useState(1)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const chatLogRef = useRef<HTMLDivElement>(null)
  const streamingRefs = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  const [suId, setSuId] = useState('')
  const [suDept, setSuDept] = useState(auth.dept)
  const [expandedSourceMsgIds, setExpandedSourceMsgIds] = useState<Set<string>>(new Set())
  const [expandedAttachmentMsgIds, setExpandedAttachmentMsgIds] = useState<Set<string>>(new Set())

  function toggleSources(msgId: string) {
    setExpandedSourceMsgIds(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }

  function toggleAttachments(msgId: string) {
    setExpandedAttachmentMsgIds(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }

  useEffect(() => {
    if (!mounted) return
    queueMicrotask(() => {
      const hash = window.location.hash.replace('#', '')
      if (!hash || hash === 'landing') {
        setView('landing')
      } else if (hash === 'signup') {
        setView('signup')
      } else if (hash === 'app' || (PANEL_NAMES as string[]).includes(hash)) {
        setView('app')
        if ((PANEL_NAMES as string[]).includes(hash)) {
          setActivePanel(hash as Panel)
        }
      }
    })
  }, [mounted])

  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.replace('#', '')
      if (!hash || hash === 'landing') {
        setView('landing')
      } else if (hash === 'signup') {
        setView('signup')
      } else if (hash === 'app') {
        setView('app')
        setActivePanel('dashboard')
      } else if ((PANEL_NAMES as string[]).includes(hash)) {
        setView('app')
        setActivePanel(hash as Panel)
      }
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const go = useCallback((next: View) => {
    if (next === 'app') {
      window.location.hash = 'app'
      setActivePanel('dashboard')
    } else {
      window.location.hash = next
    }
    setView(next)
    if (next === 'app') setActivePanel('dashboard')
    window.scrollTo(0, 0)
  }, [])

  const showTab = useCallback((panel: Panel) => {
    window.location.hash = panel
    setView('app')
    setActivePanel(panel)
    window.scrollTo(0, 0)
  }, [])

  // Landing notices - fetch once on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { notices } = await fetchNoticesList(1, 3)
        if (!cancelled) setLandingNotices(notices)
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLandingNoticesLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Dashboard notices + announcements fetch when entering dashboard or auth changes
  useEffect(() => {
    if (view !== 'app' || activePanel !== 'dashboard') return
    let cancelled = false

    queueMicrotask(() => {
      setDashNoticesLoading(true)
    })
    async function loadDashNotices() {
      try {
        const { notices } = await fetchNoticesList(1, 2)
        if (!cancelled) setDashNotices(notices)
      } catch {
        // ignore
      } finally {
        if (!cancelled) setDashNoticesLoading(false)
      }
    }
    loadDashNotices()

    if (auth.loggedIn) {
      queueMicrotask(() => {
        setDashAnnounceLoading(true)
      })
      fetchAnnouncementsList(auth.dept, 1, 20)
        .then(({ announcements, total }) => {
          if (!cancelled) {
            setDashAnnounce(announcements)
            setDashAnnounceTotal(total)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDashAnnounce([])
            setDashAnnounceTotal(0)
          }
        })
        .finally(() => {
          if (!cancelled) setDashAnnounceLoading(false)
        })
    } else {
      queueMicrotask(() => {
        setDashAnnounce([])
        setDashAnnounceTotal(0)
      })
    }

    return () => { cancelled = true }
  }, [view, activePanel, auth.loggedIn, auth.dept])

  // Full notices list pagination
  useEffect(() => {
    if (view !== 'app' || activePanel !== 'notices') return
    let cancelled = false
    queueMicrotask(() => {
      setFullNoticesLoading(true)
    })
    fetchNoticesList(fullNoticesPage, 10)
      .then(({ notices, total, totalPages }) => {
        if (!cancelled) {
          setFullNotices(notices)
          setFullNoticesTotal(total)
          setFullNoticesTotalPages(totalPages)
        }
      })
      .catch(() => {
        if (!cancelled) setFullNotices([])
      })
      .finally(() => {
        if (!cancelled) setFullNoticesLoading(false)
      })
    return () => { cancelled = true }
  }, [view, activePanel, fullNoticesPage])

  // Announcements list
  useEffect(() => {
    if (view !== 'app' || activePanel !== 'announce' || !auth.loggedIn) return
    let cancelled = false
    queueMicrotask(() => {
      setAnnounceLoading(true)
    })
    fetchAnnouncementsList(auth.dept, announcePage, 20)
      .then(({ announcements, totalPages }) => {
        if (!cancelled) {
          setAnnounceList(announcements)
          setAnnounceTotalPages(totalPages)
        }
      })
      .catch(() => {
        if (!cancelled) setAnnounceList([])
      })
      .finally(() => {
        if (!cancelled) setAnnounceLoading(false)
      })
    return () => { cancelled = true }
  }, [view, activePanel, announcePage, auth.loggedIn, auth.dept])

  // Sync suDept default when mounted auth loads
  useEffect(() => {
    if (mounted) {
      queueMicrotask(() => setSuDept(auth.dept))
    }
  }, [mounted, auth.dept])

  // Auto-scroll chat log
  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
    }
  }, [messages])

  function ask(questionRaw?: string) {
    const q = (questionRaw ?? chatInput).trim()
    if (!q) return
    setChatInput('')

    const userMsgId = 'u_' + Date.now()
    const aiMsgId = 'a_' + (Date.now() + 1)

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', text: q },
      { id: aiMsgId, role: 'ai', text: '', streaming: true, sources: [], attachments: [], wordIdx: 0 },
    ])

    const body: { question: string; department?: string } = { question: q }
    if (auth.loggedIn) body.department = auth.dept

    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(res => res.json())
      .then((data: { answer?: string; sources?: RagSource[]; attachments?: AttachmentItem[]; timing_ms?: number; error?: string }) => {
        if (data.error && !data.answer) {
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId
              ? { id: aiMsgId, role: 'error', text: data.error || 'Something went wrong.' }
              : m
          ))
          return
        }
        const fullText = data.answer || ''
        const words = fullText.split(' ')
        const interval = setInterval(() => {
          setMessages(prev => prev.map(m => {
            if (m.id !== aiMsgId) return m
            const idx = (m.wordIdx ?? 0) + 1
            const done = idx >= words.length
            const currentText = words.slice(0, idx).join(' ')
            if (done) {
              clearInterval(interval)
              streamingRefs.current.delete(aiMsgId)
              return {
                id: aiMsgId,
                role: 'ai',
                text: currentText,
                sources: data.sources,
                attachments: data.attachments,
                timing_ms: data.timing_ms,
                streaming: false,
                wordIdx: idx,
              }
            }
            return {
              ...m,
              text: currentText,
              wordIdx: idx,
            }
          }))
        }, 18)
        streamingRefs.current.set(aiMsgId, interval)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Network error'
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId
            ? { id: aiMsgId, role: 'error', text: msg }
            : m
        ))
      })
  }

  function completeSignup() {
    if (!suId.trim()) return
    setStudentId(suId.trim())
    setDept(suDept)
    setLoggedIn(true)
    go('app')
    showTab('dashboard')
  }

  useEffect(() => {
    const refsMap = streamingRefs.current
    return () => {
      refsMap.forEach(timer => clearInterval(timer))
      refsMap.clear()
    }
  }, [])

  const sidebarScope = auth.loggedIn
    ? `Signed in · ${auth.dept}`
    : 'Viewing public data only.'

  const scopeNote = auth.loggedIn
    ? `Signed in as ${auth.dept} — answers can use your department's announcements too.`
    : 'Signed out — answers use public Notices only.'

  // ===== RENDER =====
  return (
    <>
      {/* ============ LANDING ============ */}
      <div className={`view ${view === 'landing' ? 'active' : ''}`}>
        <nav className="land-nav">
          <Logo onClick={() => go('landing')} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => go('app')}>Dashboard</button>
            <button className="btn btn-primary" onClick={() => go('signup')}>Sign up</button>
          </div>
        </nav>

        <section className="hero">
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-soft)' }}>
            TONGMYONG UNIVERSITY · BUSAN
          </div>
          <h1 style={{ marginTop: 10 }}>
            Everything about your university, <span className="hl">in one place.</span>
          </h1>
          <p className="lede" style={{ marginTop: 14 }}>
            Notices, department announcements, and a search that actually answers your questions.
          </p>
          <div className="hero-search">
            <input
              placeholder="Ask anything about the university…"
              onClick={() => { go('app'); showTab('ai') }}
              onFocus={() => { go('app'); showTab('ai') }}
              readOnly
            />
            <button onClick={() => { go('app'); showTab('ai') }}>Ask →</button>
          </div>
        </section>

        <section className="land-section">
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-soft)' }}>
            LATEST NOTICES · NO LOGIN NEEDED
          </div>
          <div id="landing-notices" style={{ marginTop: 14 }}>
            {landingNoticesLoading ? (
              <>
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </>
            ) : landingNotices.length === 0 ? (
              <EmptyNoticesCard />
            ) : (
              landingNotices.map(n => <NoticeCard key={n.id} notice={n} />)
            )}
          </div>
        </section>

        <section className="land-section">
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-soft)' }}>
            DEPARTMENT ANNOUNCEMENTS
          </div>
          <p className="lede" style={{ marginTop: 10 }}>
            {"Sign up with your student ID and department to unlock your group&apos;s announcements here."}
          </p>
          <button className="btn btn-secondary" style={{ marginTop: 14 }} onClick={() => go('signup')}>
            Sign up with student ID
          </button>
        </section>

        <footer className="footer">
          <div>
            <span className="badge">Built with university permission</span>
          </div>
          <div>Independent student project, not an official university system.</div>
        </footer>
      </div>

      {/* ============ APP SHELL ============ */}
      <div className={`view ${view === 'app' ? 'active' : ''}`}>
        <div className="shell">
          <div className="sidebar">
            <Logo onClick={() => go('landing')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div
                className={`nav-item ${activePanel === 'dashboard' ? 'active' : ''}`}
                data-tab="dashboard"
                onClick={() => showTab('dashboard')}
                role="button"
              >
                Home
              </div>
              <div
                className={`nav-item ${activePanel === 'notices' ? 'active' : ''}`}
                data-tab="notices"
                onClick={() => showTab('notices')}
                role="button"
              >
                Notices
              </div>
              <div
                className={`nav-item ${activePanel === 'announce' ? 'active' : ''}`}
                data-tab="announce"
                onClick={() => showTab('announce')}
                role="button"
              >
                Announcements
              </div>
              <div
                className={`nav-item ${activePanel === 'ai' ? 'active' : ''}`}
                data-tab="ai"
                onClick={() => showTab('ai')}
                role="button"
              >
                BIC AI
              </div>
              <div
                className={`nav-item ${activePanel === 'profile' ? 'active' : ''}`}
                data-tab="profile"
                onClick={() => showTab('profile')}
                role="button"
              >
                {auth.loggedIn ? 'Profile' : 'Sign in'}
              </div>
              <a
                href="/admin"
                className="nav-item"
                style={{ textDecoration: 'none', color: 'inherit', marginTop: 4 }}
              >
                ⚙️ Admin
              </a>
            </div>
            <div
              style={{
                marginTop: 'auto',
                fontSize: 11,
                color: 'var(--ink-soft)',
                borderTop: '1.5px solid var(--ink)',
                paddingTop: 10,
              }}
            >
              {sidebarScope}
            </div>
          </div>

          <div className="main">
            {/* ============ PANEL: DASHBOARD ============ */}
            <div className={`panel ${activePanel === 'dashboard' ? 'active' : ''}`}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-soft)' }}>HOME</div>
              <h1 style={{ fontSize: 26, marginBottom: 16 }}>Good to see you.</h1>

              <div className="stat-row">
                <div className="stat">
                  <div className="num">{fullNoticesTotal || (dashNoticesLoading ? '—' : dashNotices.length)}</div>
                  <div className="lbl">NEW NOTICES</div>
                </div>
                <div className="stat">
                  <div className="num">{auth.loggedIn ? (dashAnnounceLoading ? '—' : dashAnnounceTotal) : '—'}</div>
                  <div className="lbl">ANNOUNCEMENTS</div>
                </div>
              </div>

              <div className="section-label">
                <div className="n">01</div>
                <div className="line" />
                <b style={{ fontSize: 13 }}>RECENT NOTICES</b>
              </div>
              {dashNoticesLoading ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : dashNotices.length === 0 ? (
                <EmptyNoticesCard />
              ) : (
                dashNotices.map(n => <NoticeCard key={n.id} notice={n} />)
              )}

              <div className="section-label">
                <div className="n">02</div>
                <div className="line" />
                <b style={{ fontSize: 13 }}>ANNOUNCEMENTS</b>
              </div>
              {!auth.loggedIn ? (
                <LockedAnnounceCard onSignup={() => go('signup')} />
              ) : dashAnnounceLoading ? (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              ) : dashAnnounce.length === 0 ? (
                <div className="locked">
                  <div style={{ fontWeight: 700 }}>No announcements yet for {auth.dept}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
                    {"When new Kakao messages come in, they&apos;ll appear here."}
                  </div>
                </div>
              ) : (
                dashAnnounce.slice(0, 2).map(a => <AnnouncementCard key={a.id} announcement={a} />)
              )}
            </div>

            {/* ============ PANEL: NOTICES ============ */}
            <div className={`panel ${activePanel === 'notices' ? 'active' : ''}`}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-soft)' }}>
                PUBLIC · NO LOGIN REQUIRED
              </div>
              <h1 style={{ fontSize: 26, marginBottom: 16 }}>Notices</h1>

              {fullNoticesLoading ? (
                Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
              ) : fullNotices.length === 0 ? (
                <EmptyNoticesCard />
              ) : (
                fullNotices.map(n => <NoticeCard key={n.id} notice={n} />)
              )}

              {fullNoticesTotalPages > 1 && (
                <div className="pagination">
                  {fullNoticesPage > 1 ? (
                    <a
                      href="#"
                      onClick={e => {
                        e.preventDefault()
                        setFullNoticesPage(p => Math.max(1, p - 1))
                      }}
                    >
                      ← Prev
                    </a>
                  ) : (
                    <span style={{ opacity: 0.4 }}>← Prev</span>
                  )}
                  <span className="current">
                    {fullNoticesPage} / {fullNoticesTotalPages}
                  </span>
                  {fullNoticesPage < fullNoticesTotalPages ? (
                    <a
                      href="#"
                      onClick={e => {
                        e.preventDefault()
                        setFullNoticesPage(p => p + 1)
                      }}
                    >
                      Next →
                    </a>
                  ) : (
                    <span style={{ opacity: 0.4 }}>Next →</span>
                  )}
                </div>
              )}
            </div>

            {/* ============ PANEL: ANNOUNCE ============ */}
            <div className={`panel ${activePanel === 'announce' ? 'active' : ''}`}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-soft)' }}>
                {auth.loggedIn ? `YOUR DEPARTMENT · ${auth.dept.toUpperCase()}` : 'GATED · SIGN-UP REQUIRED'}
              </div>
              <h1 style={{ fontSize: 26, marginBottom: 16 }}>Announcements</h1>

              {!auth.loggedIn ? (
                <LockedAnnounceCard onSignup={() => go('signup')} />
              ) : announceLoading ? (
                Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
              ) : announceList.length === 0 ? (
                <div className="locked">
                  <div style={{ fontWeight: 700 }}>No announcements yet for {auth.dept}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
                    {"When new Kakao messages come in, they&apos;ll appear here."}
                  </div>
                </div>
              ) : (
                <>
                  {announceList.map(a => <AnnouncementCard key={a.id} announcement={a} />)}
                  {announceTotalPages > 1 && (
                    <div className="pagination">
                      {announcePage > 1 ? (
                        <a
                          href="#"
                          onClick={e => {
                            e.preventDefault()
                            setAnnouncePage(p => Math.max(1, p - 1))
                          }}
                        >
                          ← Prev
                        </a>
                      ) : (
                        <span style={{ opacity: 0.4 }}>← Prev</span>
                      )}
                      <span className="current">
                        {announcePage} / {announceTotalPages}
                      </span>
                      {announcePage < announceTotalPages ? (
                        <a
                          href="#"
                          onClick={e => {
                            e.preventDefault()
                            setAnnouncePage(p => p + 1)
                          }}
                        >
                          Next →
                        </a>
                      ) : (
                        <span style={{ opacity: 0.4 }}>Next →</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ============ PANEL: AI ============ */}
            <div className={`panel ${activePanel === 'ai' ? 'active' : ''}`}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink-soft)' }}>BIC AI</div>
              <h1 style={{ fontSize: 24, marginBottom: 14 }}>Ask anything about the university.</h1>

              <div className="chat">
                <div className="chat-log" ref={chatLogRef}>
                  {messages.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 30, color: 'var(--ink-soft)', fontSize: 13 }}>
                      No messages yet. Try a suggestion below or type a question.
                    </div>
                  )}
                  {messages.map(m => {
                    if (m.role === 'user') {
                      return <div key={m.id} className="msg-user">{m.text}</div>
                    }
                    if (m.role === 'error') {
                      return (
                        <div key={m.id} className="msg-ai">
                          <div className="bubble" style={{ background: '#ffe0e0' }}>
                            ⚠ {m.text}
                          </div>
                        </div>
                      )
                    }
                    const isSourcesOpen = expandedSourceMsgIds.has(m.id)
                    const isAttachmentsOpen = expandedAttachmentMsgIds.has(m.id)
                    const hasAttachments = !m.streaming && !!m.attachments && m.attachments.length > 0
                    const hasSources = !m.streaming && !!m.sources && m.sources.length > 0

                    return (
                      <div key={m.id} className="msg-ai">
                        <div className="bubble">
                          {m.text}
                          {m.streaming && <span className="cursor" />}
                        </div>

                        {/* Interactive Meta Row: Collapsible Attachments, Sources & Latency */}
                        {(hasAttachments || hasSources || (!m.streaming && m.timing_ms)) && (
                          <div style={{ marginTop: 8, maxWidth: '85%', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {hasAttachments && (
                              <button
                                className="btn btn-ghost"
                                onClick={() => toggleAttachments(m.id)}
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  padding: '4px 10px',
                                  background: isAttachmentsOpen ? 'var(--yellow)' : 'var(--card)',
                                  border: '1.5px solid var(--ink)',
                                  boxShadow: 'var(--shadow-sm)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  cursor: 'pointer',
                                }}
                              >
                                <span>📎 {m.attachments!.length} Attached Files</span>
                                <span style={{ fontSize: 10 }}>{isAttachmentsOpen ? '▴ Hide' : '▾ View'}</span>
                              </button>
                            )}

                            {hasSources && (
                              <button
                                className="btn btn-ghost"
                                onClick={() => toggleSources(m.id)}
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  padding: '4px 10px',
                                  background: isSourcesOpen ? 'var(--yellow)' : 'var(--card)',
                                  border: '1.5px solid var(--ink)',
                                  boxShadow: 'var(--shadow-sm)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  cursor: 'pointer',
                                }}
                              >
                                <span>📚 {m.sources!.length} Sources</span>
                                <span style={{ fontSize: 10 }}>{isSourcesOpen ? '▴ Hide' : '▾ View'}</span>
                              </button>
                            )}

                            {!m.streaming && m.timing_ms && (
                              <span style={{ fontSize: 10.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
                                ⚡ {(m.timing_ms / 1000).toFixed(1)}s
                              </span>
                            )}
                          </div>
                        )}

                        {/* Collapsible Attachments Drawer */}
                        {hasAttachments && isAttachmentsOpen && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: '12px 14px',
                              background: 'var(--card)',
                              border: '2px solid var(--ink)',
                              boxShadow: 'var(--shadow-sm)',
                              maxWidth: '85%',
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                color: 'var(--ink-soft)',
                                marginBottom: 8,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <span>📎 Attached Files & Official Downloads ({m.attachments!.length})</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {m.attachments!.map((att, idx) => (
                                <a
                                  key={idx}
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '7px 12px',
                                    fontSize: 12.5,
                                    background: 'var(--paper)',
                                    textDecoration: 'none',
                                    color: 'var(--ink)',
                                  }}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8, fontWeight: 600 }}>
                                    📄 {att.name}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      background: 'var(--yellow)',
                                      padding: '2px 8px',
                                      border: '1.5px solid var(--ink)',
                                      flexShrink: 0,
                                    }}
                                  >
                                    Download ⬇
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Collapsible Sources Drawer */}
                        {hasSources && isSourcesOpen && (
                          <div
                            style={{
                              marginTop: 8,
                              maxWidth: '85%',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              background: 'var(--card)',
                              padding: '12px 14px',
                              border: '2px solid var(--ink)',
                              boxShadow: 'var(--shadow-sm)',
                            }}
                          >
                            {m.sources!.map((s, i) => (
                              <div
                                key={i}
                                style={{
                                  borderBottom: i < m.sources!.length - 1 ? '1.5px dashed var(--ink)' : 'none',
                                  paddingBottom: 8,
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                                  <div style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{s.label}</div>
                                  {s.source_url && (
                                    <a
                                      href={s.source_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        background: 'var(--yellow)',
                                        padding: '2px 8px',
                                        border: '1px solid var(--ink)',
                                        textDecoration: 'none',
                                        color: 'var(--ink)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        flexShrink: 0,
                                      }}
                                    >
                                      View Notice ↗
                                    </a>
                                  )}
                                </div>
                                {s.preview && (
                                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.4 }}>
                                    {s.preview}…
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="chip-row">
                  <div
                    className="sugg"
                    onClick={() => ask('When does registration open?')}
                    role="button"
                  >
                    When does registration open?
                  </div>
                  <div
                    className="sugg"
                    onClick={() => ask('Latest from my department?')}
                    role="button"
                  >
                    Latest from my department?
                  </div>
                </div>

                <div className="scope-note">{scopeNote}</div>

                <div className="chat-input">
                  <input
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="Type your question…"
                    onKeyDown={e => {
                      if (e.key === 'Enter') ask()
                    }}
                  />
                  <button onClick={() => ask()}>Send</button>
                </div>
              </div>
            </div>

            {/* ============ PANEL: PROFILE ============ */}
            <div className={`panel ${activePanel === 'profile' ? 'active' : ''}`}>
              {!auth.loggedIn ? (
                <>
                  <h1 style={{ fontSize: 24 }}>{"You&apos;re not signed in."}</h1>
                  <p className="lede" style={{ margin: '10px 0 16px' }}>
                    {"Sign in to unlock your department&apos;s announcements."}
                  </p>
                  <button className="btn btn-primary" onClick={() => go('signup')}>Sign up</button>
                </>
              ) : (
                <>
                  <h1 style={{ fontSize: 24 }}>Signed in</h1>
                  <div className="card" style={{ maxWidth: 320, marginTop: 14 }}>
                    {auth.studentId && (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>STUDENT ID</div>
                        <div style={{ fontWeight: 700, marginBottom: 10 }}>{auth.studentId}</div>
                      </>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>DEPARTMENT</div>
                    <div style={{ fontWeight: 700 }}>{auth.dept}</div>
                  </div>
                  <button
                    className="btn"
                    style={{ marginTop: 14 }}
                    onClick={() => {
                      signOut()
                      go('landing')
                    }}
                  >
                    Sign out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="bottom-tabs">
          <div
            className={`tab ${activePanel === 'dashboard' ? 'active' : ''}`}
            data-tab="dashboard"
            onClick={() => showTab('dashboard')}
            role="button"
          >
            Home
          </div>
          <div
            className={`tab ${activePanel === 'notices' ? 'active' : ''}`}
            data-tab="notices"
            onClick={() => showTab('notices')}
            role="button"
          >
            Notices
          </div>
          <div
            className={`tab ${activePanel === 'announce' ? 'active' : ''}`}
            data-tab="announce"
            onClick={() => showTab('announce')}
            role="button"
          >
            Dept
          </div>
          <div
            className={`tab ${activePanel === 'ai' ? 'active' : ''}`}
            data-tab="ai"
            onClick={() => showTab('ai')}
            role="button"
          >
            BIC AI
          </div>
          <div
            className={`tab ${activePanel === 'profile' ? 'active' : ''}`}
            data-tab="profile"
            onClick={() => showTab('profile')}
            role="button"
          >
            You
          </div>
        </div>
      </div>

      {/* ============ SIGNUP ============ */}
      <div className={`view ${view === 'signup' ? 'active' : ''}`}>
        <nav className="land-nav">
          <Logo onClick={() => go('landing')} />
          <button className="btn btn-ghost" onClick={() => go('landing')}>Back</button>
        </nav>

        <section className="land-section" style={{ maxWidth: 440, margin: '0 auto', border: 'none' }}>
          <h1 style={{ fontSize: 26 }}>Unlock your department.</h1>
          <p className="lede" style={{ marginBottom: 20 }}>
            {"Used only to confirm which department&apos;s announcements you can see."}
          </p>

          <div className="field">
            <label>Student ID</label>
            <input
              id="su-id"
              placeholder="e.g. 20231234"
              value={suId}
              onChange={e => setSuId(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Department</label>
            <select
              id="su-dept"
              value={suDept}
              onChange={e => setSuDept(e.target.value)}
            >
              {DEPARTMENT_OPTIONS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Password</label>
            <input
              id="su-pass"
              type="password"
              placeholder="••••••••"
            />
          </div>

          <button className="btn btn-primary btn-block" onClick={completeSignup}>
            Create account
          </button>
        </section>
      </div>
    </>
  )
}
