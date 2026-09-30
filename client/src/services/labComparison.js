const numericPattern = '[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)';
const scalarPattern = new RegExp(`^\\s*(${numericPattern})\\s*([a-zA-Zµμ%][a-zA-Z0-9µμ%/()._-]*)?\\s*$`);
const intervalPattern = new RegExp(`^\\s*(${numericPattern})\\s*(?:-|–|—|to)\\s*(${numericPattern})\\s*([a-zA-Zµμ%][a-zA-Z0-9µμ%/()._-]*)?\\s*$`, 'i');

const parseNumber = (text) => {
  if (text.includes(',')) {
    if (text.includes('.') || (text.match(/,/g) || []).length !== 1) return null;
    const [integer, fraction] = text.split(',');
    if (!fraction || (fraction.length === 3 && Number(integer) !== 0)) return null;
    text = `${integer}.${fraction}`;
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const parseScalar = (text) => {
  const match = text.match(scalarPattern);
  if (!match) return null;
  const value = parseNumber(match[1]);
  return value === null ? null : { value, unit: match[2]?.toLowerCase() || '' };
};

const parseInterval = (text) => {
  const match = text.match(intervalPattern);
  if (!match) return null;
  const lower = parseNumber(match[1]);
  const upper = parseNumber(match[2]);
  if (lower === null || upper === null || lower > upper) return null;
  return { lower, upper, unit: match[3]?.toLowerCase() || '' };
};

export const compareLabResult = (investigation) => {
  const resultField = investigation?.result;
  const rangeField = investigation?.referenceRange;
  const unitField = investigation?.unit;
  const resultText = resultField?.originalValue?.trim();
  const rangeText = rangeField?.originalValue?.trim();

  if (!resultText || !rangeText || resultField.needsVerification || rangeField.needsVerification || unitField?.needsVerification) {
    return 'unavailable';
  }

  const result = parseScalar(resultText);
  const range = parseInterval(rangeText);
  if (!result || !range || (result.unit && range.unit && result.unit !== range.unit)) return 'unavailable';
  if (result.value < range.lower) return 'below';
  if (result.value > range.upper) return 'above';
  return 'within';
};