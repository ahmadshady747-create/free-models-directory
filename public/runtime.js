/* Model Execution Runtime loader — WebAssembly preprocessing only.
   This layer does NOT run models and does NOT do inference. It only
   analyses the visitor's prompt text in this browser, before the
   existing playground code sends it to the provider:
   - characters: Unicode code points
   - words: non-whitespace runs
   - estimated tokens: ESTIMATE ONLY, ceil(characters / 4). This is NOT
     any provider's tokenizer and is never used for billing.
   - cleaned prompt: the same text with ASCII control characters
     stripped, except tab, newline and carriage return.
   If WebAssembly cannot be loaded (network, CSP, or any error), the
   same calculations run in JavaScript and the caller is told honestly
   that the JavaScript fallback was used. Nothing is stored, and the
   prompt is never sent anywhere by this file; only the existing
   playground request sends it, directly to the provider. */
(function () {
  var cached = null;

  function jsAnalyse(text) {
    var chars = Array.from(text).length;
    var trimmed = text.trim();
    var words = trimmed ? trimmed.split(/\s+/).length : 0;
    var tokens = chars === 0 ? 0 : Math.ceil(chars / 4);
    var cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    var removed = Array.from(text).length - Array.from(cleaned).length;
    return { chars: chars, words: words, tokens: tokens, cleaned: cleaned, removed: removed, engine: "js" };
  }

  function loadWasm() {
    if (cached) return cached;
    cached = fetch("/runtime.wasm")
      .then(function (res) {
        if (!res.ok) throw new Error("runtime.wasm HTTP " + res.status);
        return res.arrayBuffer();
      })
      // Non-streaming instantiate on purpose: it does not depend on
      // the server sending the application/wasm MIME type.
      .then(function (bytes) { return WebAssembly.instantiate(bytes, {}); })
      .then(function (result) { return result.instance; })
      .catch(function () { return null; });
    return cached;
  }

  function wasmAnalyse(instance, text) {
    var e = instance.exports;
    var enc = new TextEncoder();
    var data = enc.encode(text);
    var cap = e.input_capacity();
    if (data.length > cap) return jsAnalyse(text);
    var mem = new Uint8Array(e.memory.buffer);
    var ptr = e.input_ptr();
    mem.set(data, ptr);
    var chars = e.count_chars(ptr, data.length);
    var words = e.count_words(ptr, data.length);
    var tokens = e.estimate_tokens(ptr, data.length);
    var cleanedLen = e.sanitize(ptr, data.length);
    var outPtr = e.output_ptr();
    // Re-read memory after the calls: the buffer view is live, and the
    // module does not grow memory, so the slice is stable here.
    var cleaned = new TextDecoder().decode(mem.slice(outPtr, outPtr + cleanedLen));
    return { chars: chars, words: words, tokens: tokens, cleaned: cleaned, removed: data.length - cleanedLen, engine: "wasm" };
  }

  window.__modelRuntime = {
    analyse: async function (text) {
      var instance = await loadWasm();
      if (!instance) {
        var fallback = jsAnalyse(text);
        fallback.engine = "js-fallback";
        return fallback;
      }
      try {
        return wasmAnalyse(instance, text);
      } catch (err) {
        var fallback2 = jsAnalyse(text);
        fallback2.engine = "js-fallback";
        return fallback2;
      }
    },
    // Synchronous JavaScript twin of the same formulas, used only if
    // this loader itself failed to load at all.
    jsAnalyse: jsAnalyse
  };
})();
