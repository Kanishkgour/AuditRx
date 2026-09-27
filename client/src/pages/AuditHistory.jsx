import { Link } from 'react-router-dom';

import '../styles/audit.css';

function AuditHistory() {
  const auditEntries = [
    {
      version: 'Version 01',
      actor: 'AI Extraction Engine',
      detail: 'Auto-detected medicine, dosage, diagnosis and follow-up fields.',
      time: '09:52 AM',
      status: 'Draft',
    },
    {
      version: 'Version 02',
      actor: 'Dr. Sharma',
      detail: 'Corrected follow-up interval and approved the diagnosis summary.',
      time: '10:14 AM',
      status: 'Approved',
    },
    {
      version: 'Version 03',
      actor: 'EMR Sync',
      detail: 'FHIR-ready record pushed for hospital digital record integration.',
      time: '10:26 AM',
      status: 'Synced',
    },
  ];

  return (
    <main className="audit-page">
      <header className="audit-header">
        <div>
          <span className="eyebrow tight">AUDIT TRAIL</span>
          <h1>Version history</h1>
        </div>

        <div className="review-actions">
          <Link to="/patient/2048" className="secondary-button">
            Patient record
          </Link>
          <Link to="/home" className="primary-button">
            Home
          </Link>
        </div>
      </header>

      <section className="record-card timeline-card">
        <div className="panel-header">
          <h2>Immutable record changes</h2>
          <span className="status-pill neutral">Tamper-aware</span>
        </div>

        <div className="audit-list">
          {auditEntries.map((entry) => (
            <div key={entry.version} className="audit-item">
              <div className="audit-version">
                <strong>{entry.version}</strong>
                <span>{entry.time}</span>
              </div>

              <div className="audit-body">
                <div className="audit-actor">{entry.actor}</div>
                <p>{entry.detail}</p>
              </div>

              <span className="audit-status">{entry.status}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default AuditHistory;
