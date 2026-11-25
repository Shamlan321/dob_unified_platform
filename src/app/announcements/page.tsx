import Link from 'next/link'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default function AnnouncementsIndexPage() {
  const db = getDb()

  const deptNames = new Map<string, string>()
  const deptCounts = new Map<string, number>()

  // Load registered departments
  const dbDepts = db.prepare('SELECT slug, name FROM departments').all() as Array<{ slug: string; name: string }>
  for (const d of dbDepts) {
    deptNames.set(d.slug, d.name)
    deptCounts.set(d.slug, 0)
  }

  const rows = db.prepare(`
    SELECT department, COUNT(*) as cnt
    FROM content_items
    WHERE source = 'kakao_announcement' AND department IS NOT NULL
    GROUP BY department
  `).all() as Array<{ department: string; cnt: number }>

  for (const r of rows) {
    deptCounts.set(r.department, r.cnt)
    if (!deptNames.has(r.department)) {
      deptNames.set(r.department, r.department)
    }
  }

  const allDepts = Array.from(deptNames.keys())

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Announcements</h1>
        <p className="page-subtitle">
          Department-scoped KakaoTalk announcements. Select a department channel.
        </p>
      </div>

      <div className="home-cards">
        {allDepts.map(dept => (
          <Link
            key={dept}
            href={`/announcements/${encodeURIComponent(dept)}`}
            className="home-card"
          >
            <div className="home-card-icon">💬</div>
            <h3>
              {deptNames.get(dept) || dept}
              <span className="card-live">Live</span>
            </h3>
            <p>
              {deptCounts.get(dept) || 0} message
              {(deptCounts.get(dept) || 0) === 1 ? '' : 's'} ingested.
              {(deptCounts.get(dept) || 0) === 0
                ? ' Send test data via the KakaoDump Android app.'
                : ''}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
