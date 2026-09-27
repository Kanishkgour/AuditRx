import { useRef, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle2, FileText, Stethoscope, Upload, Volume2, X } from 'lucide-react';
import './App.css';

const documentTypes = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'opd', label: 'OPD visit record' },
  { value: 'case_sheet', label: 'Clinical case sheet' },
  { value: 'discharge_summary', label: 'Discharge summary' }
];

const textFields = [
  ['patientName', 'Patient name'],
  ['patientAge', 'Age'],
  ['patientGender', 'Gender'],
  ['patientId', 'Patient ID'],
  ['doctorOrHospital', 'Doctor / hospital'],
  ['documentDate', 'Document date'],
  ['diagnosis', 'Diagnosis'],
  ['symptoms', 'Symptoms'],
  ['followUp', 'Follow-up'],
  ['clinicalNotes', 'Clinical notes']
];

export default function App() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [documentType, setDocumentType] = useState('prescription');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    processFile(file);
  };

  const processFile = (file) => {
    if (!file) return;
    setError('');
    setData(null);

    if (!file.type.startsWith('image/')) {
      setError('Please choose a JPG, PNG, WEBP, or other image file.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('This file is larger than 10 MB. Choose a smaller document image.');
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        setError('The document could not be previewed. Please try another image.');
        return;
      }
      const base64String = reader.result.split(',')[1];
      setPreview(reader.result);
      processPrescription(base64String, file.type);
    };
    reader.onerror = () => setError('The document could not be read. Please try again.');
    reader.readAsDataURL(file);
  };

  const processPrescription = async (base64, mimeType) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('http://localhost:5000/api/scan', {
        imageBase64: base64,
        mimeType: mimeType || 'image/jpeg',
        documentType
      });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Scanning failed. Check that the backend is running and try again.');
    } finally {
      setLoading(false);
    }
  };

  const playHindiVoice = () => {
    if (!data?.hindiSummary) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(data.hindiSummary);
    utterance.lang = 'hi-IN';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    processFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="app-shell">
      <header className="navbar">
        <a className="brand" href="/">
          <span className="brand-mark"><Stethoscope size={20} /></span>
          <span>MedScript <em>AI</em></span>
        </a>
        <nav className="nav-links" aria-label="Primary navigation">
          <a className="active" href="#workspace">Workspace</a>
          <a href="#workflow">How it works</a>
          <a href="#safety">Safety</a>
        </nav>
        <div className="profile"><span className="avatar">DR</span><span>Dr. Sharma</span><span className="profile-chevron">⌄</span></div>
      </header>

      <main>
        <section id="workspace" className="workspace-hero">
          <div className="hero-copy">
            <p className="eyebrow">CLINICAL DOCUMENT INTELLIGENCE / IS-23</p>
            <h1>From handwritten care<br /><em>to trusted records.</em></h1>
            <p className="hero-description">Convert prescriptions, OPD cards, case sheets and discharge summaries into structured records with field-level confidence and clinician approval.</p>
            <div className="workflow"><span className="workflow-step current"><b>01</b> Capture</span><i>→</i><span className="workflow-step"><b>02</b> Extract</span><i>→</i><span className="workflow-step"><b>03</b> Verify</span><i>→</i><span className="workflow-step"><b>04</b> Commit</span></div>
          </div>

          <section className="upload-card" aria-label="Upload clinical document">
            <div className="card-heading"><span className="icon-box"><Upload size={21} /></span><div><p className="eyebrow">START A NEW RECORD</p><h2>New clinical document</h2></div></div>
            <label className="select-label" htmlFor="document-type">Document type</label>
            <select
              id="document-type"
              value={documentType}
              disabled={loading}
              onChange={(event) => {
                setDocumentType(event.target.value);
                setData(null);
                setError('');
              }}
            >
              {documentTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>

            <label
              className={`drop-zone${dragging ? ' dragging' : ''}`}
              htmlFor="document-file"
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <FileText className="upload-symbol" size={30} />
              <strong>Drop a document here</strong>
              <span>or choose a file from your device</span>
              <small>JPG, PNG or WEBP up to 10 MB</small>
              <input ref={fileInputRef} id="document-file" type="file" accept="image/*" onChange={handleFileUpload} />
            </label>

            {preview && (
              <div className="source-preview">
                <div className="preview-heading"><span>Source document</span><button type="button" onClick={() => { setPreview(null); setFileName(''); setData(null); }} aria-label="Remove selected document"><X size={14} /></button></div>
                <img src={preview} alt={`${fileName || 'Clinical document'} preview`} />
              </div>
            )}

            <div className="upload-actions"><button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>Choose file</button><button className="button button-primary" type="button" onClick={() => fileInputRef.current?.click()}>Capture / upload <span>→</span></button></div>
            {fileName && <p className="file-name">{fileName}</p>}
            {loading && (
              <p className="processing-note">Extracting the selected record with Gemini...</p>
            )}
            {error && <div className="error-note" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
            {!loading && !error && <p className="upload-note">Secure processing. Nothing becomes a record without review.</p>}
          </section>

        </section>

        <section className="trust-bar"><div><strong>Field-level confidence</strong><span>Every extracted field is scored</span></div><div><strong>No guessing</strong><span>Ambiguity is surfaced, never hidden</span></div><div><strong>Human approval</strong><span>Clinician remains in control</span></div><div><strong>Full audit trail</strong><span>Original records stay preserved</span></div></section>

        <section className="review-area">
          <div className="section-heading"><p className="eyebrow">STRUCTURED EXTRACTION / CLINICIAN REVIEW</p><h2>Review every field<br />before it becomes a record.</h2><p>AI drafts the structure. You make the clinical decision.</p></div>
          <div className="extraction-panel">
          {data ? (
            <div className="extraction-card">
              <div className="extraction-header">
                <div>
                  <p className="eyebrow">DRAFT EXTRACTION</p>
                  <h3>{documentTypes.find((type) => type.value === documentType)?.label}</h3>
                  <p>Verify flagged or low-confidence fields before approving this record.</p>
                </div>
                <button onClick={playHindiVoice} className="button button-secondary voice-button">
                  <Volume2 className="w-4 h-4" /> हिंदी में सुनें
                </button>
              </div>

              <div className="field-grid">
                {textFields.map(([key, label]) => {
                  const confidence = data.confidence?.[key] ?? 0;
                  const needsReview = confidence < 80;
                  return (
                    <label key={key} className={`field-card${needsReview ? ' needs-review' : ''}`}>
                      <span>
                        {label}
                        <b className={needsReview ? 'warning-text' : 'good-text'}>
                          {needsReview ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                          {confidence}%
                        </b>
                      </span>
                      <input
                        value={data[key] || ''}
                        onChange={(event) => setData({ ...data, [key]: event.target.value })}
                        aria-label={label}
                      />
                    </label>
                  );
                })}
              </div>

              {data.medicines?.length > 0 && (
                <section className="list-section">
                  <h4>Medicines</h4>
                  {data.medicines.map((medicine, index) => (
                    <div key={`${medicine.name}-${index}`} className="list-row">
                      <div>
                        <strong>{medicine.name || 'Unclear medicine name'}</strong>
                        <p>{[medicine.dosage, medicine.instructions, medicine.duration].filter(Boolean).join(' · ') || 'No further details recorded'}</p>
                      </div>
                      <span className={medicine.needsReview ? 'warning-text' : 'good-text'}>{medicine.confidence}% {medicine.needsReview ? 'Review' : 'Clear'}</span>
                    </div>
                  ))}
                </section>
              )}

              {data.tests?.length > 0 && (
                <section className="list-section">
                  <h4>Tests and results</h4>
                  {data.tests.map((test, index) => (
                    <div key={`${test.name}-${index}`} className="list-row">
                      <strong>{test.name}: {test.result || 'Result not recorded'}</strong>
                      <span className={test.needsReview ? 'warning-text' : 'good-text'}>{test.confidence}%</span>
                    </div>
                  ))}
                </section>
              )}

              <div className="summary-box">
                <span>Patient summary (Hindi)</span>
                <p>{data.hindiSummary || 'No summary was returned.'}</p>
              </div>
              <p className="disclaimer">AI-generated draft only. A clinician must verify the source and approve the record.</p>
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={30} />
              <strong>Extraction appears here</strong>
              <span>Choose a document type and upload a clinical record to create a structured draft.</span>
            </div>
          )}
          </div>
        </section>

        <section id="workflow" className="process-section"><div><p className="eyebrow">THE CLINICAL WORKFLOW</p><h2>From paper to a verified record.</h2><p>Every stage is designed around accuracy, transparency and clinician control.</p></div><div className="process-grid"><article><span>01 / CAPTURE</span><h3>Bring the source in.</h3><p>Upload a photograph or scanned image of a clinical document.</p></article><article><span>02 / EXTRACT</span><h3>Structure the signal.</h3><p>Handwritten information becomes editable clinical fields.</p></article><article><span>03 / VERIFY</span><h3>See what needs attention.</h3><p>Low-confidence fields are highlighted for review.</p></article><article><span>04 / COMMIT</span><h3>Preserve the decision.</h3><p>Approved information stays attributable and auditable.</p></article></div></section>
        <section id="safety" className="safety-section"><div><p className="eyebrow light">TRUST &amp; SAFETY</p><h2>AI that knows when<br /><em>not to guess.</em></h2><p>Medical information cannot be treated like ordinary text. MedScript AI flags uncertainty instead of silently inventing missing data.</p></div><div className="confidence-panel"><div><span>Medicine</span><b>96% confident</b></div><div><span>Dosage</span><b>94% confident</b></div><div><span>Diagnosis</span><b>91% confident</b></div><div><span>Follow-up</span><strong>Verify required</strong></div></div></section>
      </main>
      <footer className="site-footer"><span>© 2026 MedScript AI</span><span>AI-assisted / clinician verified / auditable</span></footer>
    </div>
  );
}