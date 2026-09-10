/**
 * Liveness / anti-spoofing — Phase B of ATTENDANCE_SYSTEM_PLAN.md §5.
 *
 * Today a printed photo, or a phone showing a colleague's face, would very
 * likely pass the face check. That is the entire threat model — buddy punching —
 * walking through the front door. `FaceAntiSpoofing.tflite` has been vendored in
 * `assets/models/` since the face work shipped and wired to nothing.
 *
 * This module runs it and returns a verdict. `embedFace` calls it between the
 * crop and the embedding.
 *
 * ── WHAT IS VERIFIED HERE, AND WHAT IS NOT ──────────────────────────────────
 *
 * ESTABLISHED. The graph is asked rather than assumed for input geometry, output
 * count and output shapes; a model that does not match is refused at load with a
 * message naming what it actually is. And the architecture is identifiable from
 * the vendored file's own tensor names — `sfl`, `sfl_1`, `sfl_2` blocks make it
 * a Deep Tree Network, which is the family the 0.2 threshold and the leaf-score
 * reading both come from.
 *
 * NOT ESTABLISHED, and this is the important part:
 *
 *   1. PREPROCESSING. [0,1] is the convention for this family, and is what is
 *      used below — but a wrong choice does not error, it produces a confident
 *      score of nonsense, exactly the failure mode the embedding pipeline warns
 *      about.
 *   2. WHICH HEAD IS WHICH. TensorFlow exported the two outputs as `Identity`
 *      and `Identity_1` with no semantic names, so the file cannot say which is
 *      the class prediction and which the routing mask. Handled at runtime
 *      rather than guessed — see `scoreHeads`.
 *   3. THE CONTEXT CROP. Spoof cues live at the EDGES — a phone bezel, the rim
 *      of a printed photo — so this deliberately uses a wider crop than the
 *      embedding. How wide is a calibration variable, not a known.
 *   4. THAT ANY OF IT RUNS. This has never executed. The model has never been
 *      loaded on a device, so even the shape assertions are untested.
 *
 * Which is why `LIVENESS_ENFORCED` is false. The check runs, scores are logged
 * on every attempt, and nothing is refused. Once the logs show real faces and
 * real spoofs separating, fit the threshold and flip the flag — the same
 * discipline §4 demands for the match thresholds, and the same mistake
 * ALIGN_ENABLED made by shipping a theoretically-right change unmeasured.
 *
 * A wrong formula with enforcement ON would lock every honest worker out of the
 * face path. With it OFF the cost of being wrong is a misleading log line.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { TensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';
import { decode as decodeJpeg } from 'jpeg-js';

/**
 * MASTER SWITCH. False ⇒ score and log, refuse nothing.
 *
 * Do NOT flip this on the strength of the code reading correctly. Flip it when
 * the logs show a gap between real faces and held-up photos on the actual kiosk
 * tablet, and set THRESHOLD from where that gap sits.
 */
export const LIVENESS_ENFORCED = false;

/**
 * Above this, the capture is judged an attack.
 *
 * 0.2 is the figure carried in the plan from the model's documentation. It is a
 * starting point for calibration, not a fitted value, and it means nothing until
 * the preprocessing above is confirmed.
 */
export const ATTACK_THRESHOLD = 0.2;

/**
 * How much context around the face to give the spoof model.
 *
 * WIDER than the embedding's crop (which uses CROP_MARGIN 0.25) and separate
 * from it on purpose: anti-spoofing reads the boundary of the presentation
 * medium, so a tight face crop can cut away the only evidence there is. This
 * crop is never fed to MobileFaceNet, so widening it cannot move an embedding or
 * invalidate an enrollment.
 */
const CONTEXT_MARGIN = 1.0;

/** Pixel scaling. See "NOT VERIFIED" above — this is the leading suspect. */
const PIXEL_SCALE = 1 / 255;
const PIXEL_BIAS = 0;

let model: TensorflowModel | null = null;
let loading: Promise<TensorflowModel> | null = null;
let shape: { batch: number; height: number; width: number; channels: number } | null = null;
let modelInfo = 'liveness model not loaded';

export function livenessModelInfo(): string {
  return modelInfo;
}

export type LivenessVerdict =
  | { ok: true; live: true; score: number; maskIndex: 0 | 1 | null }
  /** Scored as an attack. Only ever returned when LIVENESS_ENFORCED. */
  | { ok: true; live: false; score: number; maskIndex: 0 | 1 | null }
  /** The check could not run. NEVER treated as an attack — see checkLiveness. */
  | { ok: false; reason: string };

/**
 * Load once and keep it, mirroring the face model's lifecycle exactly —
 * including clearing the cached promise on failure, without which one transient
 * miss is re-awaited forever.
 */
export async function loadLivenessModel(
  tflite: typeof import('react-native-fast-tflite'),
): Promise<TensorflowModel> {
  if (model) return model;
  if (!loading) loading = openModel(tflite);
  try {
    return await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}

async function openModel(
  tflite: typeof import('react-native-fast-tflite'),
): Promise<TensorflowModel> {
  // Through expo-asset, never a bare require() handed to loadTensorflowModel —
  // that path leans on Image.resolveAssetSource, which is unreliable for
  // non-image assets in a release APK. Fine in dev, fails in the build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = Asset.fromModule(require('../assets/models/FaceAntiSpoofing.tflite'));
  if (!asset.downloaded) await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('anti-spoofing asset resolved to no uri');

  // Plain CPU, no delegates — same reasoning as the face model: delegates fall
  // back silently and vary by chipset, and a score that differs per device is
  // worse than one that is merely slow.
  const m = await tflite.loadTensorflowModel({ url: uri }, []);

  const inp = m.inputs[0];
  if (!inp || inp.shape.length !== 4) {
    throw new Error(`unexpected input shape ${JSON.stringify(inp?.shape)}`);
  }
  const [batch, height, width, channels] = inp.shape as [number, number, number, number];
  shape = { batch, height, width, channels };

  modelInfo =
    `in ${JSON.stringify(inp.shape)} ${inp.dataType} → ` +
    m.outputs.map((o) => `${JSON.stringify(o.shape)} ${o.dataType}`).join(' + ');

  if (channels !== 3) throw new Error(`expected 3 channels, model wants ${channels}`);
  // The score reading below assumes two heads. Refuse rather than silently
  // scoring off one of them, which would look plausible and mean nothing.
  if (m.outputs.length < 2) {
    throw new Error(`expected 2 outputs, model has ${m.outputs.length} | ${modelInfo}`);
  }

  console.log(`[liveness] model loaded: ${modelInfo}`);
  model = m;
  return m;
}

/**
 * Score one capture.
 *
 * Takes the ORIGINAL photo plus the face box, and cuts its own wider crop —
 * rather than reusing the embedding's 112 crop, which is both the wrong size and
 * too tight to contain the evidence.
 *
 * Returns `ok: false` when the check could not run at all. The caller must NOT
 * read that as an attack: an unavailable model would otherwise refuse the face
 * path for everyone, which is the hard denial Rule 1 forbids.
 */
export async function checkLiveness(
  tflite: typeof import('react-native-fast-tflite'),
  photo: { uri: string; width: number; height: number },
  faceBox: { cx: number; cy: number; size: number },
): Promise<LivenessVerdict> {
  let m: TensorflowModel;
  try {
    m = await loadLivenessModel(tflite);
  } catch (e: any) {
    return { ok: false, reason: `load: ${String(e?.message ?? e)}` };
  }
  if (!shape) return { ok: false, reason: 'geometry unknown' };

  const side = faceBox.size * (1 + CONTEXT_MARGIN * 2);
  const s = Math.round(Math.min(side, photo.width, photo.height));
  const x = Math.max(0, Math.min(Math.round(faceBox.cx - s / 2), photo.width - s));
  const y = Math.max(0, Math.min(Math.round(faceBox.cy - s / 2), photo.height - s));
  if (s < 2) return { ok: false, reason: `degenerate context crop ${s}` };

  let base64: string | undefined;
  try {
    const ctx = ImageManipulator.manipulate(photo.uri);
    ctx.crop({ originX: x, originY: y, width: s, height: s });
    ctx.resize({ width: shape.width, height: shape.height });
    const ref = await ctx.renderAsync();
    const saved = await ref.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: 1 });
    base64 = saved.base64;
  } catch (e: any) {
    return { ok: false, reason: `crop: ${String(e?.message ?? e)}` };
  }
  if (!base64) return { ok: false, reason: 'no base64 from context crop' };

  let input: Float32Array;
  try {
    input = toInput(base64);
  } catch (e: any) {
    return { ok: false, reason: `decode: ${String(e?.message ?? e)}` };
  }

  try {
    const outputs = m.runSync([input.buffer as ArrayBuffer]);
    const head0 = outputs[0] ? Array.from(new Float32Array(outputs[0])) : null;
    const head1 = outputs[1] ? Array.from(new Float32Array(outputs[1])) : null;
    if (!head0 || !head1) {
      return { ok: false, reason: `expected 2 output tensors, got ${outputs.length}` };
    }

    const { score, maskIndex } = scoreHeads(head0, head1);
    if (!Number.isFinite(score)) {
      return { ok: false, reason: `non-finite score | ${modelInfo}` };
    }

    // BOTH heads are logged raw, not just the derived score. When the reading
    // turns out to be wrong these values are the only thing that lets it be
    // fixed without another build — and this runs on a kiosk nobody is watching.
    // `mask=` says which head was identified as the routing mask, or `?` when it
    // could not be told, which is itself the most important thing in the line.
    console.log(
      `[liveness] score=${score.toFixed(4)} threshold=${ATTACK_THRESHOLD} ` +
        `enforced=${LIVENESS_ENFORCED} mask=${maskIndex ?? '?'} ` +
        `head0=[${head0.map((v) => v.toFixed(3)).join(',')}] ` +
        `head1=[${head1.map((v) => v.toFixed(3)).join(',')}]`,
    );

    const isAttack = score > ATTACK_THRESHOLD;
    // Reported live when not enforcing, so an unfitted threshold cannot strand
    // anyone. The score is in the log either way, which is the whole point of
    // this stage.
    return { ok: true, live: LIVENESS_ENFORCED ? !isAttack : true, score, maskIndex };
  } catch (e: any) {
    return { ok: false, reason: `inference: ${String(e?.message ?? e)} | ${modelInfo}` };
  }
}

/**
 * Combine the two heads into one attack score.
 *
 * The graph is a Deep Tree Network (the `sfl` / `sfl_1` / `sfl_2` blocks in the
 * tensor names), so one head is per-leaf class predictions and the other is the
 * routing mask over the same 8 leaves; the score is the masked magnitude.
 *
 * WHICH head is which cannot be read off the file — TensorFlow exported them as
 * `Identity` and `Identity_1` with no semantic names. Rather than assume an
 * order, the mask is identified by what a routing mask inescapably looks like:
 * every value in [0,1], summing to about 1. Getting this backwards would
 * silently produce a plausible number that means nothing, which is precisely the
 * class of bug this pipeline keeps having.
 *
 * If neither head looks like a mask the caller is told, and the score is
 * computed in declared order so there is still something in the log to look at.
 */
export function scoreHeads(
  a: number[],
  b: number[],
): { score: number; maskIndex: 0 | 1 | null } {
  const aMask = looksLikeRoutingMask(a);
  const bMask = looksLikeRoutingMask(b);

  // Exactly one of them looks like a mask — the unambiguous case.
  if (aMask && !bMask) return { score: masked(b, a), maskIndex: 0 };
  if (bMask && !aMask) return { score: masked(a, b), maskIndex: 1 };

  // Ambiguous. Fall back to declared order and report that we are guessing.
  return { score: masked(a, b), maskIndex: null };
}

/** Σ |pred| · mask — the leaf score this model family is read with. */
function masked(pred: number[], mask: number[]): number {
  let score = 0;
  const n = Math.min(pred.length, mask.length);
  for (let i = 0; i < n; i++) score += Math.abs(pred[i]!) * mask[i]!;
  return score;
}

/** A routing mask over leaves: each value a probability, together summing to 1. */
function looksLikeRoutingMask(v: number[]): boolean {
  if (v.length === 0) return false;
  let sum = 0;
  for (const x of v) {
    if (!Number.isFinite(x) || x < -0.01 || x > 1.01) return false;
    sum += x;
  }
  return sum > 0.9 && sum < 1.1;
}

/** Base64 JPEG → the tensor, height-major RGB, alpha dropped. */
function toInput(base64: string): Float32Array {
  if (!shape) throw new Error('geometry unknown');
  const { batch, height: H, width: W } = shape;

  const bytes = base64ToBytes(base64);
  const { data, width, height } = decodeJpeg(bytes, { useTArray: true });
  if (width !== W || height !== H) {
    throw new Error(`decoded ${width}x${height} but model wants ${W}x${H}`);
  }

  const plane = W * H * 3;
  const out = new Float32Array(plane * batch);
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[o++] = data[i]! * PIXEL_SCALE + PIXEL_BIAS;
      out[o++] = data[i + 1]! * PIXEL_SCALE + PIXEL_BIAS;
      out[o++] = data[i + 2]! * PIXEL_SCALE + PIXEL_BIAS;
    }
  }
  for (let b = 1; b < batch; b++) out.copyWithin(plane * b, 0, plane);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Neither `atob` nor `Buffer` is dependable under Hermes — see face.ts. */
function base64ToBytes(b64: string): Uint8Array {
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
