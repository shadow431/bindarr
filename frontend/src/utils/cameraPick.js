// Which camera lens to scan with, kept out of CameraScanner so it can be tested
// without a camera. Inputs are the `videoinput` entries of
// navigator.mediaDevices.enumerateDevices(), which only carry labels once camera
// permission has been granted.
//
// The problem: on multi-lens phones `facingMode: 'environment'` lets the browser
// pick ANY back lens, and Android Chrome/WebView often lands on the macro or
// ultra-wide one — a macro lens cannot focus on a card held at a normal distance.

// Lenses that are not the main camera. iOS/desktop labels name them ("Back Ultra
// Wide Camera", "Telephoto"); Android labels usually don't ("camera2 2, facing
// back"), which is what the index rule below is for. `uw` is matched as a whole
// word only, so it can't fire inside an unrelated word.
const SPECIAL_LENS = /macro|ultra|wide|tele|depth|\buw\b/i;
const BACK_FACING = /back|rear|environment/i;

export function isSpecialLens(label) {
  return SPECIAL_LENS.test(label || '');
}

export function isBackFacing(label) {
  return BACK_FACING.test(label || '');
}

// Android's camera number from "camera2 0, facing back" (or "camera 0, …"). By
// Camera2 convention id 0 is the primary back camera, so the lowest-numbered back
// camera is the main lens. null when the label carries no number.
export function cameraIndex(label) {
  const m = /\bcamera\d*\s+(\d+)\b/i.exec(label || '');
  return m ? parseInt(m[1], 10) : null;
}

// The deviceId to switch to instead of the lens the browser opened, or null to
// keep it. `current` is { deviceId, label } of the opened track. Only ever moves
// between BACK cameras whose labels say so: a laptop webcam or an unlabelled list
// is left alone, because guessing there can only make things worse.
export function pickPreferredCamera(devices, current) {
  const backs = (devices || []).filter(d => d && d.deviceId && isBackFacing(d.label));
  if (backs.length < 2) return null;
  const cur = backs.find(d => current?.deviceId && d.deviceId === current.deviceId)
    || backs.find(d => current?.label && d.label === current.label);
  if (!cur) return null;

  // Main-lens candidates, lowest camera number first; unnumbered ones keep
  // their enumeration order behind the numbered ones.
  const mains = backs
    .filter(d => !isSpecialLens(d.label))
    .map((d, i) => ({ d, i, n: cameraIndex(d.label) }))
    .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity) || a.i - b.i)
    .map(x => x.d);
  const best = mains[0];
  if (!best || best.deviceId === cur.deviceId) return null;

  // The label names a non-main lens: any main candidate beats it.
  if (isSpecialLens(cur.label)) return best.deviceId;
  // Labels don't say which lens is which: trust the camera number.
  const curN = cameraIndex(cur.label);
  const bestN = cameraIndex(best.label);
  if (curN != null && bestN != null && bestN < curN) return best.deviceId;
  return null;
}

// The camera after `currentId` for the quick-switch button. Cycles through the
// back cameras when there are several and the current one is among them (on a
// phone that is the useful set — the selfie camera is no use for scanning),
// otherwise through every camera.
export function nextCamera(devices, currentId) {
  const all = (devices || []).filter(d => d && d.deviceId);
  const backs = all.filter(d => isBackFacing(d.label));
  const pool = backs.length >= 2 && backs.some(d => d.deviceId === currentId) ? backs : all;
  if (pool.length < 2) return null;
  const i = pool.findIndex(d => d.deviceId === currentId);
  return pool[(i + 1) % pool.length].deviceId;
}
