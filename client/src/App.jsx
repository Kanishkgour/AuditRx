import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Camera, FileText, Stethoscope, Upload, X } from 'lucide-react';
import './App.css';

const documentTypes = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'opd', label: 'OPD visit record' },
  { value: 'case_sheet', label: 'Clinical case sheet' },
  { value: 'discharge_summary', label: 'Discharge summary' }
];

const commonMedicalTerms = ['WBC', 'RBC', 'HGB', 'HCT', 'RDW', 'PDW', 'MPV'];

export default function App() {
  const [loading, setLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [extractionResult, setExtractionResult] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [summaryResult, setSummaryResult] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [medicalTerms, setMedicalTerms] = useState([]);
  const [medicineInformation, setMedicineInformation] = useState({});
  const [medicineLoading, setMedicineLoading] = useState({});
  const [preview, setPreview] = useState(null);
  const [documentType, setDocumentType] = useState('prescription');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!extractionResult) {
      setMedicalTerms([]);
      return undefined;
    }

    let cancelled = false;
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    Promise.all(commonMedicalTerms.map((term) => axios.get(`${apiUrl}/api/medical-terms/${term}`)))
      .then((responses) => {
        if (!cancelled) setMedicalTerms(responses.map((response) => response.data));
      })
      .catch(() => {
        if (!cancelled) setMedicalTerms(commonMedicalTerms.map((term) => ({ originalTerm: term, expandedTerm: 'Information unavailable', simpleMeaning: 'Information unavailable', whyDoctorsLookAtIt: 'Information unavailable', informationAvailable: false })));
      });

    return () => { cancelled = true; };
  }, [extractionResult]);

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    processFile(file);
  };

  const processFile = (file) => {
    if (!file) return;
    setError('');
    setUploadResult(null);
    setExtractionResult(null);
    setSummaryResult(null);
    setMedicalTerms([]);
    setMedicineInformation({});

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
      setPreview(reader.result);
      uploadDocument(file);
    };
    reader.onerror = () => setError('The document could not be read. Please try again.');
    reader.readAsDataURL(file);
  };

  const uploadDocument = async (file) => {
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', documentType);
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const res = await axios.post(`${apiUrl}/api/documents`, formData);
      setUploadResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed. Check that the backend is running and try again.');
    } finally {
      setLoading(false);
    }
  };

  const extractDocument = async () => {
    if (!uploadResult?.documentId) return;
    setExtracting(true);
    setError('');
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const res = await axios.post(`${apiUrl}/api/documents/${uploadResult.documentId}/extract`, {
        documentType: uploadResult.documentType
      });
      setExtractionResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'AI extraction failed. Please try again.');
    } finally {
      setExtracting(false);
    }
  };

  const generatePatientSummary = async () => {
    if (!uploadResult?.documentId || !extractionResult?.extraction) return;
    setSummaryLoading(true);
    setError('');
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const summaryResponse = await axios.post(`${apiUrl}/api/documents/${uploadResult.documentId}/summary`, {
        documentType: uploadResult.documentType,
        extraction: extractionResult.extraction
      });
      const eligibleMedicines = extractionResult.extraction.medicines?.filter((medicine) => (
        medicine.name?.originalValue && medicine.name.confidence >= 80 && !medicine.name.needsVerification
      )) || [];
      const medicineEntries = await Promise.all(eligibleMedicines.map(async (medicine) => {
        const medicineName = medicine.name.originalValue;
        const medicineKey = medicineName.toLowerCase();
        try {
          const response = await axios.post(`${apiUrl}/api/medicines/information`, {
            medicineName,
            confidence: medicine.name.confidence,
            needsVerification: medicine.name.needsVerification
          });
          return [medicineKey, response.data];
        } catch (err) {
          return [medicineKey, err.response?.data || { commonUse: 'Information unavailable' }];
        }
      }));
      setMedicineInformation((current) => ({ ...current, ...Object.fromEntries(medicineEntries) }));
      setSummaryResult(summaryResponse.data);
    } catch (err) {
      setError(err.response?.data?.error || 'The patient-friendly summary could not be generated. Please try again.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const lookupMedicineInformation = async (medicine) => {
    const medicineName = medicine.name?.originalValue;
    if (!medicineName) return;

    const medicineKey = medicineName.toLowerCase();
    setMedicineLoading((current) => ({ ...current, [medicineKey]: true }));
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const res = await axios.post(`${apiUrl}/api/medicines/information`, {
        medicineName,
        confidence: medicine.name?.confidence,
        needsVerification: medicine.name?.needsVerification
      });
      setMedicineInformation((current) => ({ ...current, [medicineKey]: res.data }));
    } catch (err) {
      setMedicineInformation((current) => ({
        ...current,
        [medicineKey]: err.response?.data || {
          originalTerm: medicineName,
          expandedTerm: 'Information unavailable',
          simpleMeaning: 'Information unavailable',
          whyDoctorsLookAtIt: 'Information unavailable',
          informationAvailable: false
        }
      }));
    } finally {
      setMedicineLoading((current) => ({ ...current, [medicineKey]: false }));
    }
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera capture is not available in this browser. Choose an image file instead.');
      return;
    }

    try {
      setError('');
      cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = cameraStreamRef.current;
      });
    } catch {
      setError('Camera permission was denied or the camera is unavailable. Choose an image file instead.');
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError('The camera is not ready yet. Please try again.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('The camera image could not be created. Please try again.');
        return;
      }
      stopCamera();
      processFile(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
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
                setUploadResult(null);
                setExtractionResult(null);
                setSummaryResult(null);
                setMedicalTerms([]);
                setMedicineInformation({});
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
                <div className="preview-heading"><span>Source document</span><button type="button" onClick={() => { setPreview(null); setFileName(''); setUploadResult(null); setExtractionResult(null); setSummaryResult(null); setMedicalTerms([]); setMedicineInformation({}); }} aria-label="Remove selected document"><X size={14} /></button></div>
                <img src={preview} alt={`${fileName || 'Clinical document'} preview`} />
              </div>
            )}

            <div className="upload-actions"><button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>Choose file</button><button className="button button-primary" type="button" onClick={startCamera}><Camera size={16} /> Capture / upload <span>→</span></button></div>
            {cameraOpen && (
              <div className="camera-panel">
                <video ref={videoRef} autoPlay playsInline aria-label="Camera preview" />
                <div className="camera-actions"><button className="button button-secondary" type="button" onClick={stopCamera}>Cancel</button><button className="button button-primary" type="button" onClick={capturePhoto}>Take photo</button></div>
              </div>
            )}
            {fileName && <p className="file-name">{fileName}</p>}
            {loading && (
              <p className="processing-note">Uploading the document securely...</p>
            )}
            {error && <div className="error-note" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
            {!loading && !error && <p className="upload-note">Secure processing. Nothing becomes a record without review.</p>}
          </section>

        </section>

        <section className="trust-bar"><div><strong>Field-level confidence</strong><span>Every extracted field is scored</span></div><div><strong>No guessing</strong><span>Ambiguity is surfaced, never hidden</span></div><div><strong>Human approval</strong><span>Clinician remains in control</span></div><div><strong>Full audit trail</strong><span>Original records stay preserved</span></div></section>

        <section className="review-area">
          <div className="section-heading"><p className="eyebrow">STRUCTURED EXTRACTION / CLINICIAN REVIEW</p><h2>Review every field<br />before it becomes a record.</h2><p>AI drafts the structure. You make the clinical decision.</p></div>
          <div className="extraction-panel">
          {uploadResult ? (
            <div className="extraction-card">
              <div className="extraction-header">
                <div>
                  <p className="eyebrow">DOCUMENT UPLOADED</p>
                  <h3>{uploadResult.originalName}</h3>
                  <p>The source is stored and ready for the clinical extraction step.</p>
                </div>
                <span className="upload-status-badge">Ready for extraction</span>
              </div>
              <div className="upload-details"><span>Document ID</span><strong>{uploadResult.documentId}</strong><span>Type</span><strong>{documentTypes.find((type) => type.value === uploadResult.documentType)?.label}</strong></div>
              {!extractionResult && <button className="button button-primary extraction-button" type="button" onClick={extractDocument} disabled={extracting}>{extracting ? 'Extracting securely...' : 'Extract with AI'}</button>}
              {extractionResult && (
                <>
                  <div className="structured-result"><p className="eyebrow">AI-EXTRACTED PRESCRIPTION INFORMATION</p><pre>{JSON.stringify(extractionResult.extraction, null, 2)}</pre></div>
                  <section className="educational-section">
                    <div className="educational-heading"><p className="eyebrow">GENERAL EDUCATIONAL INFORMATION</p><h4>Terms and medicines</h4><p>This information is separate from the extracted prescription and is not a diagnosis or treatment instruction.</p></div>
                    <div className="term-grid">
                      {medicalTerms.map((term) => (
                        <article className="term-card" key={term.originalTerm}>
                          <span>Original term</span><strong>{term.originalTerm}</strong>
                          <span>Expanded term</span><strong>{term.expandedTerm}</strong>
                          <span>Simple meaning</span><p>{term.simpleMeaning}</p>
                          <span>Why doctors commonly look at it</span><p>{term.whyDoctorsLookAtIt}</p>
                        </article>
                      ))}
                    </div>
                    {extractionResult.extraction.medicines?.length > 0 && <div className="medicine-info-list"><h4>Medicine information</h4>{extractionResult.extraction.medicines.map((medicine, index) => {
                      const medicineName = medicine.name?.originalValue;
                      const medicineKey = medicineName?.toLowerCase();
                      const canLookup = Boolean(medicineName) && medicine.name?.confidence >= 80 && !medicine.name?.needsVerification;
                      const information = medicineKey ? medicineInformation[medicineKey] : null;
                      return <article className="medicine-info-card" key={`${medicineName || 'unknown'}-${index}`}><div><span>AI-extracted medicine</span><strong>{medicineName || 'Information unavailable'}</strong></div>{canLookup ? <button className="button button-secondary" type="button" onClick={() => lookupMedicineInformation(medicine)} disabled={medicineLoading[medicineKey]}>{medicineLoading[medicineKey] ? 'Checking source...' : information ? 'Refresh source' : 'Explain medicine'}</button> : <span className="verification-note">Verify medicine name before lookup</span>}{information && <div className="medicine-explanation"><span>Original term</span><p>{information.originalTerm || 'Information unavailable'}</p><span>Expanded term</span><p>{information.expandedTerm || 'Information unavailable'}</p><span>Simple meaning</span><p>{information.simpleMeaning || 'Information unavailable'}</p><span>Why doctors commonly look at it</span><p>{information.whyDoctorsLookAtIt || 'Information unavailable'}</p><small>General education from a verified medicine-information source. It is not a diagnosis or medication-change instruction.</small></div>}</article>;
                    })}</div>}
                  </section>
                  {!summaryResult && <button className="button button-primary summary-button" type="button" onClick={generatePatientSummary} disabled={summaryLoading}>{summaryLoading ? 'Preparing patient summary...' : 'Generate patient-friendly summary'}</button>}
                  {summaryResult && (
                    <section className="patient-summary" aria-label="Patient-friendly medical summary">
                      <div className="summary-header"><div><p className="eyebrow">PATIENT-FRIENDLY SUMMARY</p><h3>Understanding this document</h3><p>Plain-language information based only on the extracted document.</p></div><span className="upload-status-badge">Educational view</span></div>
                      <div className="summary-overview"><p className="eyebrow">PATIENT OVERVIEW</p><h4>{summaryResult.summary.patientOverview.patientName || 'Patient name not clearly mentioned'}</h4><div><span>Age: {summaryResult.summary.patientOverview.age || 'Not clearly mentioned in the document'}</span><span>Visit date: {summaryResult.summary.patientOverview.visitDate || 'Not clearly mentioned in the document'}</span><span>Document: {summaryResult.summary.patientOverview.documentType || 'Not clearly mentioned in the document'}</span></div><p>{summaryResult.summary.patientOverview.visitSummary}</p></div>
                      {summaryResult.summary.medicines?.length > 0 && <div className="summary-section"><p className="eyebrow">MEDICINE INFORMATION CHART</p><div className="summary-medicine-list">{summaryResult.summary.medicines.map((medicine, index) => { const information = medicineInformation[medicine.medicineName?.toLowerCase()]; return <article className="summary-medicine-card" key={`${medicine.medicineName}-${index}`}><h4>{medicine.medicineName || 'Information unavailable'}</h4><div className="summary-medicine-grid"><div><span>Common use</span><p>{information?.commonUse || 'Information unavailable'}</p></div><div><span>Prescribed dose</span><p>{medicine.prescribedDose}</p></div><div><span>When to take</span><p>{medicine.whenToTake}</p></div><div><span>Frequency</span><p>{medicine.frequency}</p></div><div><span>Duration</span><p>{medicine.duration}</p></div><div><span>Food instructions</span><p>{medicine.foodInstructions}</p></div><div><span>Important notes</span><p>{medicine.importantNotes}</p></div></div>{medicine.needsVerification && <strong className="summary-warning">Needs verification against the original document.</strong>}</article>; })}</div></div>}
                      {summaryResult.summary.labResults?.length > 0 && <div className="summary-section"><p className="eyebrow">LABORATORY RESULTS</p><div className="summary-lab-list">{summaryResult.summary.labResults.map((result, index) => <article className="summary-lab-card" key={`${result.testName}-${index}`}><div><h4>{result.testName || 'Information unavailable'}</h4><span>{result.result || 'Information unavailable'} {result.unit || ''}</span></div><strong className="lab-status">{result.status || 'Not available'}</strong><p>Reference range: {result.referenceRange || 'Not provided in the document'}</p><p>{result.simpleMeaning || 'Information unavailable'}</p>{result.needsVerification && <strong className="summary-warning">Needs verification against the original document.</strong>}</article>)}</div></div>}
                      {(summaryResult.summary.followUpInstructions?.length > 0 || summaryResult.summary.documentedInstructions?.length > 0) && <div className="summary-section summary-instructions"><p className="eyebrow">FOLLOW-UP AND DOCTOR'S INSTRUCTIONS</p>{summaryResult.summary.followUpInstructions?.length > 0 && <div><h4>Follow-up</h4><ul>{summaryResult.summary.followUpInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ul></div>}{summaryResult.summary.documentedInstructions?.length > 0 && <div><h4>Instructions documented in the source</h4><ul>{summaryResult.summary.documentedInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ul></div>}</div>}
                      {summaryResult.summary.warnings?.length > 0 && <div className="summary-warning-box"><p className="eyebrow">VERIFY BEFORE RELYING ON THIS SUMMARY</p><ul>{summaryResult.summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
                      <p className="summary-disclaimer">{summaryResult.summary.disclaimer}</p>
                    </section>
                  )}
                </>
              )}
              <p className="disclaimer">{extractionResult ? 'AI-generated draft only. Verify every field against the original source before clinical use.' : 'AI extraction has not started. The original source is preserved for the next workflow step.'}</p>
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