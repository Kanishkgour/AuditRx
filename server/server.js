import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import multer from 'multer';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const maxUploadSizeMb = Number(process.env.MAX_UPLOAD_SIZE_MB || 10);
const allowedMimeTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

fs.mkdirSync(uploadDirectory, { recursive: true });

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${allowedMimeTypes.get(file.mimetype)}`)
  }),
  limits: { fileSize: maxUploadSizeMb * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error('Only JPG, PNG, and WEBP image files are supported.'));
      return;
    }
    callback(null, true);
  }
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || primaryModel;
const rxNavApiUrl = process.env.RXNAV_API_URL || 'https://rxnav.nlm.nih.gov/REST';
const openFdaApiUrl = process.env.OPENFDA_API_URL || 'https://api.fda.gov/drug/label.json';
const medicineLookupMinConfidence = Number(process.env.MEDICINE_LOOKUP_MIN_CONFIDENCE || 80);
const externalApiTimeoutMs = Number(process.env.EXTERNAL_API_TIMEOUT_MS || 8000);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isTemporaryModelError = (error) => (
  error?.status === 503
  || error?.code === 503
  || error?.error?.status === 'UNAVAILABLE'
  || /UNAVAILABLE|high demand|temporarily/i.test(error?.message || '')
);

async function generateWithRetry(model, payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await ai.models.generateContent({ model, ...payload });
    } catch (error) {
      if (!isTemporaryModelError(error) || attempt === 2) throw error;
      await wait(1500 * (2 ** attempt));
    }
  }

  throw new Error(`Unable to generate content with ${model}`);
}

const documentTypes = {
  prescription: 'doctor prescription',
  opd: 'OPD card or outpatient visit record',
  case_sheet: 'clinical case sheet',
  discharge_summary: 'hospital discharge summary'
};

const unavailableInformation = (originalTerm) => ({
  originalTerm,
  expandedTerm: 'Information unavailable',
  simpleMeaning: 'Information unavailable',
  whyDoctorsLookAtIt: 'Information unavailable',
  informationAvailable: false
});

const unavailableMedicineInformation = (originalTerm) => ({
  ...unavailableInformation(originalTerm),
  commonUse: 'Information unavailable'
});

const medicalTermDefinitions = {
  WBC: {
    expandedTerm: 'White blood cell count',
    simpleMeaning: 'The number of white blood cells in a blood sample.',
    whyDoctorsLookAtIt: 'Doctors commonly review it as part of understanding immune-system activity and overall blood-test patterns.'
  },
  RBC: {
    expandedTerm: 'Red blood cell count',
    simpleMeaning: 'The number of red blood cells in a blood sample.',
    whyDoctorsLookAtIt: 'Doctors commonly review it along with other blood measurements when assessing oxygen-carrying cells.'
  },
  HGB: {
    expandedTerm: 'Hemoglobin',
    simpleMeaning: 'The amount of hemoglobin, the oxygen-carrying protein in red blood cells.',
    whyDoctorsLookAtIt: 'Doctors commonly review it as one part of a complete blood count and oxygen-carrying capacity assessment.'
  },
  HCT: {
    expandedTerm: 'Hematocrit',
    simpleMeaning: 'The percentage of blood volume made up of red blood cells.',
    whyDoctorsLookAtIt: 'Doctors commonly review it with other red-blood-cell measurements to understand blood composition.'
  },
  RDW: {
    expandedTerm: 'Red cell distribution width',
    simpleMeaning: 'A measure of how much red blood cell sizes vary from one another.',
    whyDoctorsLookAtIt: 'Doctors commonly review it with other red-blood-cell measurements when interpreting a complete blood count.'
  },
  PDW: {
    expandedTerm: 'Platelet distribution width',
    simpleMeaning: 'A measure of how much platelet sizes vary from one another.',
    whyDoctorsLookAtIt: 'Doctors commonly review it with other platelet measurements when interpreting a complete blood count.'
  },
  MPV: {
    expandedTerm: 'Mean platelet volume',
    simpleMeaning: 'The average size of platelets in a blood sample.',
    whyDoctorsLookAtIt: 'Doctors commonly review it with other platelet measurements as part of a complete blood count.'
  }
};

const fetchExternalJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), externalApiTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const medicineExplanationSchema = {
  type: Type.OBJECT,
  properties: {
    commonUse: { type: Type.STRING },
    simpleMeaning: { type: Type.STRING },
    whyDoctorsLookAtIt: { type: Type.STRING }
  },
  required: ['commonUse', 'simpleMeaning', 'whyDoctorsLookAtIt']
};

const explainMedicineFromSource = async (verifiedName, sourceText) => {
  if (!sourceText) return null;

  try {
    const response = await generateWithConfiguredModels({
      contents: [`Explain the medicine ${verifiedName} using only the official label text below. Return simple language suitable for a patient. commonUse must describe only general uses explicitly supported by the source, never why this patient was prescribed it. Do not give a diagnosis, dosing changes, treatment recommendations, or other medical advice. If the source does not support a statement, return "Information unavailable" for that field.\n\nOfficial label text:\n${sourceText}`],
      config: {
        responseMimeType: 'application/json',
        responseSchema: medicineExplanationSchema
      }
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error('Medicine explanation error:', error);
    return null;
  }
};

const mimeTypeByExtension = new Map([...allowedMimeTypes.entries()].map(([mimeType, extension]) => [extension, mimeType]));

const getStoredDocument = (documentId) => {
  if (!/^[a-f0-9-]{36}$/i.test(documentId)) return null;

  for (const extension of allowedMimeTypes.values()) {
    const filePath = path.join(uploadDirectory, `${documentId}${extension}`);
    if (fs.existsSync(filePath)) {
      return { filePath, mimeType: mimeTypeByExtension.get(extension) };
    }
  }

  return null;
};

app.post('/api/documents', (req, res) => {
  documentUpload.single('file')(req, res, (uploadError) => {
    if (uploadError) {
      const isSizeError = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: isSizeError
          ? `The document must be smaller than ${maxUploadSizeMb} MB.`
          : uploadError.message,
        retryable: false
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Document image is required.', retryable: false });
    }

    const documentType = req.body.documentType || 'prescription';
    if (!documentTypes[documentType]) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: 'Unsupported clinical document type.', retryable: false });
    }

    const documentId = path.parse(req.file.filename).name;
    return res.status(201).json({
      documentId,
      documentType,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date().toISOString()
    });
  });
});

const schema = {
  type: Type.OBJECT,
  properties: {
    documentType: { type: Type.STRING },
    patientName: { type: Type.STRING },
    patientAge: { type: Type.STRING },
    patientGender: { type: Type.STRING },
    patientId: { type: Type.STRING },
    doctorOrHospital: { type: Type.STRING },
    documentDate: { type: Type.STRING },
    diagnosis: { type: Type.STRING },
    symptoms: { type: Type.STRING },
    medicines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          dosage: { type: Type.STRING },
          instructions: { type: Type.STRING },
          duration: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          needsReview: { type: Type.BOOLEAN }
        },
        required: ['name', 'dosage', 'instructions', 'duration', 'confidence', 'needsReview']
      }
    },
    tests: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          result: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          needsReview: { type: Type.BOOLEAN }
        },
        required: ['name', 'result', 'confidence', 'needsReview']
      }
    },
    followUp: { type: Type.STRING },
    clinicalNotes: { type: Type.STRING },
    hindiSummary: { type: Type.STRING },
    confidence: {
      type: Type.OBJECT,
      properties: {
        patientName: { type: Type.NUMBER },
        patientAge: { type: Type.NUMBER },
        patientGender: { type: Type.NUMBER },
        patientId: { type: Type.NUMBER },
        doctorOrHospital: { type: Type.NUMBER },
        documentDate: { type: Type.NUMBER },
        diagnosis: { type: Type.NUMBER },
        symptoms: { type: Type.NUMBER },
        followUp: { type: Type.NUMBER },
        clinicalNotes: { type: Type.NUMBER }
      },
      required: ['patientName', 'patientAge', 'patientGender', 'patientId', 'doctorOrHospital', 'documentDate', 'diagnosis', 'symptoms', 'followUp', 'clinicalNotes']
    }
  },
  required: ['documentType', 'patientName', 'patientAge', 'patientGender', 'patientId', 'doctorOrHospital', 'documentDate', 'diagnosis', 'symptoms', 'medicines', 'tests', 'followUp', 'clinicalNotes', 'hindiSummary', 'confidence']
};

const extractedFieldSchema = () => ({
  type: Type.OBJECT,
  properties: {
    originalValue: { type: Type.STRING },
    simplifiedExplanation: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    needsVerification: { type: Type.BOOLEAN }
  },
  required: ['originalValue', 'simplifiedExplanation', 'confidence', 'needsVerification']
});

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    patientInformation: {
      type: Type.OBJECT,
      properties: {
        name: extractedFieldSchema(),
        age: extractedFieldSchema(),
        gender: extractedFieldSchema(),
        patientId: extractedFieldSchema(),
        doctorOrHospital: extractedFieldSchema(),
        documentDate: extractedFieldSchema()
      },
      required: ['name', 'age', 'gender', 'patientId', 'doctorOrHospital', 'documentDate']
    },
    medicines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: extractedFieldSchema(),
          dosage: extractedFieldSchema(),
          frequency: extractedFieldSchema(),
          duration: extractedFieldSchema(),
          instructions: extractedFieldSchema()
        },
        required: ['name', 'dosage', 'frequency', 'duration', 'instructions']
      }
    },
    diagnosis: { type: Type.ARRAY, items: extractedFieldSchema() },
    investigations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: extractedFieldSchema(),
          result: extractedFieldSchema(),
          unit: extractedFieldSchema(),
          referenceRange: extractedFieldSchema(),
          observationDate: extractedFieldSchema()
        },
        required: ['name', 'result', 'unit', 'referenceRange', 'observationDate']
      }
    },
    observations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: extractedFieldSchema(),
          value: extractedFieldSchema()
        },
        required: ['name', 'value']
      }
    },
    followUpInstructions: { type: Type.ARRAY, items: extractedFieldSchema() },
    ambiguities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          originalValue: { type: Type.STRING },
          reason: { type: Type.STRING },
          needsVerification: { type: Type.BOOLEAN }
        },
        required: ['field', 'originalValue', 'reason', 'needsVerification']
      }
    }
  },
  required: ['patientInformation', 'medicines', 'diagnosis', 'investigations', 'observations', 'followUpInstructions', 'ambiguities']
};

const patientSummarySchema = {
  type: Type.OBJECT,
  properties: {
    patientOverview: {
      type: Type.OBJECT,
      properties: {
        patientName: { type: Type.STRING },
        age: { type: Type.STRING },
        visitDate: { type: Type.STRING },
        documentType: { type: Type.STRING },
        visitSummary: { type: Type.STRING }
      },
      required: ['patientName', 'age', 'visitDate', 'documentType', 'visitSummary']
    },
    medicines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          medicineName: { type: Type.STRING },
          prescribedDose: { type: Type.STRING },
          whenToTake: { type: Type.STRING },
          frequency: { type: Type.STRING },
          duration: { type: Type.STRING },
          foodInstructions: { type: Type.STRING },
          importantNotes: { type: Type.STRING },
          needsVerification: { type: Type.BOOLEAN }
        },
        required: ['medicineName', 'prescribedDose', 'whenToTake', 'frequency', 'duration', 'foodInstructions', 'importantNotes', 'needsVerification']
      }
    },
    labResults: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          testName: { type: Type.STRING },
          result: { type: Type.STRING },
          unit: { type: Type.STRING },
          referenceRange: { type: Type.STRING },
          status: { type: Type.STRING },
          simpleMeaning: { type: Type.STRING },
          needsVerification: { type: Type.BOOLEAN }
        },
        required: ['testName', 'result', 'unit', 'referenceRange', 'status', 'simpleMeaning', 'needsVerification']
      }
    },
    followUpInstructions: { type: Type.ARRAY, items: { type: Type.STRING } },
    documentedInstructions: { type: Type.ARRAY, items: { type: Type.STRING } },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    disclaimer: { type: Type.STRING }
  },
  required: ['patientOverview', 'medicines', 'labResults', 'followUpInstructions', 'documentedInstructions', 'warnings', 'disclaimer']
};

const extractionInstruction = (documentType) => `
You are an OCR and clinical document transcription assistant. The source is a ${documentTypes[documentType]}.
Extract only information visibly present in the document. Never diagnose, infer, autocomplete, normalize, or guess missing clinical information.
For every extracted field, preserve the exact source wording in originalValue. Put a short plain-language explanation in simplifiedExplanation only when it can be derived directly from originalValue; otherwise use an empty string.
Use empty originalValue and simplifiedExplanation for information that is absent. Set confidence from 0 to 100 based on legibility and completeness. Set needsVerification to true when text is illegible, ambiguous, incomplete, conflicting, or confidence is below 80.
Record every uncertain reading in ambiguities with the affected field, the exact or partial originalValue, and a concise reason. Do not provide medical advice or medicine information. For investigations, extract result, unit, and reference range only when visibly present. Keep dosage, frequency, duration, diagnosis, investigations, observations, and follow-up instructions faithful to the source.
Return JSON matching the response schema exactly.
`;

const patientSummaryInstruction = (documentType, extraction) => `
Create a patient-friendly explanation of this ${documentTypes[documentType]} using only the structured extraction JSON below.
Use short, simple language for a reader without medical training. Do not diagnose, predict outcomes, recommend treatment, or suggest starting, stopping, changing, or substituting medicine.
Copy medicine names and written instructions faithfully. If dose, timing, frequency, duration, food instructions, or notes are absent or uncertain, use "Not clearly mentioned in the document" and set needsVerification to true.
Do not state why a medicine was prescribed. General medicine use is provided separately by a verified medicine-information source.
For lab results, include only values, units, and reference ranges present in the extraction. Never invent a reference range. Set status to "within supplied range", "outside supplied range", or "Not available" only when the supplied result and range support it. Never diagnose from an isolated result.
Only include follow-up and instructions explicitly documented. Use empty arrays for missing sections. Preserve uncertainty in warnings. The disclaimer must say this is a plain-language explanation of the document, not a diagnosis or medication-change instruction.
Return JSON matching the response schema exactly.

Structured extraction JSON:
${JSON.stringify(extraction)}
`;

const generateWithConfiguredModels = async (payload) => {
  try {
    return await generateWithRetry(primaryModel, payload);
  } catch (error) {
    if (fallbackModel === primaryModel) throw error;
    console.warn('Primary model unavailable, switching to fallback model...');
    return generateWithRetry(fallbackModel, payload);
  }
};

app.post('/api/documents/:documentId/extract', async (req, res) => {
  const { documentId } = req.params;
  const document = getStoredDocument(documentId);
  const documentType = req.body?.documentType || 'prescription';

  if (!document) {
    return res.status(404).json({ error: 'Stored document was not found.', retryable: false });
  }

  if (!documentTypes[documentType]) {
    return res.status(400).json({ error: 'Unsupported clinical document type.', retryable: false });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'The AI service is not configured on the server.', retryable: false });
  }

  try {
    const imageBase64 = fs.readFileSync(document.filePath).toString('base64');
    const response = await generateWithConfiguredModels({
      contents: [
        {
          inlineData: {
            mimeType: document.mimeType,
            data: imageBase64
          }
        },
        extractionInstruction(documentType)
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: extractionSchema
      }
    });

    const extraction = JSON.parse(response.text);
    return res.status(200).json({
      documentId,
      documentType,
      extractedAt: new Date().toISOString(),
      extraction
    });
  } catch (error) {
    console.error('Extraction Error:', error);
    const temporarilyUnavailable = isTemporaryModelError(error);
    return res.status(temporarilyUnavailable ? 503 : 502).json({
      error: temporarilyUnavailable
        ? 'The AI service is temporarily busy. Please try again shortly.'
        : 'The AI service returned an invalid extraction response.',
      retryable: temporarilyUnavailable
    });
  }
});

app.post('/api/documents/:documentId/summary', async (req, res) => {
  const { documentId } = req.params;
  const document = getStoredDocument(documentId);
  const documentType = req.body?.documentType || 'prescription';
  const extraction = req.body?.extraction;

  if (!document) {
    return res.status(404).json({ error: 'Stored document was not found.', retryable: false });
  }

  if (!documentTypes[documentType]) {
    return res.status(400).json({ error: 'Unsupported clinical document type.', retryable: false });
  }

  if (!extraction || typeof extraction !== 'object') {
    return res.status(400).json({ error: 'A completed structured extraction is required.', retryable: false });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'The AI service is not configured on the server.', retryable: false });
  }

  try {
    const response = await generateWithConfiguredModels({
      contents: [patientSummaryInstruction(documentType, extraction)],
      config: {
        responseMimeType: 'application/json',
        responseSchema: patientSummarySchema
      }
    });
    const summary = JSON.parse(response.text);
    return res.status(200).json({
      documentId,
      documentType,
      generatedAt: new Date().toISOString(),
      summary
    });
  } catch (error) {
    console.error('Patient summary error:', error);
    const temporarilyUnavailable = isTemporaryModelError(error);
    return res.status(temporarilyUnavailable ? 503 : 502).json({
      error: temporarilyUnavailable
        ? 'The AI service is temporarily busy. Please try again shortly.'
        : 'The patient summary could not be generated from the extracted document.',
      retryable: temporarilyUnavailable
    });
  }
});

app.get('/api/medical-terms/:term', (req, res) => {
  const originalTerm = String(req.params.term || '').trim();
  const normalizedTerm = originalTerm.toUpperCase();
  const definition = medicalTermDefinitions[normalizedTerm];

  if (!definition) {
    return res.status(200).json(unavailableInformation(originalTerm));
  }

  return res.status(200).json({
    originalTerm,
    ...definition,
    informationAvailable: true,
    source: 'MedScript verified educational glossary'
  });
});

app.post('/api/medicines/information', async (req, res) => {
  const originalTerm = typeof req.body?.medicineName === 'string' ? req.body.medicineName.trim() : '';
  const confidence = Number(req.body?.confidence);
  const needsVerification = req.body?.needsVerification === true;

  if (!originalTerm) {
    return res.status(400).json({ error: 'A medicine name is required.', retryable: false });
  }

  if (!Number.isFinite(confidence) || confidence < medicineLookupMinConfidence || needsVerification) {
    return res.status(422).json({
      ...unavailableMedicineInformation(originalTerm),
      reason: `Medicine information is available only after the extracted name reaches ${medicineLookupMinConfidence}% confidence and does not require verification.`
    });
  }

  const rxNavUrl = `${rxNavApiUrl}/drugs.json?name=${encodeURIComponent(originalTerm)}`;
  const rxNavResult = await fetchExternalJson(rxNavUrl);
  const concepts = rxNavResult?.drugGroup?.conceptGroup?.flatMap((group) => group.conceptProperties || []) || [];
  const normalizedSearchTerm = originalTerm.toLowerCase().replace(/\s+\d[\d./-]*\s*(mg|mcg|g|ml|%|iu)?\b.*$/i, '').trim();
  const matchedConcept = concepts.find((concept) => (
    concept.name?.toLowerCase().startsWith(normalizedSearchTerm) && !concept.name.includes('/')
  )) || concepts.find((concept) => !concept.name?.includes('/')) || concepts[0];

  if (!matchedConcept?.name) {
    return res.status(200).json(unavailableMedicineInformation(originalTerm));
  }

  const activeIngredient = matchedConcept.name
    .replace(/\s+\d[\d./-]*\s*(mg|mcg|g|ml|%|iu)?\b.*$/i, '')
    .replace(/\s+(oral|tablet|capsule|solution|injection|extended release|delayed release).*$/i, '')
    .trim();
  const fdaQueries = [
    `openfda.generic_name:"${activeIngredient}"`,
    `openfda.generic_name:${activeIngredient}`,
    `openfda.generic_name:${normalizedSearchTerm.split(/\s+/)[0]}`
  ];
  let fdaResult = null;
  for (const query of fdaQueries) {
    fdaResult = await fetchExternalJson(`${openFdaApiUrl}?search=${encodeURIComponent(query)}&limit=10`);
    if (fdaResult?.results?.[0]) break;
  }
  const labels = fdaResult?.results || [];
  const label = labels.find((candidate) => candidate.openfda?.generic_name?.some((name) => name.toLowerCase().includes(activeIngredient.toLowerCase()))
    && (candidate.indications_and_usage?.length || candidate.purpose?.length))
    || labels.find((candidate) => candidate.indications_and_usage?.length || candidate.purpose?.length);
  const sourceText = ['purpose', 'indications_and_usage', 'warnings']
    .flatMap((field) => label?.[field] || [])
    .filter(Boolean)
    .slice(0, 3)
    .join('\n\n');
  const explanation = await explainMedicineFromSource(matchedConcept.name, sourceText);

  if (!explanation) {
    return res.status(200).json({
      ...unavailableMedicineInformation(originalTerm),
      expandedTerm: matchedConcept.name,
      source: 'RxNorm and U.S. FDA labeling lookup',
      rxcui: matchedConcept.rxcui || 'Information unavailable'
    });
  }

  return res.status(200).json({
    originalTerm,
    expandedTerm: matchedConcept.name,
    commonUse: explanation.commonUse || 'Information unavailable',
    simpleMeaning: explanation.simpleMeaning || 'Information unavailable',
    whyDoctorsLookAtIt: explanation.whyDoctorsLookAtIt || 'Information unavailable',
    informationAvailable: explanation.simpleMeaning !== 'Information unavailable' || explanation.whyDoctorsLookAtIt !== 'Information unavailable',
    source: 'RxNorm and U.S. FDA labeling lookup',
    rxcui: matchedConcept.rxcui || 'Information unavailable'
  });
});

app.post('/api/scan', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', documentType = 'prescription' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Prescription image missing' });
    }

    if (!documentTypes[documentType]) {
      return res.status(400).json({ error: 'Unsupported clinical document type' });
    }

    const payload = {
      contents: [
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBase64
          }
        },
        `This is a ${documentTypes[documentType]}. Digitize it for the IS-23 clinical record digitization workflow. Extract only information visibly present in the source. Do not diagnose, infer missing values, or add medical advice. Return empty strings for absent text and empty arrays when no medicines or tests are present. Set confidence values from 0 to 100 based on legibility and completeness; set needsReview true below 80 or whenever uncertain. Keep clinicalNotes faithful to the source. Write hindiSummary only from explicitly extracted instructions and mention that unclear details need clinician verification.`
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    };

    let response;
    try {
      response = await generateWithRetry(primaryModel, payload);
    } catch (err) {
      if (fallbackModel === primaryModel) throw err;
      console.warn('Primary model unavailable, switching to fallback model...');
      response = await generateWithRetry(fallbackModel, payload);
    }

    const parsedResult = JSON.parse(response.text);
    return res.status(200).json(parsedResult);
  } catch (error) {
    console.error('Scan Error:', error);
    const temporarilyUnavailable = isTemporaryModelError(error);
    return res.status(temporarilyUnavailable ? 503 : 500).json({
      error: temporarilyUnavailable
        ? 'The AI service is temporarily busy. Please try again shortly.'
        : error.message,
      retryable: temporarilyUnavailable
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`MedScript server running on http://localhost:${PORT}`);
});