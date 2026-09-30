import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Camera, FileText, Stethoscope, Upload, X } from 'lucide-react';
import { compareLabResult } from './services/labComparison.js';
import './App.css';

const documentTypes = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'opd', label: 'OPD visit record' },
  { value: 'case_sheet', label: 'Clinical case sheet' },
  { value: 'discharge_summary', label: 'Discharge summary' }
];

const commonMedicalTerms = ['WBC', 'RBC', 'HGB', 'HCT', 'RDW', 'PDW', 'MPV'];

const isPatientSummaryResponseValid = (response, documentId) => {
  const summary = response?.summary;
  const hasStrings = (value, fields) => value && fields.every((field) => typeof value[field] === 'string');
  const hasStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

  return response?.documentId === documentId
    && hasStrings(summary, ['reportExplanation', 'concernAssessment', 'recoveryExpectations', 'disclaimer'])
    && hasStrings(summary.patientOverview, ['patientName', 'age', 'visitDate', 'documentType', 'visitSummary'])
    && Array.isArray(summary.medicines)
    && summary.medicines.every((medicine) => (
      hasStrings(medicine, ['medicineName', 'prescribedDose', 'route', 'whenToTake', 'frequency', 'duration', 'foodInstructions', 'importantNotes'])
      && typeof medicine.needsVerification === 'boolean'
    ))
    && Array.isArray(summary.labResults)
    && summary.labResults.every((result) => (
      hasStrings(result, ['testName', 'result', 'unit', 'referenceRange', 'status', 'simpleMeaning'])
      && typeof result.needsVerification === 'boolean'
    ))
    && ['followUpInstructions', 'documentedInstructions', 'healthConcerns', 'nextSteps', 'informationGaps', 'warnings']
      .every((field) => hasStringArray(summary[field]));
};

const extractedValue = (field) => field?.originalValue?.trim() || 'Document mein clearly nahi likha hai';
const patientLabStatus = (status) => ({
  within: 'Di gayi range ke andar',
  below: 'Di gayi range se neeche',
  above: 'Di gayi range se upar',
  unavailable: 'Tulna nahi ho saki'
}[status]);

const patientLabExplanation = (status) => ({
  within: 'Yeh value report ki di hui reference range ke andar hai. Iska poora matlab doctor baaki jaankari ke saath samjhenge.',
  below: 'Yeh value report ki di hui reference range se neeche hai. Iska poora matlab doctor baaki jaankari ke saath samjhenge.',
  above: 'Yeh value report ki di hui reference range se upar hai. Iska poora matlab doctor baaki jaankari ke saath samjhenge.',
  unavailable: 'Value ya reference range ko bharosemand tareeqe se compare nahi kiya ja saka. Dono ko original report se verify karein.'
}[status]);

export default function App() {
  const [loading, setLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [extractionResult, setExtractionResult] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [summaryResult, setSummaryResult] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
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
        if (!cancelled) setMedicalTerms(commonMedicalTerms.map((term) => ({ originalTerm: term, expandedTerm: 'Jaankari available nahi hai', simpleMeaning: 'Is term ka saral matlab abhi available nahi hai.', whyDoctorsLookAtIt: 'Is term ke baare mein jaankari abhi available nahi hai.', informationAvailable: false })));
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
    setSummaryError('');
    setMedicalTerms([]);
    setMedicineInformation({});

    if (!file.type.startsWith('image/')) {
      setError('JPG, PNG ya WEBP image file chunein.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Yeh file 10 MB se badi hai. Chhoti image chunein.');
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        setError('Document ka preview nahi ban saka. Doosri image ke saath phir koshish karein.');
        return;
      }
      setPreview(reader.result);
      uploadDocument(file);
    };
    reader.onerror = () => setError('Document file padh nahi paaye. Phir koshish karein.');
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
      setError(err.response?.data?.error || 'Document upload nahi ho saka. Connection check karke phir koshish karein.');
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
      await generatePatientSummary(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Document se jaankari nikaal nahi paaye. Phir koshish karein.');
    } finally {
      setExtracting(false);
    }
  };

  const generatePatientSummary = async (currentExtraction = extractionResult) => {
    if (!uploadResult?.documentId || !currentExtraction?.extraction) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const summaryResponse = await axios.post(`${apiUrl}/api/documents/${uploadResult.documentId}/summary`, {
        documentType: uploadResult.documentType,
        extraction: currentExtraction.extraction
      });
      if (!isPatientSummaryResponseValid(summaryResponse.data, uploadResult.documentId)) {
        throw new Error('Samjhaav poora nahi mila. Dobara koshish karein ya apne doctor se document check karvaayein.');
      }
      const eligibleMedicines = currentExtraction.extraction.medicines?.filter((medicine) => (
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
          return [medicineKey, err.response?.data || { commonUse: 'Dawai ki aam jaankari abhi nahi mil saki.' }];
        }
      }));
      setMedicineInformation((current) => ({ ...current, ...Object.fromEntries(medicineEntries) }));
      setSummaryResult(summaryResponse.data);
    } catch (err) {
      setSummaryError(err.response?.data?.error || err.message || 'Aasaan bhasha mein samjhaav taiyar nahi ho saka. Phir koshish karein.');
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
          expandedTerm: 'Jaankari available nahi hai',
          simpleMeaning: 'Is dawa ka saral matlab abhi available nahi hai.',
          whyDoctorsLookAtIt: 'Is dawa ke baare mein jaankari abhi available nahi hai.',
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
      setError('Is browser mein camera nahi chal raha. Image file chunein.');
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
      setError('Camera permission nahi mili ya camera available nahi hai. Image file chunein.');
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError('Camera abhi taiyar nahi hai. Thodi der baad phir koshish karein.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Camera photo save nahi ho saki. Phir koshish karein.');
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

  const extractedMedicines = extractionResult?.extraction?.medicines || [];
  const extractedInvestigations = extractionResult?.extraction?.investigations || [];

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
                setSummaryError('');
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
                <div className="preview-heading"><span>Asli document</span><button type="button" onClick={() => { setPreview(null); setFileName(''); setUploadResult(null); setExtractionResult(null); setSummaryResult(null); setSummaryError(''); setMedicalTerms([]); setMedicineInformation({}); }} aria-label="Chuna hua document hataayein"><X size={14} /></button></div>
                <img src={preview} alt={`${fileName || 'Clinical document'} preview`} />
              </div>
            )}

            <div className="upload-actions"><button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()}>File chunein</button><button className="button button-primary" type="button" onClick={startCamera}><Camera size={16} /> Photo lein / upload karein <span>→</span></button></div>
            {cameraOpen && (
              <div className="camera-panel">
                <video ref={videoRef} autoPlay playsInline aria-label="Camera preview" />
                <div className="camera-actions"><button className="button button-secondary" type="button" onClick={stopCamera}>Band karein</button><button className="button button-primary" type="button" onClick={capturePhoto}>Photo lein</button></div>
              </div>
            )}
            {fileName && <p className="file-name">{fileName}</p>}
            {loading && (
              <p className="processing-note">Document surakshit tareeqe se upload ho raha hai...</p>
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
                  <p>Document upload ho gaya hai. Ab isse jaankari nikaal sakte hain.</p>
                </div>
                <span className="upload-status-badge">Jaankari nikaalne ke liye taiyar</span>
              </div>
              <div className="upload-details"><span>Document ID</span><strong>{uploadResult.documentId}</strong><span>Kis tarah ka document</span><strong>{documentTypes.find((type) => type.value === uploadResult.documentType)?.label}</strong></div>
              {!extractionResult && <button className="button button-primary extraction-button" type="button" onClick={extractDocument} disabled={extracting}>{extracting ? 'Document padh rahe hain...' : 'Document se jaankari nikaalein'}</button>}
              {extractionResult && (
                <>
                  {!summaryResult && <button className="button button-primary summary-button" type="button" onClick={generatePatientSummary} disabled={summaryLoading}>{summaryLoading ? 'Hinglish explanation taiyar ho rahi hai...' : 'Patient ke liye Hinglish explanation banayein'}</button>}
                  {summaryError && <div className="summary-error" role="alert"><AlertTriangle size={16} /><span>{summaryError}</span><button className="button button-secondary" type="button" onClick={generatePatientSummary} disabled={summaryLoading}>{summaryLoading ? 'Phir koshish ho rahi hai...' : 'Dobara koshish karein'}</button></div>}
                  {summaryResult && (() => {
                    const summary = summaryResult.summary;
                    return (
                      <section className="patient-summary" aria-label="Patient-friendly Hinglish explanation">
                        <div className="summary-header"><div><p className="eyebrow">AAPKI REPORT, AASAAN BHASHA MEIN</p><h3>{summary.patientOverview.patientName ? `${summary.patientOverview.patientName} ji, aapki report` : 'Aapki report'}</h3><p>Yeh samjhaav aapke document se taiyar hua hai.</p></div><span className="summary-ai-badge">AI ka samjhaav · doctor ne verify nahi kiya</span></div>
                        <div className="summary-overview"><p className="eyebrow">DOCUMENT KI JAANKARI</p><div className="summary-facts"><span>Umar: {summary.patientOverview.age || 'Document mein nahi likhi hai'}</span><span>Date: {summary.patientOverview.visitDate || 'Document mein nahi likhi hai'}</span><span>Document: {summary.patientOverview.documentType || uploadResult.documentType}</span></div><p>{summary.patientOverview.visitSummary}</p></div>
                        <section className="summary-section summary-report"><h4>Meri report mein kya likha hai?</h4><p>{summary.reportExplanation || 'Document se saaf jaankari nahi mil saki. Original document doctor ke saath dekhein.'}</p></section>
                        <section className="summary-section summary-medicines"><h4>Dawaiyan: doctor ne kya likha hai?</h4><p className="summary-source-note">Dose aur lene ki hidayat original document se padhi gayi hai. Jo baat saaf nahi thi, use assume nahi kiya.</p>
                          {extractedMedicines.length ? <div className="summary-medicine-list">{extractedMedicines.map((medicine, index) => {
                            const medicineName = medicine.name?.originalValue;
                            const medicineKey = medicineName?.toLowerCase();
                            const information = medicineKey ? medicineInformation[medicineKey] : null;
                            const canLookup = Boolean(medicineName) && medicine.name?.confidence >= 80 && !medicine.name?.needsVerification;
                            const identityVerified = information?.identityVerified === true && information?.rxcui && information.rxcui !== 'Information unavailable';
                            const doseNeedsConfirmation = !medicine.dosage?.originalValue?.trim()
                              || medicine.dosage?.needsVerification
                              || medicine.dosage?.confidence < 80;
                            const needsConfirmation = !canLookup || doseNeedsConfirmation || (information && !identityVerified);
                            return (
                              <article className="summary-medicine-card" key={`${medicineName || 'unknown'}-${index}`}>
                                <h5>{medicineName || 'Dawa ka naam clearly nahi padha gaya'}</h5>
                                <p className="summary-source-label">Doctor ki likhi hidayat · source extraction</p>
                                <div className="summary-medicine-grid">
                                  <div><span>Dose</span><p>{extractedValue(medicine.dosage)}</p></div>
                                  <div><span>Route</span><p>{extractedValue(medicine.route)}</p></div>
                                  <div><span>Kab / kitni baar</span><p>{extractedValue(medicine.frequency)}</p></div>
                                  <div><span>Kitne din</span><p>{extractedValue(medicine.duration)}</p></div>
                                  <div><span>Khaane se sambandhit hidayat</span><p>{extractedValue(medicine.foodInstructions)}</p></div>
                                  <div><span>Doosri likhi hidayat</span><p>{extractedValue(medicine.instructions)}</p></div>
                                </div>
                                {needsConfirmation && <p className="summary-warning">Dawai ka naam ya dose saaf nahi hai. Lene se pehle original prescription doctor ya pharmacist ko dikhakar pakka kar lein.</p>}
                                {information && <div className="medicine-source-info">
                                  {identityVerified ? <><p className="summary-source-label">Dawai ki aam jaankari · RxNorm pehchaan aur U.S. FDA label se</p><p><strong>Aam taur par kis kaam aati hai:</strong> {information.commonUse || 'Is source se yeh jaankari nahi mili.'}</p><p><strong>Aam taur par kaise kaam karti hai:</strong> {information.generalHowItWorks || 'Is source se yeh jaankari nahi mili.'}</p><small>Yeh aam jaankari hai; isse yeh pata nahi chalta ki doctor ne aapko yeh dawa kyun di. Dawa mein koi badlav karne se pehle doctor se baat karein.</small></> : <p>Is naam ka pakka RxNorm match nahi mila. Dawa ki pehchaan doctor ya pharmacist se confirm karein; isliye dawa ke baare mein aam jaankari nahi dikhayi ja rahi.</p>}
                                  {identityVerified && information.sourceWarnings?.length > 0 && <div className="source-warning"><strong>FDA label ki warning (source text)</strong>{information.sourceWarnings.map((warning, warningIndex) => <p key={warningIndex}>{warning}</p>)}</div>}
                                  {information.source && <small>Source: {information.source}{identityVerified ? ` · RxCUI ${information.rxcui}` : ''}</small>}
                                </div>}
                                {!information && canLookup && <button className="button button-secondary summary-lookup" type="button" onClick={() => lookupMedicineInformation(medicine)} disabled={medicineLoading[medicineKey]}>{medicineLoading[medicineKey] ? 'Dawai ka source check ho raha hai...' : 'RxNorm / FDA source check karein'}</button>}
                              </article>
                            );
                          })}</div> : <p>Document mein koi dawa saaf taur par nahi mili.</p>}
                        </section>
                        <section className="summary-section"><h4>Test aur reports ke natije</h4>{extractedInvestigations.length > 0 ? <div className="summary-lab-list">{extractedInvestigations.map((investigation, index) => {
                          const sourceTestName = investigation.name?.originalValue || '';
                          const labStatus = compareLabResult(investigation);
                          return <article className="summary-lab-card" key={`${sourceTestName || 'test'}-${index}`}><div><h5>{sourceTestName || 'Test ka naam saaf nahi mila'}</h5><span>{investigation.result?.originalValue || 'Result document mein saaf nahi mila'} {investigation.unit?.originalValue || ''}</span></div><strong className="lab-status">{patientLabStatus(labStatus)}</strong><p>Report ki reference range: {investigation.referenceRange?.originalValue || 'Document mein nahi likhi hai'}</p><p>{patientLabExplanation(labStatus)}</p>{[investigation.name, investigation.result, investigation.unit, investigation.referenceRange].some((field) => field?.needsVerification) && <strong className="summary-warning">Kuch detail saaf nahi thi. Original report se milakar doctor se confirm karein.</strong>}</article>;
                        })}</div> : <p>Extraction mein koi test result saaf taur par nahi mila. Original report mein test ho sakte hain jo AI se nahi padhe gaye.</p>}</section>
                        <section className="summary-section summary-concerns"><h4>Kya Koi Health Concern Hai?</h4><p>{summary.concernAssessment || 'Is document ki jaankari se health concern ka poora assessment nahi ho saka. Apne doctor se report par baat karein.'}</p>{summary.healthConcerns.length > 0 && <ul>{summary.healthConcerns.map((concern, index) => <li key={`${concern}-${index}`}>{concern}</li>)}</ul>}{summary.warnings.length > 0 && <div className="summary-warning-box"><strong>Document mein dhyan dene wali baat</strong><ul>{summary.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}{summary.informationGaps.length > 0 && <div className="summary-info-gap"><strong>Kin baaton ka pata nahi chal saka</strong><ul>{summary.informationGaps.map((gap, index) => <li key={`${gap}-${index}`}>{gap}</li>)}</ul></div>}<p className="urgent-care-note"><strong>Turant madad kab lein:</strong> Agar abhi saans lene mein bahut dikkat, tez seene ka dard, behoshi ya uljhan ho, ya tabiyat tezi se bigad rahi ho, to emergency seva ya paas ke hospital se turant madad lein. Yeh aam ehtiyaat hai; isse yeh nahi maana ja raha ki aapko yeh lakshan hain.</p></section>
                        <section className="summary-section"><h4>Sehat sudharne ke baare mein</h4><p>{summary.recoveryExpectations || 'Document se recovery ka andaza lagane ke liye kaafi jaankari nahi hai. Apne doctor se poochhein.'}</p></section>
                        <section className="summary-section summary-instructions"><h4>Ab aap kya dhyan rakhein?</h4>{summary.nextSteps.length > 0 ? <ul>{summary.nextSteps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ul> : <p>Document mein aage ke khaas kadam nahi likhe hain. Apne doctor se poochhein.</p>}{summary.followUpInstructions.length > 0 && <><h5>Document mein likha follow-up</h5><ul>{summary.followUpInstructions.map((instruction, index) => <li key={`${instruction}-${index}`}>{instruction}</li>)}</ul></>}{summary.documentedInstructions.length > 0 && <><h5>Doctor ki likhi hidayat</h5><ul>{summary.documentedInstructions.map((instruction, index) => <li key={`${instruction}-${index}`}>{instruction}</li>)}</ul></>}</section>
                      </section>
                    );
                  })()}
                  <section className="educational-section">
                    <div className="educational-heading"><p className="eyebrow">AAM JAANKARI</p><h4>Medical terms aur dawaiyan</h4><p>Yeh samjhaav document se padhi gayi hidayat se alag hai. Yeh diagnosis ya dawa badalne ki salah nahi hai.</p></div>
                    <div className="term-grid">
                      {medicalTerms.map((term) => (
                        <article className="term-card" key={term.originalTerm}>
                          <span>Report ka term</span><strong>{term.originalTerm}</strong>
                          <span>Poora naam</span><strong>{term.expandedTerm}</strong>
                          <span>Aasaan matlab</span><p>{term.simpleMeaning}</p>
                          <span>Doctor ise kyun dekhte hain</span><p>{term.whyDoctorsLookAtIt}</p>
                        </article>
                      ))}
                    </div>
                    {!summaryResult && extractionResult.extraction.medicines?.length > 0 && <div className="medicine-info-list"><h4>Dawai ke baare mein</h4>{extractionResult.extraction.medicines.map((medicine, index) => {
                      const medicineName = medicine.name?.originalValue;
                      const medicineKey = medicineName?.toLowerCase();
                      const canLookup = Boolean(medicineName) && medicine.name?.confidence >= 80 && !medicine.name?.needsVerification;
                      const information = medicineKey ? medicineInformation[medicineKey] : null;
                      return <article className="medicine-info-card" key={`${medicineName || 'unknown'}-${index}`}><div><span>Document se padha gaya naam</span><strong>{medicineName || 'Naam saaf nahi mila'}</strong></div>{canLookup ? <button className="button button-secondary" type="button" onClick={() => lookupMedicineInformation(medicine)} disabled={medicineLoading[medicineKey]}>{medicineLoading[medicineKey] ? 'Source check ho raha hai...' : information ? 'Source phir check karein' : 'Dawai ki jaankari dekhein'}</button> : <span className="verification-note">Pehle doctor ya pharmacist se naam pakka karein</span>}{information && <div className="medicine-explanation"><span>Naam</span><p>{information.originalTerm || 'Jaankari available nahi hai'}</p><span>Source mein mila naam</span><p>{information.expandedTerm || 'Jaankari available nahi hai'}</p><span>Aasaan matlab</span><p>{information.simpleMeaning || 'Jaankari available nahi hai'}</p><span>Doctor ise kyun dekh sakte hain</span><p>{information.whyDoctorsLookAtIt || 'Jaankari available nahi hai'}</p><small>Verified medicine source se aam jaankari. Yeh diagnosis ya dawa mein badlav ki salah nahi hai.</small></div>}</article>;
                    })}</div>}
                  </section>
                  <details className="structured-result original-extraction">
                    <summary>Original extracted jaankari (AI draft, doctor ne verify nahi ki)</summary>
                    <pre>{JSON.stringify(extractionResult.extraction, null, 2)}</pre>
                  </details>
                </>
              )}
              <p className="disclaimer">{extractionResult ? 'Clinical use se pehle original document ke saath doctor se har zaroori detail verify karvaayein.' : 'Abhi document se jaankari nahi nikali gayi hai. Original document agle kadam ke liye surakshit hai.'}</p>
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={30} />
              <strong>Document ki jaankari yahan dikhegi</strong>
              <span>Document ka type chunein aur clinical record ki image upload karein.</span>
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