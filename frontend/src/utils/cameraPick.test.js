import assert from 'node:assert';
import { isSpecialLens, isBackFacing, cameraIndex, pickPreferredCamera, nextCamera } from './cameraPick.js';

const cam = (deviceId, label) => ({ deviceId, label, kind: 'videoinput' });

// --- label parsing -----------------------------------------------------------
assert.strictEqual(isSpecialLens('Back Ultra Wide Camera'), true, 'iOS ultra-wide');
assert.strictEqual(isSpecialLens('Back Telephoto Camera'), true, 'iOS telephoto');
assert.strictEqual(isSpecialLens('Rear Macro'), true, 'macro');
assert.strictEqual(isSpecialLens('camera2 0, facing back'), false, 'Android label says nothing');
assert.strictEqual(isSpecialLens('UW camera'), true, 'uw as a word');
assert.strictEqual(isSpecialLens('Kuwait Back Camera'), false, 'uw inside a word is not a lens type');
assert.strictEqual(isSpecialLens(undefined), false, 'no label');
assert.strictEqual(isBackFacing('camera2 2, facing back'), true, 'Android back');
assert.strictEqual(isBackFacing('camera2 1, facing front'), false, 'Android front');
assert.strictEqual(cameraIndex('camera2 0, facing back'), 0, 'camera2 number');
assert.strictEqual(cameraIndex('camera 3, facing back'), 3, 'camera number');
assert.strictEqual(cameraIndex('Back Camera'), null, 'no number');

// --- picking the main lens ---------------------------------------------------
const android = [
  cam('a0', 'camera2 0, facing back'),
  cam('a1', 'camera2 1, facing front'),
  cam('a2', 'camera2 2, facing back'),
  cam('a3', 'camera2 3, facing back'),
];
assert.strictEqual(pickPreferredCamera(android, { deviceId: 'a3' }), 'a0', 'Android macro -> camera2 0');
assert.strictEqual(pickPreferredCamera(android, { label: 'camera2 2, facing back' }), 'a0', 'matched by label when deviceId is missing');
assert.strictEqual(pickPreferredCamera(android, { deviceId: 'a0' }), null, 'already on the main lens');
assert.strictEqual(pickPreferredCamera(android, { deviceId: 'a1' }), null, 'front camera is left alone');

const ios = [
  cam('i0', 'Front Camera'),
  cam('i1', 'Back Camera'),
  cam('i2', 'Back Ultra Wide Camera'),
  cam('i3', 'Back Telephoto Camera'),
];
assert.strictEqual(pickPreferredCamera(ios, { deviceId: 'i2' }), 'i1', 'ultra-wide -> main');
assert.strictEqual(pickPreferredCamera(ios, { deviceId: 'i3' }), 'i1', 'telephoto -> main');
assert.strictEqual(pickPreferredCamera(ios, { deviceId: 'i1' }), null, 'main stays');

assert.strictEqual(pickPreferredCamera([cam('w', 'Integrated Webcam'), cam('u', 'USB Camera')], { deviceId: 'u' }), null, 'desktop webcams: no guessing');
assert.strictEqual(pickPreferredCamera([cam('x', ''), cam('y', '')], { deviceId: 'x' }), null, 'unlabelled (no permission yet)');
assert.strictEqual(pickPreferredCamera([cam('m', 'Back Macro'), cam('u', 'Back Ultra Wide')], { deviceId: 'm' }), null, 'only special lenses: nothing better');
assert.strictEqual(pickPreferredCamera([cam('b1', 'Back Camera'), cam('b2', 'Back Dual Camera')], { deviceId: 'b2' }), null, 'unnumbered main lenses: keep the browser pick');
assert.strictEqual(pickPreferredCamera(null, { deviceId: 'a0' }), null, 'no device list');

// --- quick-switch cycling ----------------------------------------------------
assert.strictEqual(nextCamera(android, 'a0'), 'a2', 'next back camera, front skipped');
assert.strictEqual(nextCamera(android, 'a3'), 'a0', 'wraps around');
assert.strictEqual(nextCamera(android, 'a1'), 'a2', 'from the front camera: all cameras');
assert.strictEqual(nextCamera([cam('w', 'Integrated Webcam'), cam('u', 'USB Camera')], 'w'), 'u', 'desktop: every camera');
assert.strictEqual(nextCamera([cam('w', 'Integrated Webcam')], 'w'), null, 'single camera');

console.log('cameraPick ok');
