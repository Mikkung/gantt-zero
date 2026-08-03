'use client';

import type { PeerReviewSummary } from '../types';
import { formatScore } from '../utils/scoring';

type PeerReviewInsightPanelProps = {
  summary: PeerReviewSummary | null;
};

function renderDistribution(value: Record<string, number> | null | undefined) {
  const entries = Object.entries(value ?? {});

  if (!entries.length) return <span style={{ color: '#64748b' }}>-</span>;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {entries.map(([label, count]) => (
        <span
          key={label}
          style={{
            borderRadius: 999,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            padding: '3px 8px',
            fontSize: 12,
          }}
        >
          {label}: {count}
        </span>
      ))}
    </div>
  );
}

function CommentList({ items }: { items: string[] | null | undefined }) {
  const list = (items ?? []).filter(Boolean).slice(0, 5);

  if (!list.length) return <div style={{ color: '#64748b' }}>-</div>;

  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      {list.map((item, index) => (
        <li key={`${item}:${index}`} style={{ marginBottom: 4 }}>
          {item}
        </li>
      ))}
      {(items?.length ?? 0) > 5 && (
        <li style={{ color: '#64748b' }}>
          ดูเพิ่มเติมอีก {(items?.length ?? 0) - 5} รายการ
        </li>
      )}
    </ul>
  );
}

export function PeerReviewInsightPanel({ summary }: PeerReviewInsightPanelProps) {
  if (!summary) {
    return (
      <section
        className="summary-card"
        style={{ background: '#ffffff', marginBottom: 16 }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>
          ข้อมูล Peer Review ประกอบการประเมิน
        </h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
          ไม่มีข้อมูล Peer Review
        </p>
      </section>
    );
  }

  return (
    <section
      className="summary-card"
      style={{ background: '#ffffff', marginBottom: 16 }}
    >
      <h2 style={{ marginTop: 0, fontSize: 18 }}>
        ข้อมูล Peer Review ประกอบการประเมิน
      </h2>
      <p style={{ marginTop: -4, color: '#64748b', fontSize: 13 }}>
        ข้อมูลนี้เป็น reference เท่านั้น และไม่เปลี่ยนคะแนนผู้บริหารอัตโนมัติ
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 10,
          marginTop: 12,
        }}
      >
        <div className="summary-card">
          <div className="summary-title">จำนวนผู้ประเมิน</div>
          <div className="summary-value">{summary.reviewer_count}</div>
        </div>
        <div className="summary-card">
          <div className="summary-title">ความน่าเชื่อถือ / ความรับผิดชอบ</div>
          <div className="summary-value">{formatScore(summary.avg_reliability)}</div>
        </div>
        <div className="summary-card">
          <div className="summary-title">การสื่อสารและการทำงานร่วมกัน</div>
          <div className="summary-value">
            {formatScore(summary.avg_communication_collab)}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-title">การแก้ไขปัญหา</div>
          <div className="summary-value">
            {formatScore(summary.avg_problem_solving)}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-title">คะแนนรวมเฉลี่ย</div>
          <div className="summary-value">{formatScore(summary.avg_overall_score)}</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 12,
          marginTop: 12,
        }}
      >
        <div
          style={{
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            padding: 10,
          }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Sentiment Analysis</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div>Positive: <strong>{summary.positive_count}</strong></div>
            <div>Neutral: <strong>{summary.neutral_count}</strong></div>
            <div>Negative: <strong>{summary.negative_count}</strong></div>
          </div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
            Avg confidence: positive {formatScore(summary.avg_positive_score)} ·
            neutral {formatScore(summary.avg_neutral_score)} · negative{' '}
            {formatScore(summary.avg_negative_score)}
          </div>
          {(summary.processing_errors?.length ?? 0) > 0 && (
            <div
              style={{
                marginTop: 8,
                borderRadius: 8,
                border: '1px solid #fecaca',
                background: '#fee2e2',
                color: '#991b1b',
                padding: 8,
                fontSize: 12,
              }}
            >
              มีข้อผิดพลาดจากการประมวลผล ML:{' '}
              {summary.processing_errors?.length ?? 0} รายการ
            </div>
          )}
        </div>

        <div
          style={{
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            padding: 10,
          }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>บริบทผู้ประเมิน</h3>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>ความสัมพันธ์ของผู้ประเมิน</strong>
            <div style={{ marginTop: 4 }}>
              {renderDistribution(summary.relation_summary)}
            </div>
          </div>
          <div style={{ fontSize: 13 }}>
            <strong>ความถี่ในการทำงานร่วมกัน</strong>
            <div style={{ marginTop: 4 }}>
              {renderDistribution(summary.work_frequency_summary)}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
          marginTop: 12,
          fontSize: 13,
        }}
      >
        <div>
          <strong>ความเห็นเชิงบวก / จุดแข็ง</strong>
          <CommentList items={summary.strength_comments} />
        </div>
        <div>
          <strong>ข้อเสนอแนะเพื่อการพัฒนา</strong>
          <CommentList items={summary.improvement_comments} />
        </div>
        <div>
          <strong>CommentTextForAI</strong>
          <CommentList items={summary.ai_comment_texts} />
        </div>
      </div>
    </section>
  );
}
