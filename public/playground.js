/* Key-testing playground — browser only, no server proxy.
   The visitor's key goes from this browser directly to the provider only.
   It is never sent to this site's server (there is none), never put in
   this site's page URL, and never logged. By default it lives only in
   page memory; localStorage is used only when the visitor checks the
   explicit "remember in this browser only" box. */
(function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function httpError(status, text) {
    if (status === 401) return "خطأ 401: مفتاح خاطئ أو غير مصرح. تحقق من المفتاح ومن أن حسابك لدى المزود مفعّل.";
    if (status === 403) return "خطأ 403: المفتاح بلا صلاحية لهذا النموذج أو نقطة النهاية، أو النقطة خاطئة. راجع توثيق المزود.";
    if (status === 429) return "خطأ 429: تجاوزت حد الطلبات لدى المزود. انتظر قليلاً ثم أعد المحاولة، ولا تعيد الإرسال بسرعة.";
    if (status === 400) return "خطأ 400: حقل ناقص أو خاطئ في الطلب (معرّف النموذج أو أحد الحقول الخاصة). راجع رسالة المزود أدناه.";
    return "خطأ HTTP " + status + ": " + (text || "").slice(0, 500);
  }
  function corsMessage() {
    return "تعذر الاتصال بالمزود من متصفحك. السبب الأرجح: المزود لا يسمح بطلبات CORS المباشرة من المتصفح، أو النقطة غير متاحة من شبكتك. هذا ليس خطأ في المفتاح بالضرورة. جرّب من خادمك الخاص أو من أداة API، وراجع توثيق المزود. لم يُرسل مفتاحك إلى أي خادم تابع لهذا الموقع.";
  }
  function expand(str, ctx) {
    return String(str).replace(/\{([a-z_]+)\}/g, function (m, k) {
      return encodeURIComponent(ctx[k] == null ? "" : String(ctx[k]));
    });
  }
  function firstVideoUrl(obj) {
    // Recursively find the first .mp4/.webm/.mov URL in a provider response.
    var found = null;
    (function walk(v) {
      if (found || v == null) return;
      if (typeof v === "string") {
        if (/^https?:\/\/.+\.(mp4|webm|mov)(\?|#|$)/i.test(v)) found = v;
        return;
      }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === "object") { Object.keys(v).forEach(function (k) { walk(v[k]); }); }
    })(obj);
    return found;
  }
  function findUrl(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split(".");
      var cur = obj;
      var ok = true;
      for (var j = 0; j < parts.length; j++) {
        if (cur == null || typeof cur !== "object" || !(parts[j] in cur)) { ok = false; break; }
        cur = cur[parts[j]];
      }
      if (ok && typeof cur === "string" && cur) return cur;
    }
    return null;
  }

  function authHeaders(block, key, fields) {
    var auth = block.dataset.auth;
    var h = { "Content-Type": "application/json" };
    if (auth === "bearer") h["Authorization"] = "Bearer " + key;
    else if (auth === "x-api-key") h["x-api-key"] = key;
    else if (auth === "xi-api-key") h["xi-api-key"] = key;
    else if (auth === "deepl") h["Authorization"] = "DeepL-Auth-Key " + key;
    else if (auth === "token") h["Authorization"] = "Token " + key;
    else if (auth === "goog-api-key") h["x-goog-api-key"] = key;
    else if (auth === "ocp") {
      h["Ocp-Apim-Subscription-Key"] = key;
      if (fields.region) h["Ocp-Apim-Subscription-Region"] = fields.region;
    }
    else if (auth === "apikey") h["Api-Key"] = key;
    else if (auth === "clarifai-key") h["Authorization"] = "Key " + key;
    // query-apikey (Roboflow) and body-apikey (LibreTranslate) add no header.
    return h;
  }

  function showMedia(media, kind, urlOrBlob, isBlob) {
    media.innerHTML = "";
    var el;
    if (kind === "video") { el = document.createElement("video"); el.controls = true; el.src = isBlob ? URL.createObjectURL(urlOrBlob) : urlOrBlob; }
    else if (kind === "audio") { el = document.createElement("audio"); el.controls = true; el.src = isBlob ? URL.createObjectURL(urlOrBlob) : urlOrBlob; }
    else { el = document.createElement("img"); el.src = isBlob ? URL.createObjectURL(urlOrBlob) : urlOrBlob; el.alt = "ناتج مولد"; el.className = "max-w-full rounded-xl"; }
    media.appendChild(el);
    media.classList.remove("hidden");
  }

  function renderSyncResult(block, format, data, text, res, ctx) {
    var output = $(".pg-output", block), media = $(".pg-media", block);
    function textOut(s) { output.textContent = s; output.classList.remove("hidden"); }
    function embOut(arr) {
      if (!Array.isArray(arr)) { textOut(JSON.stringify(data).slice(0, 2000)); return; }
      textOut("بُعد المتجه: " + arr.length + "\nأول 8 أرقام: " + arr.slice(0, 8).join(", "));
    }
    if (format === "openai-chat" || format === "pollinations-chat") {
      var c = data && data.choices && data.choices[0];
      textOut(c && c.message ? (c.message.content || "") : (c && c.text) || text.slice(0, 2000));
    } else if (format === "anthropic-messages") {
      var parts = (data.content || []).filter(function (p) { return p.type === "text"; }).map(function (p) { return p.text; });
      textOut(parts.join("\n") || text.slice(0, 2000));
    } else if (format === "gemini-generate") {
      var cand = data.candidates && data.candidates[0];
      var txt = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ""; }).join("") : "";
      textOut(txt || text.slice(0, 2000));
    } else if (format === "openai-image") {
      var item = data.data && data.data[0];
      if (item && item.url) showMedia(media, "image", item.url, false);
      else if (item && item.b64_json) showMedia(media, "image", "data:image/png;base64," + item.b64_json, false);
      else textOut(text.slice(0, 2000));
    } else if (format === "ideogram-image") {
      var iu = data.data && data.data[0] && data.data[0].url;
      if (iu) showMedia(media, "image", iu, false); else textOut(text.slice(0, 2000));
    } else if (format === "cohere-embed") {
      embOut(data.embeddings && data.embeddings[0]);
    } else if (format === "voyage-embed" || format === "jina-embed") {
      embOut(data.data && data.data[0] && data.data[0].embedding);
    } else if (format === "deepl-translate") {
      textOut(data.translations && data.translations[0] ? data.translations[0].text : text.slice(0, 2000));
    } else if (format === "google-translate") {
      textOut(data.data && data.data.translations && data.data.translations[0] ? data.data.translations[0].translatedText : text.slice(0, 2000));
    } else if (format === "ms-translator") {
      textOut(Array.isArray(data) && data[0] && data[0].translations && data[0].translations[0] ? data[0].translations[0].text : text.slice(0, 2000));
    } else if (format === "libre-translate") {
      textOut(data.translatedText || text.slice(0, 2000));
    } else if (format === "clarifai-vision") {
      var out0 = data.outputs && data.outputs[0] && data.outputs[0].data;
      if (!out0) { textOut(text.slice(0, 2000)); return; }
      var lines = [];
      (out0.concepts || []).forEach(function (cn) { lines.push(cn.name + ": " + (typeof cn.value === "number" ? Math.round(cn.value * 100) + "%" : cn.value)); });
      if (out0.regions) lines.push("عدد الأجسام المكتشفة: " + out0.regions.length);
      textOut(lines.join("\n") || text.slice(0, 2000));
    } else if (format === "roboflow-detect") {
      var preds = data.predictions || [];
      textOut(preds.map(function (p) { return (p.class || "?") + ": " + (typeof p.confidence === "number" ? Math.round(p.confidence * 100) + "%" : p.confidence); }).join("\n") || text.slice(0, 2000));
    } else if (format === "google-vision") {
      var resp = data.responses && data.responses[0];
      if (!resp) { textOut(text.slice(0, 2000)); return; }
      var lv = [];
      (resp.labelAnnotations || []).forEach(function (a) { lv.push(a.description + ": " + (typeof a.score === "number" ? Math.round(a.score * 100) + "%" : "")); });
      (resp.localizedObjectAnnotations || []).forEach(function (a) { lv.push("جسم: " + a.name); });
      (resp.textAnnotations || []).slice(0, 3).forEach(function (a) { lv.push("نص: " + a.description); });
      textOut(lv.join("\n") || text.slice(0, 2000));
    } else if (format === "deepgram-listen") {
      var tr = data.results && data.results.channels && data.results.channels[0] && data.results.channels[0].alternatives && data.results.channels[0].alternatives[0];
      textOut(tr && tr.transcript ? tr.transcript : text.slice(0, 2000));
    } else {
      textOut(text.slice(0, 2000));
    }
  }

  async function doFetch(url, opts) {
    var res = await fetch(url, opts);
    return res;
  }

  async function pollJob(block, ctx) {
    var status = $(".pg-status", block), error = $(".pg-error", block), output = $(".pg-output", block), media = $(".pg-media", block);
    var stopBtn = $(".pg-stop", block), runBtn = $(".pg-run", block);
    var pollUrl = expand(ctx.pollEndpoint, ctx.pollCtx);
    var interval = parseInt(ctx.pollInterval, 10) || 5000;
    var maxMs = parseInt(ctx.maxPoll, 10) || 900000;
    var start = Date.now(), attempt = 0, stopped = false;
    stopBtn.classList.remove("hidden");
    stopBtn.onclick = function () {
      stopped = true;
      if (ctx.cancelEndpoint) {
        try {
          fetch(expand(ctx.cancelEndpoint, ctx.pollCtx), { method: "POST", headers: ctx.headers }).catch(function () {});
        } catch (e) {}
      }
      status.textContent = "تم إيقاف الاستطلاع من قبلك — قد تستمر المهمة لدى المزود، ومعرّفها هو: " + ctx.jobId;
      stopBtn.classList.add("hidden");
      runBtn.disabled = false;
    };
    try {
      while (!stopped) {
        if (Date.now() - start > maxMs) {
          status.textContent = "انتهت مهلة الاستطلاع (" + Math.round(maxMs / 60000) + " دقيقة) دون اكتمال. تحقق من حالة المهمة لدى المزود بمعرّفها: " + ctx.jobId;
          break;
        }
        attempt++;
        status.textContent = "جارٍ الاستطلاع — المحاولة " + attempt + " — معرّف المهمة: " + ctx.jobId + " — الحالة: قيد المعالجة…";
        await sleep(interval);
        if (stopped) break;
        var res;
        try { res = await doFetch(pollUrl, { method: "GET", headers: ctx.headers }); }
        catch (e) { error.classList.remove("hidden"); error.textContent = corsMessage(); status.textContent = "توقف الاستطلاع."; break; }
        var text = await res.text();
        if (!res.ok) { error.classList.remove("hidden"); error.textContent = httpError(res.status, text); status.textContent = "توقف الاستطلاع."; break; }
        var data; try { data = JSON.parse(text); } catch (e) { data = null; }
        if (!data) { error.classList.remove("hidden"); error.textContent = "استجابة غير متوقعة من المزود أثناء الاستطلاع."; status.textContent = "توقف الاستطلاع."; break; }
        var verdict = ctx.parsePoll(data);
        if (verdict.state === "processing") continue;
        if (verdict.state === "failed") { error.classList.remove("hidden"); error.textContent = "فشلت المهمة لدى المزود: " + (verdict.message || "بدون رسالة خطأ من المزود."); status.textContent = "انتهت المهمة بالفشل — لم تُعاد المحاولة تلقائياً."; break; }
        if (verdict.state === "done") {
          if (verdict.videoUrl) { showMedia(media, "video", verdict.videoUrl, false); status.textContent = "اكتمل التوليد — الفيديو من المزود مباشرة."; }
          else if (verdict.mediaUrl) {
            var u = verdict.mediaUrl;
            if (/\.mp4|\.webm|\.mov/i.test(u)) showMedia(media, "video", u, false);
            else if (/\.(png|jpg|jpeg|webp|gif)/i.test(u)) showMedia(media, "image", u, false);
            else if (/\.(mp3|wav|ogg)/i.test(u)) showMedia(media, "audio", u, false);
            else { output.textContent = u; output.classList.remove("hidden"); }
            status.textContent = "اكتمل التوليد.";
          } else if (verdict.text) { output.textContent = verdict.text; output.classList.remove("hidden"); status.textContent = "اكتمل التوليد."; }
          else { output.textContent = text.slice(0, 2000); output.classList.remove("hidden"); status.textContent = "اكتمل التوليد — هذا نص الاستجابة المختصر."; }
          break;
        }
      }
    } finally {
      stopBtn.classList.add("hidden");
      runBtn.disabled = false;
    }
  }

  function parseReplicate(data) {
    var st = String(data.status || "").toLowerCase();
    if (st === "succeeded") {
      var out = data.output;
      if (typeof out === "string") return { state: "done", mediaUrl: out };
      if (Array.isArray(out) && out.length) return { state: "done", mediaUrl: out[0] };
      return { state: "done", text: JSON.stringify(data).slice(0, 2000) };
    }
    if (st === "failed" || st === "canceled" || st === "cancelled") return { state: "failed", message: data.error || st };
    return { state: "processing" };
  }
  function parseRunway(data) {
    var st = String(data.status || "").toUpperCase();
    if (st === "SUCCEEDED") {
      var url = null;
      if (Array.isArray(data.output) && data.output.length) url = typeof data.output[0] === "string" ? data.output[0] : (data.output[0] && data.output[0].url);
      if (!url && data.artifacts && data.artifacts[0]) url = data.artifacts[0].url;
      if (!url) url = firstVideoUrl(data);
      return { state: "done", videoUrl: url };
    }
    if (st === "FAILED" || st === "CANCELED" || st === "CANCELLED") return { state: "failed", message: data.failure || st };
    return { state: "processing" };
  }
  function parseLuma(data) {
    var st = String(data.state || "").toLowerCase();
    if (st === "completed") return { state: "done", videoUrl: data.assets && data.assets.video };
    if (st === "failed") return { state: "failed", message: data.failure_reason || "failed" };
    return { state: "processing" };
  }
  function parseMinimax(data) {
    var inner = data.data || data;
    var st = String(inner.status || data.status || "").toLowerCase();
    if (st === "succeeded" || st === "success") {
      var url = findUrl(data, ["content.url", "data.content.url", "url", "data.url"]) || firstVideoUrl(data);
      return { state: "done", videoUrl: url };
    }
    if (st === "failed" || st === "cancelled" || st === "canceled" || st === "expired") return { state: "failed", message: st + (data.base_resp && data.base_resp.status_msg ? " — " + data.base_resp.status_msg : "") };
    return { state: "processing" };
  }
  function parsePlayht(data) {
    var st = String(data.status || "").toLowerCase();
    if (st === "complete" || st === "completed" || st === "success") {
      var url = findUrl(data, ["output.url", "audio_url", "url", "data.url"]);
      return { state: "done", mediaUrl: url, text: url ? null : JSON.stringify(data).slice(0, 2000) };
    }
    if (st === "failed" || st === "error") return { state: "failed", message: data.error || st };
    return { state: "processing" };
  }

  function init() {
    $$(".playground").forEach(function (block) {
      var keyInput = $(".pg-key", block), remember = $(".pg-remember", block);
      var providerId = block.dataset.provider || "";
      var storeKey = "ai-api-key:" + providerId;
      try {
        var saved = localStorage.getItem(storeKey);
        if (saved) { keyInput.value = saved; if (remember) remember.checked = true; }
      } catch (e) {}
      if (remember) remember.addEventListener("change", function () {
        try { if (remember.checked && keyInput.value) localStorage.setItem(storeKey, keyInput.value); else localStorage.removeItem(storeKey); } catch (e) {}
      });
      if (keyInput) keyInput.addEventListener("input", function () {
        try { if (remember && remember.checked) localStorage.setItem(storeKey, keyInput.value); } catch (e) {}
      });
      var showBtn = $(".pg-show", block);
      if (showBtn) showBtn.addEventListener("click", function (e) {
        var show = keyInput.type === "password";
        keyInput.type = show ? "text" : "password";
        e.currentTarget.textContent = show ? "إخفاء" : "إظهار";
      });
      var clearBtn = $(".pg-clear", block);
      if (clearBtn) clearBtn.addEventListener("click", function () {
        keyInput.value = "";
        try { localStorage.removeItem(storeKey); } catch (e) {}
        if (remember) remember.checked = false;
      });

      var runBtn = $(".pg-run", block);
      if (!runBtn) return;
      runBtn.addEventListener("click", async function () {
        var status = $(".pg-status", block), error = $(".pg-error", block), output = $(".pg-output", block), media = $(".pg-media", block);
        status.classList.remove("hidden"); error.classList.add("hidden"); output.classList.add("hidden"); media.classList.add("hidden"); media.innerHTML = "";
        var key = keyInput.value.trim();
        var format = block.dataset.format, kind = block.dataset.kind;
        var promptEl = $(".pg-prompt", block);
        var prompt = promptEl ? promptEl.value.trim() : "";
        var modelEl = $(".pg-model", block);
        var model = modelEl ? modelEl.value.trim() : "";
        var fields = {};
        $$(".pg-field", block).forEach(function (inp) { fields[inp.dataset.field] = inp.value.trim(); });
        var missing = $$(".pg-field", block).filter(function (inp) { return inp.required && !inp.value.trim(); });
        if (format !== "libre-translate" && !key) { status.textContent = "أدخل مفتاحك الخاص أولاً. لن يُرسل إلا إلى المزود مباشرة."; return; }
        if (missing.length) { status.textContent = "أكمل الحقل المطلوب: " + (missing[0].previousElementSibling ? missing[0].previousElementSibling.textContent : missing[0].dataset.field); return; }
        if (promptEl && !prompt) { status.textContent = "اكتب نصاً أولاً."; return; }
        if ((format === "openai-chat" || format === "anthropic-messages" || format === "gemini-generate" || format === "openai-image" || format === "cohere-embed" || format === "voyage-embed" || format === "jina-embed" || format === "replicate-prediction" || format === "runway-task" || format === "luma-generation" || format === "minimax-video") && !model && format !== "replicate-prediction") {
          // Replicate uses model as version, also required; handled below.
          status.textContent = "أدخل معرّف النموذج من توثيق المزود."; return;
        }
        runBtn.disabled = true;
        status.textContent = "جارٍ الاتصال مباشرة بالمزود من متصفحك…";
        try {
          var headers = authHeaders(block, key, fields);
          var body = null, url = block.dataset.endpoint, method = "POST", isForm = false;
          var ctx = { headers: headers, format: format };

          if (format === "openai-chat" || format === "pollinations-chat") {
            body = JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }] });
          } else if (format === "openai-image") {
            body = JSON.stringify({ model: model, prompt: prompt });
          } else if (format === "anthropic-messages") {
            body = JSON.stringify({ model: model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] });
          } else if (format === "gemini-generate") {
            if (!model) { status.textContent = "أدخل معرّف النموذج من توثيق المزود."; runBtn.disabled = false; return; }
            url = expand(block.dataset.endpoint, { model: model });
            body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
          } else if (format === "elevenlabs-tts") {
            if (!fields.voice_id) { status.textContent = "أدخل معرّف الصوت Voice ID من حسابك لدى المزود."; runBtn.disabled = false; return; }
            url = expand(block.dataset.endpoint, { voice_id: fields.voice_id });
            body = JSON.stringify({ text: prompt, model_id: model || undefined });
            var blobRes = await doFetch(url, { method: "POST", headers: headers, body: body });
            if (!blobRes.ok) throw new Error("HTTP " + blobRes.status + ": " + (await blobRes.text()).slice(0, 500));
            showMedia(media, "audio", await blobRes.blob(), true);
            status.textContent = "تم التوليد. الصوت من المزود مباشرة."; runBtn.disabled = false; return;
          } else if (format === "pollinations-image") {
            var imgRes = await doFetch(block.dataset.endpoint + encodeURIComponent(prompt), { method: "GET", headers: { "Authorization": "Bearer " + key } });
            if (!imgRes.ok) throw new Error("HTTP " + imgRes.status + ": " + (await imgRes.text()).slice(0, 500));
            showMedia(media, "image", await imgRes.blob(), true);
            status.textContent = "تم التوليد."; runBtn.disabled = false; return;
          } else if (format === "ideogram-image") {
            body = JSON.stringify({ text_prompt: prompt, aspect_ratio: fields.aspect_ratio || undefined });
          } else if (format === "stability-image") {
            var fd = new FormData();
            fd.append("prompt", prompt);
            fd.append("output_format", "png");
            if (fields.aspect_ratio) fd.append("aspect_ratio", fields.aspect_ratio);
            var stHeaders = { "Authorization": "Bearer " + key, "Accept": "image/*" };
            var stRes = await doFetch(url, { method: "POST", headers: stHeaders, body: fd });
            if (!stRes.ok) throw new Error("HTTP " + stRes.status + ": " + (await stRes.text()).slice(0, 500));
            showMedia(media, "image", await stRes.blob(), true);
            status.textContent = "تم التوليد."; runBtn.disabled = false; return;
          } else if (format === "cohere-embed") {
            body = JSON.stringify({ model: model, texts: [prompt], input_type: "search_document" });
          } else if (format === "voyage-embed") {
            body = JSON.stringify({ input: [prompt], model: model, input_type: "document" });
          } else if (format === "jina-embed") {
            body = JSON.stringify({ model: model, input: [prompt] });
          } else if (format === "deepl-translate") {
            if (key.endsWith(":fx")) url = "https://api-free.deepl.com/v2/translate";
            var deeplBody = { text: [prompt], target_lang: fields.target_lang };
            if (fields.source_lang) deeplBody.source_lang = fields.source_lang;
            body = JSON.stringify(deeplBody);
          } else if (format === "google-translate") {
            body = JSON.stringify({ q: [prompt], target: fields.target, source: fields.source || undefined, format: "text" });
          } else if (format === "ms-translator") {
            var qs = "?api-version=3.0&to=" + encodeURIComponent(fields.to || "");
            if (fields.from) qs += "&from=" + encodeURIComponent(fields.from);
            url = url + qs;
            body = JSON.stringify([{ Text: prompt }]);
          } else if (format === "libre-translate") {
            var base = (fields.instance || "https://libretranslate.com").replace(/\/+$/, "");
            url = base + "/translate";
            var ltBody = { q: prompt, source: fields.source, target: fields.target, format: "text" };
            if (key) ltBody.api_key = key;
            body = JSON.stringify(ltBody);
          } else if (format === "clarifai-vision") {
            var clUrl = "https://api.clarifai.com/v2/users/" + encodeURIComponent(fields.user_id) + "/apps/" + encodeURIComponent(fields.app_id) + "/models/" + encodeURIComponent(fields.model_id);
            if (fields.version_id) clUrl += "/versions/" + encodeURIComponent(fields.version_id);
            clUrl += "/outputs";
            url = clUrl;
            body = JSON.stringify({ inputs: [{ data: { image: { url: fields.image_url } } }] });
          } else if (format === "roboflow-detect") {
            url = "https://detect.roboflow.com/" + encodeURIComponent(fields.project_id) + "/" + encodeURIComponent(fields.version) + "?api_key=" + encodeURIComponent(key) + "&image=" + encodeURIComponent(fields.image_url);
            method = "POST";
            var rbRes = await doFetch(url, { method: "POST" });
            var rbText = await rbRes.text();
            if (!rbRes.ok) throw new Error("HTTP " + rbRes.status + ": " + rbText.slice(0, 500));
            renderSyncResult(block, format, JSON.parse(rbText), rbText, rbRes, ctx);
            status.textContent = "تم التحليل."; runBtn.disabled = false; return;
          } else if (format === "google-vision") {
            body = JSON.stringify({ requests: [{ image: { source: { imageUri: fields.image_url } }, features: [{ type: fields.feature || "LABEL_DETECTION", maxResults: 5 }] }] });
          } else if (format === "deepgram-listen") {
            var dgUrl = url + "?model=" + encodeURIComponent(fields.model || "nova-3");
            var dgRes = await doFetch(dgUrl, { method: "POST", headers: headers, body: JSON.stringify({ url: fields.audio_url }) });
            var dgText = await dgRes.text();
            if (!dgRes.ok) throw new Error("HTTP " + dgRes.status + ": " + dgText.slice(0, 500));
            renderSyncResult(block, format, JSON.parse(dgText), dgText, dgRes, ctx);
            status.textContent = "تم النسخ."; runBtn.disabled = false; return;
          } else if (format === "deepgram-speak") {
            var spUrl = url + "?model=" + encodeURIComponent(fields.model || "aura-2-thalia-en");
            var spRes = await doFetch(spUrl, { method: "POST", headers: headers, body: JSON.stringify({ text: prompt }) });
            if (!spRes.ok) throw new Error("HTTP " + spRes.status + ": " + (await spRes.text()).slice(0, 500));
            showMedia(media, "audio", await spRes.blob(), true);
            status.textContent = "تم التوليد."; runBtn.disabled = false; return;
          } else if (format === "replicate-prediction") {
            if (!model) { status.textContent = "أدخل معرّف إصدار النموذج version من توثيق Replicate."; runBtn.disabled = false; return; }
            var rpRes = await doFetch(url, { method: "POST", headers: headers, body: JSON.stringify({ version: model, input: { prompt: prompt } }) });
            var rpText = await rpRes.text();
            if (!rpRes.ok) throw new Error("HTTP " + rpRes.status + ": " + rpText.slice(0, 500));
            var rpData = JSON.parse(rpText);
            var rpId = rpData.id;
            var rpPoll = (rpData.urls && rpData.urls.get) ? rpData.urls.get : "https://api.replicate.com/v1/predictions/" + rpId;
            status.textContent = "تم إرسال المهمة — معرّف التنبؤ: " + rpId + " — يبدأ الاستطلاع…";
            await pollJob(block, { headers: headers, pollEndpoint: rpPoll, pollInterval: block.dataset.pollInterval || "5000", maxPoll: block.dataset.maxPoll || "900000", jobId: rpId, pollCtx: {}, cancelEndpoint: "https://api.replicate.com/v1/predictions/" + rpId + "/cancel", parsePoll: parseReplicate });
            runBtn.disabled = false; return;
          } else if (format === "runway-task") {
            var rwBody, rwUrl = url;
            var rwHeaders = Object.assign({}, headers, { "X-Runway-Version": fields.version || "2024-11-06" });
            if (fields.prompt_image) {
              rwUrl = "https://api.dev.runwayml.com/v1/image_to_video";
              rwBody = { model: model, promptText: prompt, promptImage: fields.prompt_image, ratio: fields.ratio || undefined, duration: fields.duration ? parseInt(fields.duration, 10) : undefined };
            } else {
              rwBody = { model: model, promptText: prompt, ratio: fields.ratio || undefined, duration: fields.duration ? parseInt(fields.duration, 10) : undefined };
            }
            var rwRes = await doFetch(rwUrl, { method: "POST", headers: rwHeaders, body: JSON.stringify(rwBody) });
            var rwText = await rwRes.text();
            if (!rwRes.ok) throw new Error("HTTP " + rwRes.status + ": " + rwText.slice(0, 500));
            var rwData = JSON.parse(rwText);
            var rwId = rwData.id;
            status.textContent = "تم إرسال المهمة — معرّف المهمة: " + rwId + " — يبدأ الاستطلاع…";
            await pollJob(block, { headers: rwHeaders, pollEndpoint: "https://api.dev.runwayml.com/v1/tasks/{id}", pollInterval: block.dataset.pollInterval || "10000", maxPoll: block.dataset.maxPoll || "900000", jobId: rwId, pollCtx: { id: rwId }, parsePoll: parseRunway });
            runBtn.disabled = false; return;
          } else if (format === "luma-generation") {
            var lmBody = { prompt: prompt, aspect_ratio: fields.aspect_ratio || undefined, model: model || undefined };
            var lmRes = await doFetch(url, { method: "POST", headers: headers, body: JSON.stringify(lmBody) });
            var lmText = await lmRes.text();
            if (!lmRes.ok) throw new Error("HTTP " + lmRes.status + ": " + lmText.slice(0, 500));
            var lmData = JSON.parse(lmText);
            var lmId = lmData.id;
            status.textContent = "تم إرسال التوليد — معرّفه: " + lmId + " — يبدأ الاستطلاع…";
            await pollJob(block, { headers: headers, pollEndpoint: block.dataset.pollEndpoint, pollInterval: block.dataset.pollInterval || "5000", maxPoll: block.dataset.maxPoll || "900000", jobId: lmId, pollCtx: { id: lmId }, parsePoll: parseLuma });
            runBtn.disabled = false; return;
          } else if (format === "minimax-video") {
            var mmRes = await doFetch(url, { method: "POST", headers: headers, body: JSON.stringify({ model: model, prompt: prompt }) });
            var mmText = await mmRes.text();
            if (!mmRes.ok) throw new Error("HTTP " + mmRes.status + ": " + mmText.slice(0, 500));
            var mmData = JSON.parse(mmText);
            var mmId = (mmData.data && mmData.data.task_id) || mmData.task_id;
            if (!mmId) throw new Error("لم يعِد المزود معرّف مهمة task_id في الاستجابة.");
            status.textContent = "تم إرسال المهمة — معرّفها: " + mmId + " — يبدأ الاستطلاع…";
            await pollJob(block, { headers: headers, pollEndpoint: block.dataset.pollEndpoint, pollInterval: block.dataset.pollInterval || "10000", maxPoll: block.dataset.maxPoll || "900000", jobId: mmId, pollCtx: { id: mmId }, parsePoll: parseMinimax });
            runBtn.disabled = false; return;
          } else {
            status.textContent = "صيغة هذا المزود غير مدعومة في الملعب بعد."; runBtn.disabled = false; return;
          }

          var res = await doFetch(url, { method: method, headers: headers, body: body });
          var text = await res.text();
          if (!res.ok) throw new Error("HTTP " + res.status + ": " + text.slice(0, 500));
          var data = null;
          try { data = JSON.parse(text); } catch (e) {}
          if (data) renderSyncResult(block, format, data, text, res, ctx);
          else { output.textContent = text.slice(0, 2000); output.classList.remove("hidden"); }
          status.textContent = "تم التوليد.";
        } catch (e) {
          error.classList.remove("hidden");
          if (e instanceof TypeError) error.textContent = corsMessage();
          else if (String(e.message || "").indexOf("HTTP ") === 0) {
            var m = String(e.message).match(/^HTTP (\d+): ([\s\S]*)$/);
            error.textContent = m ? httpError(parseInt(m[1], 10), m[2]) : String(e.message);
          } else error.textContent = "فشل التوليد: " + String(e.message || e);
          status.textContent = "لم يكتمل التوليد.";
        } finally {
          runBtn.disabled = false;
        }
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
