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

import type { Face } from '@react-native-ml-kit/face-detection';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { TensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';
import { decode as decodeJpeg } from 'jpeg-js';
import { ATTACK_THRESHOLD, checkLiveness } from './liveness';

export { MODEL_VERSION } from '../constants/face';
export { LIVENESS_ENFORCED, livenessModelInfo } from './liveness';

// ── Native modules, loaded LAZILY and defensively ────────────────────────────
//
// These are `require`d inside a guard rather than imported at the top, because
// an OTA update can reach a binary that was built before they existed. The
// sharp edge is `react-native-fast-tflite`: it calls
// `NitroModules.createHybridObject(...)` at MODULE SCOPE, so a plain import
// throws on such a binary at load time — taking the whole screen with it,
// before any feature flag or capability check could have said "not here".
//
// Deferring it turns that crash into a clean, reportable "face unavailable".
// The type imports above are erased at compile time and cost nothing.

type Detector = typeof import('@react-native-ml-kit/face-detection').default;
type Tflite = typeof import('react-native-fast-tflite');

let detector: Detector | null = null;
let tflite: Tflite | null = null;
let nativeError: string | null = null;

function native(): { detector: Detector; tflite: Tflite } | null {
  if (detector && tflite) return { detector, tflite };
  if (nativeError) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    detector = require('@react-native-ml-kit/face-detection').default;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tflite = require('react-native-fast-tflite');
    if (!detector || !tflite) throw new Error('module resolved empty');
    return { detector, tflite };
  } catch (e: any) {
    nativeError = String(e?.message ?? e);
    console.warn(`[face] native modules unavailable: ${nativeError}`);
    detector = null;
    tflite = null;
    return null;
  }
}

/**
 * Can this BINARY do face at all?
 *
 * Distinct from whether the venue has the feature switched on. Callers should
 * check this before showing any face affordance, so a device running older
 * native code simply does not offer what it cannot deliver.
 */
export function faceRuntimeAvailable(): boolean {
  return native() !== null;
}

/** Fallback only — the real geometry is read from the graph at load. */
const INPUT_SIZE = 112;
const IMAGE_MEAN = 127.5;
const IMAGE_STD = 128;

/** Widens MLKit's box before cropping. */
const CROP_MARGIN = 0.25;

/**
 * Laplacian-variance floor for a usable capture.
 *
 * PROVISIONAL, like the match thresholds — it wants fitting against real
 * captures from the actual kiosk tablet, whose camera and lighting decide what
 * "sharp" looks like. Set low deliberately: a false REJECT costs one retry, a
 * false ACCEPT can poison an enrollment.
 */
const MIN_SHARPNESS = 12;

/**
 * Straighten the head before cropping.
 *
 * OFF. It is theoretically right — MobileFaceNet wants the eyes level — but it
 * was shipped alongside three other changes and recognition got worse, and with
 * four variables moving at once "theoretically right" is not evidence. Turn it
 * back on ALONE, with scores from the logs either side of the change.
 *
 * The framing bug it travelled with is fixed regardless (see squareAround): both
 * paths now produce the identical square crop, so enabling this changes only
 * the rotation, not the framing.
 */
const ALIGN_ENABLED = false;

let model: TensorflowModel | null = null;
let loading: Promise<TensorflowModel> | null = null;

/**
 * The input geometry READ FROM THE MODEL at load, not assumed.
 *
 * This file previously hard-coded batch 2 from an offline inspection of the
 * file. That was right, but it was a fact living in a comment — if the model is
 * ever swapped the constant silently stops matching the graph and the tensor is
 * mis-filled rather than rejected. Now the graph is the source of truth.
 */
let shape: { batch: number; height: number; width: number; channels: number } | null = null;

/** Last load/inspect summary, surfaced in error details so a device can say what it has. */
let modelInfo = 'model not loaded';

export function faceModelInfo(): string {
  return modelInfo;
}

/**
 * Load once and keep it. A cold load is ~100ms and the kiosk will do this on
 * every person who walks up, so paying it once at screen mount keeps the queue
 * moving.
 */
export async function loadFaceModel(): Promise<TensorflowModel> {
  if (model) return model;
  if (!loading) loading = openModel();
  try {
    return await loading;
  } catch (e) {
    // Clear the cached promise. Without this a single failed load is cached
    // FOREVER — every later attempt re-awaits the same rejection, so a
    // transient miss becomes permanent until the app restarts.
    loading = null;
    throw e;
  }
}

async function openModel(): Promise<TensorflowModel> {
  // Resolved through expo-asset rather than handed to loadTensorflowModel as a
  // bare require(). Internally that path calls Image.resolveAssetSource, which
  // is dependable for IMAGES bundled by Metro and much less so for other asset
  // types in an Android RELEASE build — the shape of bug that works perfectly
  // against the dev server and fails only in the APK. expo-asset resolves a
  // real file:// URI on both.
  const asset = Asset.fromModule(require('../assets/models/MobileFaceNet.tflite'));
  if (!asset.downloaded) await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  console.log(`[face] model asset → ${uri}`);
  if (!uri) throw new Error('model asset resolved to no uri (is tflite in metro assetExts?)');

  // No delegates — plain CPU. GPU/NNAPI delegates are the classic source of
  // "works on my device" on Android: they fall back silently, vary by chipset,
  // and can return subtly different floats, which for an embedding means
  // enrollments that no longer match. A 5MB model on a 112×112 input is
  // already well under a second on the CPU, and a kiosk has time.
  const n = native();
  if (!n) throw new Error(`native modules unavailable: ${nativeError}`);
  const m = await n.tflite.loadTensorflowModel({ url: uri }, []);

  const inp = m.inputs[0];
  const out = m.outputs[0];
  if (!inp || inp.shape.length !== 4) {
    throw new Error(`unexpected input shape ${JSON.stringify(inp?.shape)}`);
  }
  const [batch, height, width, channels] = inp.shape as [number, number, number, number];
  shape = { batch, height, width, channels };

  modelInfo = `in ${JSON.stringify(inp.shape)} ${inp.dataType} → out ${JSON.stringify(out?.shape)} ${out?.dataType}`;
  console.log(`[face] model loaded: ${modelInfo}`);

  if (channels !== 3) throw new Error(`expected 3 channels, model wants ${channels}`);

  model = m;
  return m;
}

/**
 * Split by STAGE, not lumped into one "it failed".
 *
 * The first version had a single MODEL_FAILED covering crop, decode and
 * inference. When it fired on a real device there was no way to tell which of
 * the three had gone wrong, and every guess costs a rebuild — so each stage now
 * names itself and carries the underlying message.
 */
export type FaceError =
  | 'NO_FACE'
  | 'MANY_FACES'
  | 'TOO_SMALL'
  | 'EYES_CLOSED'
  | 'NATIVE_MISSING'
  | 'BOX_OUT_OF_FRAME'
  | 'TOO_BLURRY'
  | 'CROP_FAILED'
  | 'DECODE_FAILED'
  | 'INFERENCE_FAILED'
  /**
   * The capture looks like a presentation attack — a printed photo, or a phone
   * held up to the camera. Only ever returned when liveness is ENFORCED; while
   * the threshold is being fitted the check scores and logs but refuses nothing.
   */
  | 'SPOOF_SUSPECTED';

export type EmbedResult =
  | { ok: true; embedding: number[]; quality: number }
  | { ok: false; error: FaceError; detail?: string };

/** Human-facing copy. Every one of these tells the person what to DO. */
export const FACE_ERROR_TEXT: Record<FaceError, string> = {
  NO_FACE: 'No face detected — look at the screen and try again',
  MANY_FACES: 'More than one face in view — step up on your own',
  TOO_SMALL: 'Move a little closer to the screen',
  EYES_CLOSED: 'Keep your eyes open and try again',
  NATIVE_MISSING: 'This device needs the latest app update for face check-in',
  BOX_OUT_OF_FRAME: 'Centre your face in the circle and try again',
  TOO_BLURRY: 'Hold still for a moment and try again',
  CROP_FAILED: 'Could not frame that. Use your PIN instead.',
  DECODE_FAILED: 'Could not read that. Use your PIN instead.',
  INFERENCE_FAILED: 'Face check unavailable. Use your PIN instead.',
  // Says what to DO, like every other message here, and does not accuse: the
  // overwhelmingly likely cause is bad light or a reflective screen behind
  // someone, not fraud. The PIN is right there either way.
  SPOOF_SUSPECTED: 'Look straight at the camera yourself — a photo or screen will not pass. Or use your PIN.',
};

/**
 * Photo in, 192-d embedding out.
 *
 * Returns a typed failure rather than throwing: at a kiosk every one of these
 * cases ends the same way — show a hint, offer the PIN — and an exception would
 * make callers work harder to reach that outcome.
 */
export async function embedFace(photo: {
  uri: string;
  width: number;
  height: number;
}): Promise<EmbedResult> {
  const n = native();
  if (!n) return { ok: false, error: 'NATIVE_MISSING', detail: nativeError ?? 'unknown' };

  const faces = await n.detector.detect(photo.uri, {
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

  const imgW = photo.width;
  const imgH = photo.height;

  // A box that sits largely outside the photo means MLKit and the manipulator
  // disagree about the coordinate space — the usual cause is EXIF rotation
  // being applied to one and not the other. Worth its own error: it is a bug in
  // us, not something the person standing there can fix by trying again.
  if (left >= imgW || top >= imgH || left + width <= 0 || top + height <= 0) {
    return {
      ok: false,
      error: 'BOX_OUT_OF_FRAME',
      detail: `face ${Math.round(left)},${Math.round(top)} ${Math.round(width)}x${Math.round(height)} vs image ${imgW}x${imgH}`,
    };
  }

  // ONE crop shape, always: a square centred on the face.
  //
  // This previously used MLKit's raw bounding box plus a margin, which is not
  // square — and resizing a non-square region to 112x112 STRETCHES the face.
  // Worse, the aligned path used a square while this one did not, so the same
  // person produced two differently-distorted images depending on how far their
  // head happened to be tilted. Embeddings are only comparable if the framing is
  // identical, so the framing is now identical by construction.
  const faceSize = Math.max(width, height);
  const cx = left + width / 2;
  const cy = top + height / 2;
  const crop = squareAround(cx, cy, faceSize * (1 + CROP_MARGIN * 2), imgW, imgH);
  if (crop.width < 2 || crop.height < 2) {
    return { ok: false, error: 'BOX_OUT_OF_FRAME', detail: `degenerate crop ${crop.width}x${crop.height}` };
  }

  // Loaded before the resize so the target size comes from the graph rather
  // than a constant that has to be kept in sync with it by hand.
  let m: TensorflowModel;
  try {
    m = await loadFaceModel();
  } catch (e: any) {
    return { ok: false, error: 'INFERENCE_FAILED', detail: `load: ${String(e?.message ?? e)}` };
  }
  const inW = shape?.width ?? INPUT_SIZE;
  const inH = shape?.height ?? INPUT_SIZE;

  // ── Alignment ───────────────────────────────────────────────────────────────
  //
  // Straighten the head before cropping, when we can. Two passes:
  //
  //   1. cut a generous square CENTRED on the face, then rotate it flat
  //   2. centre-crop that square down to the face, and resize
  //
  // Centring in pass 1 is what makes pass 2 trivial: rotation is about the
  // image's own centre, so the face stays at the centre no matter how the
  // library chooses to expand the canvas. We read the rotated dimensions back
  // off the ref rather than predicting them.
  //
  // The generous square has to fit entirely inside the photo, or the clamp would
  // shift the face off-centre and pass 2 would cut the wrong region. When it
  // doesn't fit we simply skip alignment — it is an improvement, not a
  // precondition, and a slightly tilted face still matches better than a
  // mis-cropped one.
  const roll = rollDegrees(face);
  const outer = faceSize * 2;
  const canAlign =
    ALIGN_ENABLED &&
    roll !== null &&
    Math.abs(roll) > 1.5 &&
    cx - outer / 2 >= 0 &&
    cy - outer / 2 >= 0 &&
    cx + outer / 2 <= imgW &&
    cy + outer / 2 <= imgH;

  let base64: string | undefined;
  try {
    if (canAlign) {
      const pass1 = ImageManipulator.manipulate(photo.uri);
      pass1.crop({
        originX: Math.round(cx - outer / 2),
        originY: Math.round(cy - outer / 2),
        width: Math.round(outer),
        height: Math.round(outer),
      });
      pass1.rotate(-roll!);
      const rotated = await pass1.renderAsync();

      // The face is at the centre of `rotated`; take the tight box from there.
      const inner = Math.min(
        Math.round(faceSize * (1 + CROP_MARGIN * 2)),
        rotated.width,
        rotated.height,
      );
      const pass2 = ImageManipulator.manipulate(rotated);
      pass2.crop({
        originX: Math.round((rotated.width - inner) / 2),
        originY: Math.round((rotated.height - inner) / 2),
        width: inner,
        height: inner,
      });
      pass2.resize({ width: inW, height: inH });
      const ref = await pass2.renderAsync();
      const saved = await ref.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: 1 });
      base64 = saved.base64;
    } else {
      const ctx = ImageManipulator.manipulate(photo.uri);
      ctx.crop(crop);
      ctx.resize({ width: inW, height: inH });
      const ref = await ctx.renderAsync();
      // compress: 1 — JPEG at max quality. The crop is small, so the file is a
      // few KB either way and there is no reason to trade accuracy for bytes.
      const saved = await ref.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: 1 });
      base64 = saved.base64;
    }
  } catch (e: any) {
    return { ok: false, error: 'CROP_FAILED', detail: describe(e, crop, imgW, imgH) };
  }

  if (!base64) return { ok: false, error: 'CROP_FAILED', detail: 'no base64 returned' };

  let input: Float32Array;
  let sharp: number;
  try {
    const prepared = toModelInput(base64);
    input = prepared.input;
    sharp = prepared.sharp;
  } catch (e: any) {
    return { ok: false, error: 'DECODE_FAILED', detail: String(e?.message ?? e) };
  }

  // Reject blur BEFORE embedding. A smeared face still produces a confident
  // vector — just the wrong one — and a wrong vector can match the wrong person
  // or, enrolled, quietly poison every later comparison. Refusing is strictly
  // better than guessing here.
  if (sharp < MIN_SHARPNESS) {
    return { ok: false, error: 'TOO_BLURRY', detail: `sharpness ${sharp.toFixed(1)} < ${MIN_SHARPNESS}` };
  }

  // ── Liveness ────────────────────────────────────────────────────────────────
  //
  // AFTER the blur gate, because a smeared frame would score as nonsense here
  // too, and BEFORE the embedding, so a rejected capture never becomes a vector
  // that could match or — worse — be enrolled.
  //
  // Fails CLOSED on a verdict, which is the one place in this pipeline that
  // does: a suspected attack refuses the face path. It still is not a hard
  // denial, because the PIN remains, so Rule 1 holds.
  //
  // Fails OPEN on the check being unable to run. A model that failed to load
  // must not lock the whole venue out of face check-in; that would turn a
  // missing asset into an outage. The distinction is exactly why checkLiveness
  // separates `ok: false` from `live: false`.
  const spoof = await checkLiveness(n.tflite, photo, { cx, cy, size: faceSize });
  if (!spoof.ok) {
    console.warn(`[face] liveness unavailable, continuing: ${spoof.reason}`);
  } else if (!spoof.live) {
    return {
      ok: false,
      error: 'SPOOF_SUSPECTED',
      detail: `liveness score ${spoof.score.toFixed(4)} > ${ATTACK_THRESHOLD}`,
    };
  }

  try {
    // The interpreter speaks raw buffers in both directions; the float view is
    // ours to put back on.
    const outputs = m.runSync([input.buffer as ArrayBuffer]);
    const raw = outputs[0];
    if (!raw || raw.byteLength === 0) {
      return { ok: false, error: 'INFERENCE_FAILED', detail: `empty output tensor | ${modelInfo}` };
    }

    // Output is [batch, dim]; every row is the same face, so keep the first.
    const all = new Float32Array(raw);
    const batch = shape?.batch ?? 1;
    const dim = Math.floor(all.length / batch);
    const embedding = Array.from(all.subarray(0, dim));
    if (dim < 64 || dim > 1024) {
      // Mirrors the server's isValidEmbedding bounds — better to say so here
      // than to have the request rejected as BAD_EMBEDDING after a round trip.
      return { ok: false, error: 'INFERENCE_FAILED', detail: `embedding dim ${dim} out of 64..1024 | ${modelInfo}` };
    }
    if (!embedding.every(Number.isFinite)) {
      return { ok: false, error: 'INFERENCE_FAILED', detail: 'non-finite values in embedding' };
    }

    return { ok: true, embedding, quality: qualityOf(face) };
  } catch (e: any) {
    return { ok: false, error: 'INFERENCE_FAILED', detail: `${String(e?.message ?? e)} | ${modelInfo}` };
  }
}

/**
 * A SQUARE of `side` centred on (cx, cy), kept inside the image by SHIFTING it
 * rather than shrinking it.
 *
 * Shrinking would make the rect non-square and the resize would distort the
 * face; shifting keeps the geometry constant and merely off-centres a face that
 * is near the edge. Constant geometry is what makes two embeddings comparable.
 */
function squareAround(cx: number, cy: number, side: number, imgW: number, imgH: number) {
  const s = Math.round(Math.min(side, imgW, imgH));
  const x = Math.max(0, Math.min(Math.round(cx - s / 2), imgW - s));
  const y = Math.max(0, Math.min(Math.round(cy - s / 2), imgH - s));
  return { originX: x, originY: y, width: s, height: s };
}

function describe(e: any, crop: object, w: number, h: number): string {
  return `${String(e?.message ?? e)} | crop ${JSON.stringify(crop)} image ${w}x${h}`;
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
function toModelInput(base64: string): { input: Float32Array; sharp: number } {
  if (!shape) throw new Error('model geometry unknown — load the model first');
  const { batch, height: H, width: W } = shape;

  const bytes = base64ToBytes(base64);
  const { data, width, height } = decodeJpeg(bytes, { useTArray: true });

  // Cheap, and it converts a whole class of silent corruption into a clear
  // message: a wrong-sized decode would otherwise under-fill the tensor and
  // embed uninitialised memory rather than failing.
  if (width !== W || height !== H) {
    throw new Error(`decoded ${width}x${height} but model wants ${W}x${H}`);
  }

  const plane = W * H * 3;
  const out = new Float32Array(plane * batch);
  const gray = new Float32Array(W * H);

  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      out[o++] = (r - IMAGE_MEAN) / IMAGE_STD;
      out[o++] = (g - IMAGE_MEAN) / IMAGE_STD;
      out[o++] = (b - IMAGE_MEAN) / IMAGE_STD;
      // Rec. 601 luma, for the sharpness measure only — never fed to the model.
      gray[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  // This model's graph declares batch 2 — it was exported to compare two faces
  // in one pass. We only ever have one, so it is replicated across every slot
  // and we read the first output row. Driven off the declared batch rather than
  // a constant, so swapping in a batch-1 model needs no code change.
  for (let b = 1; b < batch; b++) out.copyWithin(plane * b, 0, plane);
  return { input: out, sharp: sharpness(gray, W, H) };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Self-contained base64 → bytes.
 *
 * Deliberately does not use `atob` or `Buffer`. Neither is guaranteed under
 * Hermes: `Buffer` is a Node global that React Native does not ship, and `atob`
 * has moved in and out of the runtime across versions. A missing global throws
 * a ReferenceError that the caller can only report as a generic failure, and
 * chasing that down costs a native rebuild — so the twenty lines are cheaper.
 */
function base64ToBytes(b64: string): Uint8Array {
  // `=` is stripped along with whitespace, so the padding is already gone by
  // the time the length is computed — subtracting it again here underflows and
  // throws on short inputs.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));

  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]!);
    const c1 = B64.indexOf(clean[i + 1]!);
    const c2 = B64.indexOf(clean[i + 2]!);
    const c3 = B64.indexOf(clean[i + 3]!);

    const n = (c0 << 18) | (c1 << 12) | ((c2 & 63) << 6) | (c3 & 63);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

/**
 * Roll angle in degrees, from the eye landmarks, or null if we don't have them.
 *
 * MobileFaceNet is trained on ALIGNED faces — eyes on a horizontal line at
 * canonical positions. Feeding it a tilted face rotates every feature inside the
 * crop and moves the embedding a long way, which is felt as "it recognises me
 * sometimes". MLKit already returns these landmarks (we ask for
 * `landmarkMode: 'all'`); until now we asked for them and threw them away.
 *
 * Sign: image Y grows downward, so a positive atan2 means the right eye sits
 * lower on screen and the head is tilted clockwise — we rotate back by -angle.
 */
function rollDegrees(face: Face): number | null {
  const l = face.landmarks?.leftEye?.position;
  const r = face.landmarks?.rightEye?.position;
  if (!l || !r) return null;

  const dx = r.x - l.x;
  const dy = r.y - l.y;
  if (dx === 0 && dy === 0) return null;

  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * Sharpness, as the variance of a Laplacian over the crop's luminance.
 *
 * A motion-blurred capture still yields a confident-looking embedding — it is
 * simply the wrong one, which is worse than a refusal because it can match the
 * wrong person. The reference implementation for this model gates on the same
 * measure. Computed on the 112×112 crop, so it is ~12k pixels of work.
 */
function sharpness(gray: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // 4-neighbour Laplacian kernel.
      const lap =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }

  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
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
