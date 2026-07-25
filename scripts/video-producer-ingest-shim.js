// Standalone ingest dashboard compatibility shim.
// The production site loads acquisition-video-producer.js via <script src> and
// calls HomeSignalVideoProducer.init(). The ingest build_dashboard.py standalone
// HTML inlines this file and calls initVideoProducer() on tab switch.
function initVideoProducer() {
  var container = document.getElementById('tab-videoproducer');
  if (window.HomeSignalVideoProducer &&
      typeof window.HomeSignalVideoProducer.init === 'function' &&
      container) {
    window.HomeSignalVideoProducer.init(container, {});
  }
}
window.initVideoProducer = initVideoProducer;
