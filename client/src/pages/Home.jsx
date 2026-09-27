import { Link } from 'react-router-dom';

import '../styles/home.css';

function Home() {
  return (
    <main className="home-page">
      <nav className="navbar">
        <div className="brand">
          <div className="brand-icon">✚</div>
          <span>LekhaRx</span>
        </div>

        <div className="nav-links">
          <a href="#home">Home</a>
          <a href="#workflow">How it works</a>
          <a href="#safety">Safety</a>
          <a href="#about">About</a>
        </div>

        <div className="profile">
          <div className="avatar">DR</div>
          <span>Dr. Sharma</span>
        </div>
      </nav>

      <section className="hero" id="home">
        <div className="hero-content">
          <span className="eyebrow">AI-POWERED CLINICAL DOCUMENT INTELLIGENCE</span>

          <h1>
            From handwritten care
            <span>to trusted records.</span>
          </h1>

          <p className="hero-description">
            LekhaRx converts handwritten prescriptions, OPD cards, case sheets and discharge
            summaries into structured clinical records — with field-level confidence and human
            verification before anything becomes an approved record.
          </p>

          <div className="workflow">
            <div className="workflow-item">
              <div className="workflow-number">01</div>
              Capture
            </div>
            <span className="workflow-arrow">→</span>

            <div className="workflow-item">
              <div className="workflow-number">02</div>
              Extract
            </div>
            <span className="workflow-arrow">→</span>

            <div className="workflow-item">
              <div className="workflow-number">03</div>
              Verify
            </div>
            <span className="workflow-arrow">→</span>

            <div className="workflow-item">
              <div className="workflow-number">04</div>
              Commit
            </div>
          </div>
        </div>

        <div className="upload-card">
          <div className="upload-header">
            <div className="upload-icon">📄</div>
            <div>
              <h2>New Clinical Document</h2>
              <p>Start a new digitization</p>
            </div>
          </div>

          <div className="drop-zone">
            <div className="camera">📷</div>
            <h3>Capture or upload document</h3>
            <p>Prescription • OPD • Case Sheet • Discharge</p>

            <Link to="/review" className="upload-button">
              Capture / Upload
            </Link>
          </div>

          <p className="upload-note">JPG, PNG or PDF • Secure processing</p>
        </div>
      </section>

      <section className="trust-bar">
        <div className="trust-item">
          <strong>Field-Level Confidence</strong>
          <span>Every extracted field is scored</span>
        </div>

        <div className="trust-item">
          <strong>No Guessing</strong>
          <span>Ambiguous information is flagged</span>
        </div>

        <div className="trust-item">
          <strong>Human Approval</strong>
          <span>Clinician remains in control</span>
        </div>

        <div className="trust-item">
          <strong>Full Audit Trail</strong>
          <span>Original records remain preserved</span>
        </div>
      </section>

      <section className="section" id="workflow">
        <div className="section-heading">
          <span className="section-label">CLINICAL WORKFLOW</span>
          <h2>From paper to verified record.</h2>
          <p>Every stage is designed around accuracy, transparency and clinician control.</p>
        </div>

        <div className="steps">
          <div className="step">
            <span className="step-number">STEP 01</span>
            <h3>Capture</h3>
            <p>Upload a photograph or scanned image of a clinical document.</p>
          </div>

          <div className="step">
            <span className="step-number">STEP 02</span>
            <h3>AI Extraction</h3>
            <p>Handwritten information is converted into structured clinical fields.</p>
          </div>

          <div className="step">
            <span className="step-number">STEP 03</span>
            <h3>Verify</h3>
            <p>Low-confidence or ambiguous fields are highlighted for clinician review.</p>
          </div>

          <div className="step">
            <span className="step-number">STEP 04</span>
            <h3>Commit</h3>
            <p>Approved information is linked to the patient record and preserved.</p>
          </div>
        </div>
      </section>

      <section className="safety" id="safety">
        <div className="safety-grid">
          <div>
            <span className="section-label">TRUST &amp; SAFETY</span>
            <h2>
              AI that knows when
              <span>not to guess.</span>
            </h2>

            <p className="safety-description">
              Medical information cannot be treated like ordinary text. LekhaRx separates AI
              extraction from clinician approval and flags uncertain information instead of silently
              inventing missing data.
            </p>
          </div>

          <div className="safety-card">
            <div className="safety-row">
              <span>Medicine</span>
              <span className="status">96% CONFIDENT</span>
            </div>

            <div className="safety-row">
              <span>Dosage</span>
              <span className="status">94% CONFIDENT</span>
            </div>

            <div className="safety-row">
              <span>Diagnosis</span>
              <span className="status">91% CONFIDENT</span>
            </div>

            <div className="safety-row">
              <span>Follow-up</span>
              <span className="status caution">VERIFY</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="about">
        <div className="section-heading">
          <span className="section-label">ABOUT LEKHARX</span>
          <h2>Clinical intelligence with accountability.</h2>
          <p>
            LekhaRx is designed to bridge the gap between fragmented handwritten clinical
            information and modern interoperable digital healthcare systems.
          </p>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-content">
          <span>© 2026 LekhaRx</span>
          <span>AI-Assisted • Clinician Verified • Auditable</span>
        </div>
      </footer>
    </main>
  );
}

export default Home;
