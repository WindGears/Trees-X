/* global importScripts, Vision, self, URL */
// This pinned SDK uses fetch for telemetry. Permit only local asset reads,
// before loading it; reject external requests without sending them.
const localFetch = self.fetch.bind(self)
self.fetch = (input, options) => {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url,
    self.location.href,
  )
  const method = options?.method ?? input.method ?? 'GET'
  if (url.origin !== self.location.origin || method.toUpperCase() !== 'GET') {
    return Promise.reject(new Error('Gesture worker permits same-origin asset reads only'))
  }
  return localFetch(input, options)
}
importScripts('./vision_bundle.js')
let detector
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const files = await Vision.FilesetResolver.forVisionTasks(
        new URL('./wasm', self.location.href).href,
      )
      detector = await Vision.HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL('./hand_landmarker.task', self.location.href).href,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.7,
        minHandPresenceConfidence: 0.7,
        minTrackingConfidence: 0.7,
      })
      self.postMessage({ type: 'ready' })
    } else if (data.type === 'frame') {
      const start = performance.now()
      try {
        const result = detector.detectForVideo(data.frame, data.time)
        self.postMessage({
          type: 'result',
          points: result.landmarks[0] ?? [],
          time: data.time,
          epoch: data.epoch,
          aspect: data.frame.width / data.frame.height,
          inferenceMs: performance.now() - start,
        })
      } finally {
        data.frame.close()
      }
    } else if (data.type === 'close') {
      detector?.close()
      self.close()
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) })
  }
}
