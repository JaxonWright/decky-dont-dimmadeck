/**
 * Just enough protobuf to read and write the four scalar fields this plugin
 * cares about. Pulling in a real protobuf runtime to set two floats and two
 * ints would cost far more than it is worth, and the messages involved
 * (CMsgSystemManagerSettings, CMsgClientSettings) are only ever partially
 * populated anyway - Steam merges whatever fields you send.
 */

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LENGTH_DELIMITED = 2;
export const WIRE_FIXED32 = 5;

/** A field decoded out of a message, in whichever form the wire type implies. */
export interface ScalarField {
  varint?: number;
  float?: number;
}

function encodeVarint(value: number, out: number[]): void {
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    out.push(byte);
  } while (remaining);
}

function encodeKey(field: number, wireType: number, out: number[]): void {
  encodeVarint((field << 3) | wireType, out);
}

/** Encodes a `float` field (wire type 5). */
export function encodeFloatField(field: number, value: number): number[] {
  const out: number[] = [];
  encodeKey(field, WIRE_FIXED32, out);
  const bytes = new Uint8Array(new Float32Array([value]).buffer);
  for (const byte of bytes) out.push(byte);
  return out;
}

/** Encodes an `int32` field (wire type 0). Negative values are not supported. */
export function encodeVarintField(field: number, value: number): number[] {
  const out: number[] = [];
  encodeKey(field, WIRE_VARINT, out);
  encodeVarint(value, out);
  return out;
}

/** Packs encoded bytes into the base64 string Steam's setters expect. */
export function toBase64(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

/**
 * Walks a serialised message and returns its scalar fields by field number.
 *
 * Unknown fields are skipped by wire type rather than treated as an error, so
 * this keeps working when Steam adds fields we do not know about. A field we
 * cannot make sense of aborts the walk and returns what was read so far.
 */
export function decodeScalarFields(data: ArrayBuffer | Uint8Array): Map<number, ScalarField> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fields = new Map<number, ScalarField>();
  let offset = 0;

  const readVarint = (): number | null => {
    let result = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      result += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) return null;
    }
    return null;
  };

  while (offset < bytes.length) {
    const key = readVarint();
    if (key === null) break;
    const field = Math.floor(key / 8);
    const wireType = key & 0x7;

    if (wireType === WIRE_VARINT) {
      const value = readVarint();
      if (value === null) break;
      fields.set(field, { varint: value });
    } else if (wireType === WIRE_FIXED32) {
      if (offset + 4 > bytes.length) break;
      fields.set(field, { float: view.getFloat32(offset, true) });
      offset += 4;
    } else if (wireType === WIRE_FIXED64) {
      if (offset + 8 > bytes.length) break;
      offset += 8;
    } else if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = readVarint();
      if (length === null || offset + length > bytes.length) break;
      offset += length;
    } else {
      // Deprecated group wire types (3 and 4) - nothing sane left to do.
      break;
    }
  }

  return fields;
}

/**
 * Returns the payload of every length-delimited occurrence of `field`.
 *
 * Repeated embedded messages (CMsgSystemDisplayManagerState.displays, say) come
 * through as one length-delimited field per element, so this hands back a
 * buffer per element for decodeScalarFields to pick apart.
 */
export function decodeRepeatedBytes(
  data: ArrayBuffer | Uint8Array,
  field: number,
): Uint8Array[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const found: Uint8Array[] = [];
  let offset = 0;

  const readVarint = (): number | null => {
    let result = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      result += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) return null;
    }
    return null;
  };

  while (offset < bytes.length) {
    const key = readVarint();
    if (key === null) break;
    const fieldNumber = Math.floor(key / 8);
    const wireType = key & 0x7;

    if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = readVarint();
      if (length === null || offset + length > bytes.length) break;
      if (fieldNumber === field) found.push(bytes.subarray(offset, offset + length));
      offset += length;
    } else if (wireType === WIRE_VARINT) {
      if (readVarint() === null) break;
    } else if (wireType === WIRE_FIXED32) {
      if (offset + 4 > bytes.length) break;
      offset += 4;
    } else if (wireType === WIRE_FIXED64) {
      if (offset + 8 > bytes.length) break;
      offset += 8;
    } else {
      break;
    }
  }

  return found;
}

/** Encodes a length-delimited field, for tests and for nesting messages. */
export function encodeBytesField(field: number, payload: number[]): number[] {
  const out: number[] = [];
  encodeKey(field, WIRE_LENGTH_DELIMITED, out);
  encodeVarint(payload.length, out);
  out.push(...payload);
  return out;
}
