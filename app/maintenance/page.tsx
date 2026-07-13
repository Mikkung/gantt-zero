export default function MaintenancePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'linear-gradient(135deg, #f8fafc 0%, #eef2ff 45%, #fbeaec 100%)',
        padding: 24,
      }}
    >
      <section
        aria-labelledby="maintenance-title"
        style={{
          width: '100%',
          maxWidth: 720,
          borderRadius: 24,
          border: '1px solid #e2e8f0',
          background: 'rgba(255, 255, 255, 0.94)',
          boxShadow: '0 24px 70px -28px rgba(15, 23, 42, 0.35)',
          padding: '32px 28px',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 16,
              background: '#fbeaec',
              color: '#8b2332',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ISE
          </div>
          <div>
            <div
              style={{
                color: '#0f172a',
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.3,
              }}
            >
              ISE Work Tracker
            </div>
            <div
              style={{
                color: '#64748b',
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              Internal Task Tracking System
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gap: 24,
          }}
        >
          <div>
            <p
              style={{
                margin: '0 0 8px',
                color: '#8b2332',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Maintenance Mode
            </p>
            <h1
              id="maintenance-title"
              style={{
                margin: 0,
                color: '#0f172a',
                fontSize: 30,
                lineHeight: 1.2,
                fontWeight: 750,
              }}
            >
              ระบบอยู่ระหว่างการปรับปรุง
            </h1>
            <p
              style={{
                margin: '14px 0 0',
                color: '#334155',
                fontSize: 16,
                lineHeight: 1.75,
              }}
            >
              ขณะนี้ระบบ Task Tracking อยู่ระหว่างการปรับปรุงเพื่อเพิ่มประสิทธิภาพและรองรับฟังก์ชันการประเมินภาระงาน
              กรุณากลับมาใช้งานอีกครั้งภายหลัง
            </p>
          </div>

          <div
            style={{
              borderTop: '1px solid #e2e8f0',
              paddingTop: 24,
            }}
          >
            <h2
              style={{
                margin: 0,
                color: '#0f172a',
                fontSize: 24,
                lineHeight: 1.25,
                fontWeight: 700,
              }}
            >
              System Under Maintenance
            </h2>
            <p
              style={{
                margin: '12px 0 0',
                color: '#475569',
                fontSize: 15,
                lineHeight: 1.7,
              }}
            >
              The Task Tracking system is currently being updated to improve
              performance and support the new workload assessment features.
              Please check back later.
            </p>
          </div>
        </div>

        <p
          style={{
            margin: '28px 0 0',
            color: '#64748b',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Thank you for your patience.
        </p>
      </section>
    </main>
  );
}
