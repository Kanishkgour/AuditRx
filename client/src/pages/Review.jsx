import { Link } from 'react-router-dom';

import '../styles/review.css';

function Review() {
  const fields = [
    { label: 'Medicine', value: 'Amlodipine 5mg', confidence: 96 },
    { label: 'Dosage', value: '1 tablet once daily', confidence: 94 },
    { label: 'Diagnosis', value: 'Hypertension / stress-related symptoms', confidence: 91 },
    { label: 'Follow-up', value: 'Revisit after 7 days', confidence: 48 },
  ];

  return (
    <main className="review-page">
      <header className="review-header">
        <div>
          <span className="eyebrow tight">CLINICAL REVIEW</span>
          <h1>AI extraction review</h1>
        </div>

        <div className="review-actions">
          <Link to="/home" className="secondary-button">
            Back to Home
          </Link>
          <button className="primary-button">Approve record</button>
        </div>
      </header>

      <section className="review-grid">
        <div className="document-panel">
          <div className="panel-header">
            <h2>Source document</h2>
            <span className="status-pill">Secure upload</span>
          </div>

          <div className="document-preview">
            <div className="document-surface">
              <div className="doc-header-row">
                <span>Dr. A. Sharma</span>
                <span>OPD 2087</span>
              </div>

              <div className="doc-body">
                <p><strong>Patient:</strong> Sanjay Verma</p>
                <p><strong>Age:</strong> 42</p>
                <p><strong>Symptoms:</strong> Headache, fatigue</p>
                <p><strong>Prescription:</strong> Amlodipine 5mg, Vitamin D3</p>
              </div>
            </div>
          </div>
        </div>

        <aside className="review-panel">
          <div className="panel-header">
            <h2>Confidence overview</h2>
            <span className="status-pill warning">Human review required</span>
          </div>

          <div className="confidence-list">
            {fields.map((field) => (
              <div key={field.label} className="confidence-item">
                <div className="confidence-topline">
                  <span>{field.label}</span>
                  <strong>{field.confidence}%</strong>
                </div>
                <div className="confidence-bar">
                  <span style={{ width: `${field.confidence}%` }} />
                </div>
                <div className="confidence-value">{field.value}</div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="detail-panel">
        <div className="panel-header">
          <h2>Extracted clinical data</h2>
          <span className="status-pill neutral">Draft version 02</span>
        </div>

        <div className="field-grid">
          <div className="field-card">
            <label>Medicine</label>
            <input defaultValue="Amlodipine 5mg" />
          </div>

          <div className="field-card">
            <label>Dosage</label>
            <input defaultValue="1 tablet once daily" />
          </div>

          <div className="field-card">
            <label>Doctor</label>
            <input defaultValue="Dr. A. Sharma" />
          </div>

          <div className="field-card">
            <label>Follow-up</label>
            <input defaultValue="Revisit after 7 days" />
          </div>

          <div className="field-card wide">
            <label>Clinical notes</label>
            <textarea defaultValue="Patient reports persistent headache and fatigue. Medication reviewed and follow-up advised in one week." />
          </div>
        </div>
      </section>
    </main>
  );
}

export default Review;
