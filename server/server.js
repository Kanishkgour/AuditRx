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
      callback(new Error('Sirf JPG, PNG, ya WEBP image file use karein.'));
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
const getGeminiErrorDetails = (error) => {
  const status = Number(error?.statusCode ?? error?.status);
  const httpStatus = Number.isInteger(status) && status > 0 ? status : null;
  const apiStatus = String(error?.error?.status ?? error?.statusText ?? '');
  const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();
  const signal = `${apiStatus} ${error?.message || ''}`.toUpperCase();
  let category = 'api_error';

  if (httpStatus === 401 || httpStatus === 403 || /UNAUTHENTICATED|PERMISSION_DENIED/.test(signal)) {
    category = 'authentication_or_permission';
  } else if (httpStatus === 404 || /MODEL_NOT_FOUND|NOT_FOUND/.test(signal)) {
    category = 'invalid_model_or_not_found';
  } else if (httpStatus === 429 || /RESOURCE_EXHAUSTED|QUOTA/.test(signal)) {
    category = 'quota_or_rate_limit';
  } else if (/ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|FETCH|NETWORK/.test(code)) {
    category = 'network';
  } else if ((httpStatus !== null && httpStatus >= 500) || /UNAVAILABLE|INTERNAL/.test(signal)) {
    category = 'api_availability';
  }

  let message = String(error?.message || 'No diagnostic message available.');
  if (process.env.GEMINI_API_KEY) message = message.split(process.env.GEMINI_API_KEY).join('[REDACTED]');
  message = message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 500);

  return { category, httpStatus, apiStatus: apiStatus || null, message };
};

const logGeminiError = (event, error, details = {}) => {
  console.error(JSON.stringify({ event, ...details, ...getGeminiErrorDetails(error) }));
};

const isTemporaryModelError = (error) => (
  error?.status === 503
  || error?.code === 503
  || error?.error?.status === 'UNAVAILABLE'
  || /UNAVAILABLE|high demand|temporarily/i.test(error?.message || '')
);

async function generateWithRetry(model, payload, operation = 'generation') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await ai.models.generateContent({ model, ...payload });
    } catch (error) {
      const willRetry = isTemporaryModelError(error) && attempt < 2;
      logGeminiError('gemini_request_failed', error, {
        operation,
        model,
        attempt: attempt + 1,
        willRetry
      });
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
  expandedTerm: 'Is term ki jaankari available nahi hai',
  simpleMeaning: 'Is term ka saral matlab yahan available nahi hai.',
  whyDoctorsLookAtIt: 'Is term ke baare mein jaankari yahan available nahi hai.',
  informationAvailable: false
});

const unavailableMedicineInformation = (originalTerm) => ({
  ...unavailableInformation(originalTerm),
  commonUse: 'Is dawa ki aam jaankari source se nahi mil saki.'
});

const unavailableMedicineExplanation = 'Is source se yeh jaankari nahi mili.';

const medicalTermDefinitions = {
  WBC: {
    expandedTerm: 'White blood cell count',
    simpleMeaning: 'Yeh khoon mein white blood cells ki ginti batata hai. Ye cells body ko infection se ladne mein madad karte hain.',
    whyDoctorsLookAtIt: 'Doctor ise doosre blood test results ke saath dekhte hain. Sirf WBC se kisi bimari ka pata nahi chalta.'
  },
  RBC: {
    expandedTerm: 'Red blood cell count',
    simpleMeaning: 'Yeh khoon mein red blood cells ki ginti batata hai. Ye cells body mein oxygen le jaate hain.',
    whyDoctorsLookAtIt: 'Doctor ise hemoglobin aur doosre blood results ke saath samajhte hain; akela RBC poori sehat nahi batata.'
  },
  HGB: {
    expandedTerm: 'Hemoglobin',
    simpleMeaning: 'Hemoglobin red blood cells ka protein hai jo body mein oxygen pahunchata hai. Yeh test khoon mein uski matra batata hai.',
    whyDoctorsLookAtIt: 'Doctor ise CBC ke doosre results aur aapki sthiti ke saath dekhte hain; sirf is number se diagnosis nahi hota.'
  },
  HCT: {
    expandedTerm: 'Hematocrit',
    simpleMeaning: 'Yeh batata hai ki khoon ke total volume ka kitna hissa red blood cells se bana hai.',
    whyDoctorsLookAtIt: 'Doctor ise RBC aur hemoglobin jaise results ke saath samajhte hain; iska matlab baaki results par bhi depend karta hai.'
  },
  RDW: {
    expandedTerm: 'Red cell distribution width',
    simpleMeaning: 'Yeh red blood cells ke size mein kitna farq hai, uska ek measure hai.',
    whyDoctorsLookAtIt: 'Doctor ise CBC aur doosre blood results ke saath dekhte hain. Isse akela kisi condition ka pata nahi chalta.'
  },
  PDW: {
    expandedTerm: 'Platelet distribution width',
    simpleMeaning: 'Yeh platelets ke size mein kitna farq hai, uska ek measure hai. Platelets khoon jamne mein madad karte hain.',
    whyDoctorsLookAtIt: 'Doctor ise platelet count aur doosre CBC results ke saath samajhte hain; akela PDW diagnosis nahi hota.'
  },
  MPV: {
    expandedTerm: 'Mean platelet volume',
    simpleMeaning: 'Yeh blood sample mein platelets ka average size batata hai. Platelets khoon jamne mein madad karte hain.',
    whyDoctorsLookAtIt: 'Doctor ise platelet count aur baaki results ke saath dekhte hain; sirf MPV se sehat ka faisla nahi hota.'
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
    generalHowItWorks: { type: Type.STRING },
    simpleMeaning: { type: Type.STRING },
    whyDoctorsLookAtIt: { type: Type.STRING }
  },
  required: ['commonUse', 'generalHowItWorks', 'simpleMeaning', 'whyDoctorsLookAtIt']
};

const explainMedicineFromSource = async (verifiedName, sourceText) => {
  if (!sourceText) return null;

  try {
    const response = await generateWithConfiguredModels({
      contents: [`Explain the medicine ${verifiedName} using only the official U.S. FDA label text below. Write natural, short, simple Hinglish in Roman script, using conversational Hindi sentence structure. commonUse must describe only general uses explicitly supported by the source, never why this patient was prescribed it. generalHowItWorks must describe a mechanism only if the label explicitly supports it. Do not provide this patient's diagnosis, dosing changes, treatment recommendations, or other medical advice. If the source does not support a statement, return "${unavailableMedicineExplanation}" for that field.\n\nOfficial label text:\n${sourceText}`],
      config: {
        responseMimeType: 'application/json',
        responseSchema: medicineExplanationSchema
      }
    });
    return JSON.parse(response.text);
  } catch (error) {
    logGeminiError('medicine_explanation_failed', error, { operation: 'medicine_explanation' });
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
          ? `Document ${maxUploadSizeMb} MB se chhota hona chahiye.`
          : uploadError.message,
        retryable: false
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Document ki image chunein.', retryable: false });
    }

    const documentType = req.body.documentType || 'prescription';
    if (!documentTypes[documentType]) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: 'Yeh document type supported nahi hai.', retryable: false });
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
          route: extractedFieldSchema(),
          foodInstructions: extractedFieldSchema(),
          instructions: extractedFieldSchema()
        },
        required: ['name', 'dosage', 'frequency', 'duration', 'route', 'foodInstructions', 'instructions']
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
    reportExplanation: { type: Type.STRING },
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
          route: { type: Type.STRING },
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
    healthConcerns: { type: Type.ARRAY, items: { type: Type.STRING } },
    concernAssessment: { type: Type.STRING },
    recoveryExpectations: { type: Type.STRING },
    nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
    informationGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    disclaimer: { type: Type.STRING }
  },
  required: ['reportExplanation', 'patientOverview', 'medicines', 'labResults', 'followUpInstructions', 'documentedInstructions', 'healthConcerns', 'concernAssessment', 'recoveryExpectations', 'nextSteps', 'informationGaps', 'warnings', 'disclaimer']
};

const extractionInstruction = (documentType) => `
You are an OCR and clinical document transcription assistant. The source is a ${documentTypes[documentType]}.
Extract only information visibly present in the document. Never diagnose, infer, autocomplete, normalize, or guess missing clinical information.
For every extracted field, preserve the exact source wording in originalValue. Put a short plain-language explanation in simplifiedExplanation only when it can be derived directly from originalValue; otherwise use an empty string.
Use empty originalValue and simplifiedExplanation for information that is absent. Set confidence from 0 to 100 based on legibility and completeness. Set needsVerification to true when text is illegible, ambiguous, incomplete, conflicting, or confidence is below 80.
Record every uncertain reading in ambiguities with the affected field, the exact or partial originalValue, and a concise reason. Do not provide medical advice or medicine information. For investigations, extract result, unit, and reference range only when visibly present. Keep dosage, frequency, duration, diagnosis, investigations, observations, and follow-up instructions faithful to the source.
For every medicine, extract route and food instructions into their own fields only when explicitly written. Do not infer them from the medicine name or standard practice.
Return JSON matching the response schema exactly.
`;

const patientSummaryInstruction = (documentType, extraction) => `
Create a personalized, patient-friendly explanation of this ${documentTypes[documentType]} using the structured extraction JSON below. Write natural, respectful Hinglish in Roman script, using conversational Hindi sentence structure and familiar English medical terms only where useful. Keep sentences short, warm, and easy to understand. Avoid literal translations, formal/bureaucratic wording, jargon without a brief explanation, and English-only paragraphs. Address the patient respectfully; use their name only if clearly present. Avoid repeating the same disclaimer in different fields.
Explain what the document says, relevant concerns supported by the document, realistic recovery expectations, and practical next steps. Adapt to whether this is a prescription, OPD record, case sheet, or discharge summary.
Do not diagnose, infer new symptoms, predict outcomes, guarantee recovery, invent a recovery timeline, recommend treatment, or suggest starting, stopping, changing, or substituting medicine. Do not declare the whole report safe or unsafe.
Copy medicine names and written instructions faithfully. For prescriptions, preserve the source wording separately for dose, route, timing/frequency, duration, and food instructions. If any are absent or uncertain, use "Document mein clearly nahi likha hai" and set needsVerification to true. If a medicine name or dose is uncertain, explicitly tell the patient to confirm it with their doctor or pharmacist; do not fill in the missing instruction.
Do not state why a medicine was prescribed. Do not explain general medicine use or mechanism here; those must come only from the separately verified RxNorm identity and U.S. FDA label lookup.
For lab results, copy the extracted test name, value, unit, and supplied reference range accurately; never invent, convert, round, or omit them. In simpleMeaning, briefly explain in Hinglish what the test generally measures and, when the extraction supports it, whether the value is inside or outside the document's supplied reference range. Do not call an outside-range value dangerous or diagnose from a result. If the range/value is absent or uncertain, say comparison or clinical meaning cannot be assessed from the available information and suggest discussing it with the doctor. Set status to "within supplied range", "outside supplied range", or "Not available" only when the supplied result and range support it.
healthConcerns may include only findings, symptoms, or comparison with a supplied lab range supported by the extraction; never infer an emergency or clinical risk from missing data. Explain calmly that a report alone may not establish the exact meaning or overall health. If there is not enough information, say so in concernAssessment and informationGaps. Never call the whole report safe or unsafe.
recoveryExpectations must use only an expectation/timeline explicitly documented; otherwise say in simple Hinglish that the document does not give enough information to estimate recovery and suggest asking the treating doctor. Never promise recovery or invent a timeline.
Only include follow-up and next steps explicitly documented or requests to verify unclear source text. Use empty arrays for missing sections. Preserve uncertainty in warnings. Keep the disclaimer brief: this is an AI-generated explanation and has not been verified by a clinician; do not repeat the same caution in every section.
Return JSON matching the response schema exactly.

Structured extraction JSON:
${JSON.stringify(extraction)}
`;

const hasStringFields = (value, fields) => (
  value && typeof value === 'object' && fields.every((field) => typeof value[field] === 'string')
);
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isPatientSummaryValid = (summary) => (
  hasStringFields(summary, ['reportExplanation', 'concernAssessment', 'recoveryExpectations', 'disclaimer'])
  && hasStringFields(summary.patientOverview, ['patientName', 'age', 'visitDate', 'documentType', 'visitSummary'])
  && Array.isArray(summary.medicines)
  && summary.medicines.every((medicine) => (
    hasStringFields(medicine, ['medicineName', 'prescribedDose', 'route', 'whenToTake', 'frequency', 'duration', 'foodInstructions', 'importantNotes'])
    && typeof medicine.needsVerification === 'boolean'
  ))
  && Array.isArray(summary.labResults)
  && summary.labResults.every((result) => (
    hasStringFields(result, ['testName', 'result', 'unit', 'referenceRange', 'status', 'simpleMeaning'])
    && typeof result.needsVerification === 'boolean'
  ))
  && ['followUpInstructions', 'documentedInstructions', 'healthConcerns', 'nextSteps', 'informationGaps', 'warnings']
    .every((field) => isStringArray(summary[field]))
);

const generateWithConfiguredModels = async (payload, operation = 'generation') => {
  try {
    return await generateWithRetry(primaryModel, payload, operation);
  } catch (error) {
    if (fallbackModel === primaryModel) throw error;
    console.warn(JSON.stringify({
      event: 'gemini_model_fallback',
      primaryModel,
      fallbackModel,
      operation,
      ...getGeminiErrorDetails(error)
    }));
    return generateWithRetry(fallbackModel, payload, operation);
  }
};

app.post('/api/documents/:documentId/extract', async (req, res) => {
  const { documentId } = req.params;
  const document = getStoredDocument(documentId);
  const documentType = req.body?.documentType || 'prescription';

  if (!document) {
    return res.status(404).json({ error: 'Uploaded document nahi mila. Dobara upload karke koshish karein.', retryable: false });
  }

  if (!documentTypes[documentType]) {
    return res.status(400).json({ error: 'Yeh document type supported nahi hai.', retryable: false });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI seva abhi taiyar nahi hai. Baad mein phir koshish karein.', retryable: false });
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
    }, 'extraction');

    const extraction = JSON.parse(response.text);
    return res.status(200).json({
      documentId,
      documentType,
      extractedAt: new Date().toISOString(),
      extraction
    });
  } catch (error) {
    logGeminiError('extraction_failed', error, { operation: 'extraction' });
    const temporarilyUnavailable = isTemporaryModelError(error);
    return res.status(temporarilyUnavailable ? 503 : 502).json({
      error: temporarilyUnavailable
        ? 'Jaankari nikaalne wali seva abhi vyast hai. Thodi der baad phir koshish karein.'
        : 'Document se jaankari sahi tarah nahi nikal saki. Phir koshish karein.',
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
    return res.status(404).json({ error: 'Uploaded document nahi mila. Dobara upload karke koshish karein.', retryable: false });
  }

  if (!documentTypes[documentType]) {
    return res.status(400).json({ error: 'Yeh document type supported nahi hai.', retryable: false });
  }

  if (!extraction || typeof extraction !== 'object') {
    return res.status(400).json({ error: 'Pehle document se jaankari nikaalna zaroori hai.', retryable: false });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'AI seva abhi taiyar nahi hai. Baad mein phir koshish karein.', retryable: false });
  }

  try {
    const response = await generateWithConfiguredModels({
      contents: [patientSummaryInstruction(documentType, extraction)],
      config: {
        responseMimeType: 'application/json',
        responseSchema: patientSummarySchema
      }
    }, 'patient_summary');
    const summary = JSON.parse(response.text);
    if (!isPatientSummaryValid(summary)) {
      throw new Error('The generated patient summary did not match the required response structure.');
    }
    return res.status(200).json({
      documentId,
      documentType,
      generatedAt: new Date().toISOString(),
      summary
    });
  } catch (error) {
    logGeminiError('patient_summary_failed', error, { operation: 'patient_summary' });
    const temporarilyUnavailable = isTemporaryModelError(error);
    return res.status(temporarilyUnavailable ? 503 : 502).json({
      error: temporarilyUnavailable
        ? 'Samjhaav taiyar karne wali seva abhi vyast hai. Thodi der baad phir koshish karein.'
        : 'Document ka aasaan samjhaav taiyar nahi ho saka. Phir koshish karein.',
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
  const normalizeConceptName = (name) => name.toLowerCase()
    .replace(/\s+\d[\d./-]*\s*(mg|mcg|g|ml|%|iu)?\b.*$/i, '')
    .replace(/\s+(oral|tablet|capsule|solution|injection|extended release|delayed release).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const matchedConcept = concepts.find((concept) => (
    concept.name && normalizeConceptName(concept.name) === normalizedSearchTerm && !concept.name.includes('/')
  ));

  if (!matchedConcept?.name) {
    return res.status(200).json({
      ...unavailableMedicineInformation(originalTerm),
      identityVerified: false,
      sourceWarnings: [],
      source: 'RxNorm identity lookup; no exact match found'
    });
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
  const normalizeIngredientName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const label = labels.find((candidate) => candidate.openfda?.generic_name?.some((name) => (
    normalizeIngredientName(name) === normalizeIngredientName(activeIngredient)
  )) && (candidate.indications_and_usage?.length || candidate.purpose?.length));
  const sourceText = ['purpose', 'indications_and_usage', 'mechanism_of_action', 'warnings', 'boxed_warning', 'contraindications']
    .flatMap((field) => label?.[field] || [])
    .filter(Boolean)
    .slice(0, 3)
    .join('\n\n');
  const sourceWarnings = ['boxed_warning', 'warnings', 'contraindications']
    .flatMap((field) => label?.[field] || [])
    .filter(Boolean)
    .slice(0, 2)
    .map((warning) => warning.slice(0, 500));
  const explanation = await explainMedicineFromSource(matchedConcept.name, sourceText);

  if (!explanation) {
    return res.status(200).json({
      ...unavailableMedicineInformation(originalTerm),
      expandedTerm: matchedConcept.name,
      identityVerified: true,
      sourceWarnings,
      source: 'RxNorm and U.S. FDA labeling lookup',
      rxcui: matchedConcept.rxcui || 'Information unavailable'
    });
  }

  return res.status(200).json({
    originalTerm,
    expandedTerm: matchedConcept.name,
    identityVerified: true,
    commonUse: explanation.commonUse && explanation.commonUse !== 'Information unavailable' ? explanation.commonUse : unavailableMedicineExplanation,
    generalHowItWorks: explanation.generalHowItWorks && explanation.generalHowItWorks !== 'Information unavailable' ? explanation.generalHowItWorks : unavailableMedicineExplanation,
    simpleMeaning: explanation.simpleMeaning && explanation.simpleMeaning !== 'Information unavailable' ? explanation.simpleMeaning : unavailableMedicineExplanation,
    whyDoctorsLookAtIt: explanation.whyDoctorsLookAtIt && explanation.whyDoctorsLookAtIt !== 'Information unavailable' ? explanation.whyDoctorsLookAtIt : unavailableMedicineExplanation,
    informationAvailable: [explanation.commonUse, explanation.generalHowItWorks, explanation.simpleMeaning, explanation.whyDoctorsLookAtIt]
      .some((value) => value && value !== 'Information unavailable' && value !== unavailableMedicineExplanation),
    sourceWarnings,
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
      response = await generateWithRetry(primaryModel, payload, 'scan');
    } catch (err) {
      if (fallbackModel === primaryModel) throw err;
      console.warn(JSON.stringify({
        event: 'gemini_model_fallback',
        primaryModel,
        fallbackModel,
        operation: 'scan',
        ...getGeminiErrorDetails(err)
      }));
      response = await generateWithRetry(fallbackModel, payload, 'scan');
    }

    const parsedResult = JSON.parse(response.text);
    return res.status(200).json(parsedResult);
  } catch (error) {
    logGeminiError('scan_failed', error, { operation: 'scan' });
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