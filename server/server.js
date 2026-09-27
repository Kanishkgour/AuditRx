import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || primaryModel;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isTemporaryModelError = (error) => (
  error?.status === 503
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
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`MedScript server running on http://localhost:${PORT}`);
});