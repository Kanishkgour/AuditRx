import { Link } from 'react-router-dom';

import '../styles/audit.css';

function PatientRecord() {
  return (
    <main className="audit-page">
      <header className="audit-header">
        <div>
          <span className="eyebrow tight">PATIENT RECORD</span>
          <h1>Sanjay Verma</h1>
        </div>

        <div className="review-actions">
          <Link to="/review" className="secondary-button">
            Review document
          </Link>
          <Link to="/audit/1" className="primary-button">
            View audit trail
          </Link>
        </div>
      </header>

      <section className="record-grid">
        <div className="record-card patient-card">
          <h2>Demographics</h2>
          <ul>
            <li><span>Patient ID</span><strong>PT-2048</strong></li>
            <li><span>Age</span><strong>42</strong></li>
            <li><span>Gender</span><strong>Male</strong></li>
            <li><span>Visit type</span><strong>OPD</strong></li>
          </ul>
        </div>

        <div className="record-card patient-card">
          <h2>Medication summary</h2>
          <ul>
            <li><span>Medicine</span><strong>Amlodipine 5mg</strong></li>
            <li><span>Dosage</span><strong>1 tablet daily</strong></li>
            <li><span>Diagnosis</span><strong>Hypertension</strong></li>
            <li><span>Follow-up</span><strong>7 days</strong></li>
          </ul>
        </div>
      </section>

      <section className="record-card timeline-card">
        <div className="panel-header">
          <h2>Clinical timeline</h2>
          <span className="status-pill">Approved</span>
        </div>

        <div className="timeline">
          <div className="timeline-item">
            <span className="time">09:40 AM</span>
            <div>
              <strong>Document uploaded</strong>
              <p>OPD prescription captured from clinician intake.</p>
            </div>
          </div>

          <div className="timeline-item">
            <span className="time">09:52 AM</span>
            <div>
              <strong>AI extraction complete</strong>
              <p>Structured fields generated with confidence scoring.</p>
            </div>
          </div>

          <div className="timeline-item">
            <span className="time">10:14 AM</span>
            <div>
              <strong>Clinician verification</strong>
              <p>Approved with minor edit to follow-up interval.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default PatientRecord;
