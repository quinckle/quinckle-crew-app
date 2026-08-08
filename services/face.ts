/**
 * Turning a photo into a face embedding, on the device.
 *
 * The whole point of doing this here rather than in the cloud is that the face
 * never leaves the tablet. What goes to the server is 192 floats — not
 * reversible into a photograph, and useless at any other venue. Under DPDP that
 * is the difference between processing biometric data in-country on hardware the
 * restaurant controls, and shipping faces to someone else's region.
 *
 * The pipeline, and why each step is there:
 *
 *   photo → MLKit detect → crop to the face → 112×112 → normalise → MobileFaceNet
 *
 * MobileFaceNet is trained on tight, centred face crops. Handing it a whole
 * kitchen with a person somewhere in it produces a perfectly valid embedding of
 * mostly wall, which then fails to match — the failure is silent and looks like
 * "face recognition doesn't work", so the detect-and-crop step is not optional.
 *
 * NOTE: this runs on a still capture, not a live frame stream. A kiosk takes one
 * photo per person, so frame processors would buy nothing and would drag in
 * worklets — and `react-native-reanimated` is not actually a dependency of this
 * app despite what CLAUDE.md says.
 */

import FaceDetection, { type Face } from '@react-native-ml-kit/face-detection';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { decode as decodeJpeg } from 'jpeg-js';

/**
 * Identifies which model produced a vector. The server only ever compares
 * embeddings sharing this string, so changing it silently invalidates every
 * enrollment at the venue — bump it ONLY alongside a real model change, and
 * expect everyone to re-enroll when you do.
 */
export const MODEL_VERSION = 'mobilefacenet-192-v1';

const INPUT_SIZE = 112;
const IMAGE_MEAN = 127.5;
const IMAGE_STD = 128;

/** Baked into the graph — see toModelInput. Not a tuneable. */
const BATCH = 2;
const EMBEDDING_DIM = 192;

/** Widens MLKit's box before cropping. */
const CROP_MARGIN = 0.25;

let model: TensorflowModel | null = null;
let loading: Promise<TensorflowModel> | null = null;

/**
 * Load once and keep it. A cold load is ~100ms and the kiosk will do this on
 * every person who walks up, so paying it once at screen mount keeps the queue
 * moving.
 */
export async function loadFaceModel(): Promise<TensorflowModel> {
  if (model) return model;
  if (!loading) {
    // No delegates — plain CPU. GPU/NNAPI delegates are the classic source of
    // "works on my device" on Android: they fall back silently, vary by chipset,
    // and can return subtly different floats, which for an embedding means
    // enrollments that no longer match. A 5MB model on a 112×112 input is
    // already well under a second on the CPU, and a kiosk has time.
    loading = loadTensorflowModel(
      require('../assets/models/MobileFaceNet.tflite'),
      [],
    ).then((m) => {
      model = m;
      return m;
    });
  }
  return loading;
}

export type FaceError =
  | 'NO_FACE'
  | 'MANY_FACES'
  | 'TOO_SMALL'
  | 'EYES_CLOSED'
  | 'MODEL_FAILED';

export type EmbedResult =
  | { ok: true; embedding: number[]; quality: number }
  | { ok: false; error: FaceError };

/** Human-facing copy. Every one of these tells the person what to DO. */
export const FACE_ERROR_TEXT: Record<FaceError, string> = {
  NO_FACE: 'No face detected — look at the screen and try again',
  MANY_FACES: 'More than one face in view — step up on your own',
  TOO_SMALL: 'Move a little closer to the screen',
  EYES_CLOSED: 'Keep your eyes open and try again',
  MODEL_FAILED: 'Could not read that. Use your PIN instead.',
};

/**
 * Photo in, 192-d embedding out.
 *
 * Returns a typed failure rather than throwing: at a kiosk every one of these
 * cases ends the same way — show a hint, offer the PIN — and an exception would
 * make callers work harder to reach that outcome.
 */
export async function embedFace(photoUri: string): Promise<EmbedResult> {
  const faces = await FaceDetection.detect(photoUri, {
    performanceMode: 'accurate',
    landmarkMode: 'all',
    classificationMode: 'all',
    minFaceSize: 0.15,
  });

  if (faces.length === 0) return { ok: false, error: 'NO_FACE' };
  // Refusing on a crowd is deliberate. Picking "the biggest face" when two
  // people are in frame is how you clock in whoever happened to lean closer.
  if (faces.length > 1) return { ok: false, error: 'MANY_FACES' };

  const face = faces[0]!;
  const { left, top, width, height } = face.frame;

  // A tiny box means they are far away, and the upscale to 112 would be mostly
  // invented detail. Better to ask them to step closer than to match on mush.
  if (width < 80 || height < 80) return { ok: false, error: 'TOO_SMALL' };

  if (eyesClosed(face)) return { ok: false, error: 'EYES_CLOSED' };

  const marginX = width * CROP_MARGIN;
  const marginY = height * CROP_MARGIN;

  const crop = {
    originX: Math.max(0, Math.round(left - marginX)),
    originY: Math.max(0, Math.round(top - marginY)),
    width: Math.round(width + marginX * 2),
    height: Math.round(height + marginY * 2),
  };

  let base64: string | undefined;
  try {
    const ctx = ImageManipulator.manipulate(photoUri);
    ctx.crop(crop);
    ctx.resize({ width: INPUT_SIZE, height: INPUT_SIZE });
    const ref = await ctx.renderAsync();
    // compress: 1 — JPEG at max quality. The crop is 112×112, so the file is a
    // few KB either way and there is no reason to trade accuracy for bytes.
    const saved = await ref.saveAsync({
      base64: true,
      format: SaveFormat.JPEG,
      compress: 1,
    });
    base64 = saved.base64;
  } catch {
    return { ok: false, error: 'MODEL_FAILED' };
  }

  if (!base64) return { ok: false, error: 'MODEL_FAILED' };

  try {
    const input = toModelInput(base64);
    const m = await loadFaceModel();
    // The interpreter speaks raw buffers in both directions; the float view is
    // ours to put back on.
    const outputs = m.runSync([input.buffer as ArrayBuffer]);
    const raw = outputs[0];
    if (!raw || raw.byteLength === 0) return { ok: false, error: 'MODEL_FAILED' };

    // Output is [2,192]; both rows are the same face, so keep the first.
    const all = new Float32Array(raw);
    const embedding = Array.from(all.subarray(0, EMBEDDING_DIM));
    if (embedding.length !== EMBEDDING_DIM || !embedding.every(Number.isFinite)) {
      return { ok: false, error: 'MODEL_FAILED' };
    }

    return { ok: true, embedding, quality: qualityOf(face) };
  } catch {
    return { ok: false, error: 'MODEL_FAILED' };
  }
}

/**
 * Base64 JPEG → the Float32Array MobileFaceNet expects.
 *
 * Layout and constants are taken from the model's own reference implementation:
 * height-major, RGB (jpeg-js hands back RGBA, so the alpha byte is skipped), and
 * `(pixel - 127.5) / 128`. Getting any of these wrong does not error — it
 * produces a well-formed embedding of nonsense that simply never matches, which
 * is a genuinely nasty thing to debug in a queue at 9am.
 */
function toModelInput(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  const { data, width, height } = decodeJpeg(bytes, { useTArray: true });

  const plane = INPUT_SIZE * INPUT_SIZE * 3;
  // The graph's input is [2,112,112,3], not [1,...] — this model was exported
  // to compare two faces in one pass, and the batch dimension is baked in. We
  // only ever have one face, so it goes in BOTH slots and we read the first
  // output row. Verified: with identical slots the two output rows are
  // identical. Feeding a single plane here does not error, it silently
  // under-fills the tensor and embeds half a face against uninitialised memory.
  const out = new Float32Array(plane * BATCH);
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[o++] = (data[i]! - IMAGE_MEAN) / IMAGE_STD;
      out[o++] = (data[i + 1]! - IMAGE_MEAN) / IMAGE_STD;
      out[o++] = (data[i + 2]! - IMAGE_MEAN) / IMAGE_STD;
    }
  }
  out.copyWithin(plane, 0, plane);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = global.atob ? global.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Both eyes confidently shut. Only rejects when MLKit is sure — an undefined
 * probability means classification did not run, and a missing signal must never
 * be read as a closed eye.
 */
function eyesClosed(face: Face): boolean {
  const l = face.leftEyeOpenProbability;
  const r = face.rightEyeOpenProbability;
  if (l === undefined || r === undefined) return false;
  return l < 0.2 && r < 0.2;
}

/**
 * A 0..1 hint stored alongside the enrollment, so a venue that enrolled someone
 * badly can find out later. Penalises a head turned away from the camera —
 * MobileFaceNet degrades on profile views, and an off-angle enrollment poisons
 * every future comparison against that person.
 */
function qualityOf(face: Face): number {
  const yaw = Math.min(Math.abs(face.rotationY ?? 0), 45) / 45;
  const roll = Math.min(Math.abs(face.rotationZ ?? 0), 45) / 45;
  return Math.max(0, Math.min(1, 1 - (yaw * 0.7 + roll * 0.3)));
}
