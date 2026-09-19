// transformers.js imports sharp when it loads but calls it only for images, which Script Glow never
// gives it. A call here means that changed, so it says so instead of failing somewhere obscure.
module.exports = function sharp() {
  throw new Error('Image processing is not available in Script Glow.');
};
