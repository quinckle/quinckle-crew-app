/**
 * Face constants with NO native dependencies.
 *
 * Split out from `services/face.ts` so a screen that merely needs to name the
 * model version does not drag in the TFLite runtime to read a string.
 *
 * That import chain was a real hazard: `react-native-fast-tflite` calls
 * `NitroModules.createHybridObject(...)` at MODULE SCOPE, so it runs the moment
 * the file is imported rather than when it is used. A binary without the native
 * module throws on import — and with an OTA that can reach older binaries, one
 * screen importing one constant was enough to break them.
 */

/**
 * Identifies which model produced a vector. The server only ever compares
 * embeddings sharing this string, so changing it silently invalidates every
 * enrollment at the venue — bump it ONLY alongside a real model change, and
 * expect everyone to re-enroll when you do.
 */
export const MODEL_VERSION = 'mobilefacenet-192-v1';
