/* Directory Agent, pass 2 — tool loop in the spirit of Claude Code.
   This is a reimplementation of a loop structure only (visible plan,
   tool call, observed result, adaptation, permission before key use,
   stop on success or user stop). No Claude Code text or prompts are
   copied here, and this site has no model of its own.
   Loop, in order:
   1. PLAN MODE FIRST: "اسأل الوكيل" only searches locally and
      builds a numbered plan (todo list). Nothing that uses a key
      runs before the visitor presses "ابدأ التنفيذ".
   2. EXECUTION LOOP: one step at a time. Each step shows its tool
      name, its inputs, and its observed result in the tool log,
      then the plan updates. On an error the loop adapts (it does
      NOT blindly retry with the same key) and continues with the
      local results. A stop button halts the loop immediately, and
      a hard cap of 8 steps prevents an endless loop or quota burn.
      The loop stops on task success or on user stop only.
   Tools (browser equivalents of a coding agent's tools):
   - search_directory: search the local directory index (Glob/Grep
     equivalent). No key, no network.
   - read_entry: read one entry in full from the local index (Read
     equivalent). No key, no network.
   - get_key_link: the entry's official key link (no key is sent).
   - brain_call: optional reasoning by a visitor-key OpenAI-compatible
     chat model (the only step that uses a key, and only after plan
     approval). The answer shown is that provider model's output.
   - execute_runtime: prepare a handoff task for the existing
     execution runtime (Bash equivalent). It stores the task in
     sessionStorage and shows a button to the detail page; it never
     auto-submits and never invents a request format.
   - todo_write: the visible numbered plan list itself, updated as
     steps complete.
   - ask_user: a clarification question when the goal is ambiguous
     (no match, or matches in more than one category). The loop
     pauses there and waits for the visitor to rephrase and re-plan.
   Honest differences from a coding agent, stated on the page too:
   there are no real subagents in the browser, no Bash, and no
   access to the visitor's files. The tools above are the browser
   equivalents, and the directory index is the only "codebase".
   Keys: the brain key goes only to the brain provider's own
   endpoint, only after plan approval. It is never sent to this
   site (there is no server), never reused for a different target
   provider, and by default lives only in page memory; localStorage
   is used only when the visitor checks the explicit "remember in
   this browser only" box, under "ai-api-key:<provider-id>".
   Token figures are ESTIMATES (ceil(characters / 4)), never a
   provider count. Local recommendations never invent an entry. */
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase(); }

  var MAX_STEPS = 8;

  // Category keyword groups. A group only scores when one of its
  // distinctive keywords appears in the goal; generic words like
  // "text" or "generate" alone do not score, so a goal about
  // generating images does not accidentally rank chat first.
  var CATEGORY_KEYWORDS = {
    "chat-text": ["محادثة", "دردشة", "chat", "conversation", "llm", "نموذج لغوي", "روبوت محادثة", "chatbot"],
    "image": ["صورة", "صور", "رسم", "image", "picture", "illustration", "توليد صورة", "توليد صور"],
    "video": ["فيديو", "video", "مقطع متحرك", "animation", "تحريك"],
    "audio": ["صوت", "صوتي", "كلام", "نطق", "audio", "voice", "speech", "موسيقى", "music", "tts", "stt", "نسخ صوتي", "تحويل الكلام", "تحويل الصوت"],
    "embeddings": ["تضمين", "embedding", "بحث دلالي", "semantic", "متجه", "vector", "تشابه نصوص"],
    "vision": ["رؤية", "تحليل صورة", "وصف صورة", "vision", "ocr", "تعرف على الصور", "قراءة صورة"],
    "code": ["كود", "برمجة", "code", "programming", "كتابة كود", "مراجعة كود"],
    "nlp": ["ترجمة", "translate", "translation", "تلخيص", "summar", "معالجة لغة", "nlp"],
    "multimodal": ["متعدد الوسائط", "multimodal", "نص وصورة", "صورة ونص"],
    "open-hosted": ["مفتوح المصدر", "open source", "open-source", "استضافة مجانية", "نماذج مفتوحة"]
  };

  function matchGoal(goal, index) {
    var g = norm(goal);
    if (!g.trim()) return { matches: [], reasons: {}, matchedGroups: [] };
    var matchedGroups = [];
    Object.keys(CATEGORY_KEYWORDS).forEach(function (cat) {
      var hits = CATEGORY_KEYWORDS[cat].filter(function (kw) { return g.indexOf(norm(kw)) !== -1; });
      if (hits.length) matchedGroups.push({ category: cat, hits: hits });
    });
    var groupByCat = {};
    matchedGroups.forEach(function (mg) { groupByCat[mg.category] = mg.hits; });
    var goalTokens = g.split(/[\s،,؛:!?؟.()\[\]{}"']+/).filter(function (t) { return t.length > 1; });
    function entryScore(entry) {
      var score = 0;
      var reasons = [];
      var catHits = groupByCat[entry.category] || [];
      if (catHits.length) {
        score += 10 * catHits.length;
        reasons.push("يطابق فئة «" + (entry.category_label || entry.category) + "» عبر: " + catHits.join("، "));
      }
      var hay = norm([entry.name, entry.provider, entry.description, (entry.tags || []).join(" "), (entry.models || []).join(" ")].join(" "));
      var overlap = 0;
      goalTokens.forEach(function (tok) { if (hay.indexOf(tok) !== -1) overlap += 1; });
      if (overlap) { score += Math.min(overlap, 5); reasons.push("كلمات من هدفك ظهرت في وصف المزود أو وسومه"); }
      if (entry.status === "موثق جزئيا") { score += 2; reasons.push("موثق جزئيا من مصدر رسمي"); }
      if (entry.has_runtime) { score += 3; reasons.push("له بيئة تنفيذ في المتصفح"); }
      return { score: score, reasons: reasons };
    }
    var scored = index.map(function (entry) {
      var r = entryScore(entry);
      return { entry: entry, score: r.score, reasons: r.reasons };
    }).filter(function (s) {
      var hasCat = (groupByCat[s.entry.category] || []).length > 0;
      var hay = norm([s.entry.name, s.entry.provider, s.entry.description, (s.entry.tags || []).join(" "), (s.entry.models || []).join(" ")].join(" "));
      var overlap = 0;
      goalTokens.forEach(function (tok) { if (hay.indexOf(tok) !== -1) overlap += 1; });
      return hasCat || overlap >= 3;
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.entry.has_runtime ? 1 : 0) !== (a.entry.has_runtime ? 1 : 0)) return (b.entry.has_runtime ? 1 : 0) - (a.entry.has_runtime ? 1 : 0);
      return String(a.entry.name).localeCompare(String(b.entry.name));
    });
    var top = scored.slice(0, 3);
    var reasons = {};
    top.forEach(function (s) { reasons[s.entry.id] = s.reasons; });
    return { matches: top.map(function (s) { return s.entry; }), reasons: reasons, matchedGroups: matchedGroups };
  }

  // Plan builder: plan mode, no execution, no key use. The plan is
  // capped at MAX_STEPS; ask_user appears when the goal is ambiguous
  // (no match, or matches in more than one category) and the loop
  // pauses there instead of guessing.
  function buildPlan(goal, matches, hasBrain, matchedGroups) {
    var steps = [];
    function push(tool, label, input) { steps.push({ tool: tool, label: label, input: input, status: "pending", observation: "" }); }
    push("search_directory", "بحث في فهرس الدليل عن هدفك", goal);
    var ambiguous = !matches.length || (matchedGroups && matchedGroups.length > 1);
    if (ambiguous) {
      push("ask_user", "سؤال توضيحي للزائر", goal);
      if (!matches.length) return steps;
    }
    var top = matches[0];
    push("read_entry", "قراءة إدخال التوصية الأولى كاملة", top.id);
    push("get_key_link", "رابط المفتاح الرسمي للتوصية الأولى", top.id);
    if (hasBrain) push("brain_call", "استدعاء نموذج العقل (بمفتاحك، بعد موافقتك فقط)", "مزود العقل المختار + معرّف النموذج");
    if (top.has_runtime) push("execute_runtime", "تجهيز مهمة لبيئة التنفيذ (دون إرسال تلقائي)", top.id);
    push("todo_write", "تحديث قائمة المهام وإغلاق الخطة", "وضع علامة مكتمل على الخطوات المنفذة");
    return steps.slice(0, MAX_STEPS);
  }

  // Pure execution loop. handlers[tool](step) returns
  // {observation, link?, failed?, adaptation?, paused?}.
  // shouldStop() is checked before every step. onStep(step) is
  // called after every settled step so the UI can log and render.
  // A failure never retries the same tool: it records an adaptation
  // and continues with the local results. The loop stops on success,
  // on user stop, on pause (ask_user), or at the step cap.
  async function runLoop(plan, handlers, shouldStop, onStep) {
    var executed = 0;
    var adaptations = [];
    function markRest(status) {
      plan.forEach(function (s) { if (s.status === "pending") { s.status = status; } });
    }
    for (var i = 0; i < plan.length; i++) {
      if (shouldStop && shouldStop()) {
        markRest("skipped");
        return { outcome: "stopped", executed: executed, adaptations: adaptations };
      }
      if (executed >= MAX_STEPS) {
        markRest("skipped");
        return { outcome: "capped", executed: executed, adaptations: adaptations };
      }
      var step = plan[i];
      step.status = "running";
      try {
        var res = await handlers[step.tool](step);
        executed += 1;
        if (res && res.paused) {
          step.status = "awaiting";
          step.observation = res.observation || "";
          if (onStep) onStep(step);
          return { outcome: "paused", executed: executed, adaptations: adaptations };
        }
        if (res && res.failed) {
          step.status = "failed";
          step.observation = res.observation || "";
          if (res.link) step.link = res.link;
          adaptations.push(res.adaptation || ("فشل " + step.tool + " — المتابعة بالنتائج المحلية دون إعادة المحاولة بالمفتاح نفسه"));
        } else {
          step.status = "done";
          step.observation = res ? (res.observation || "") : "";
          if (res && res.link) step.link = res.link;
          if (res && res.adaptation) adaptations.push(res.adaptation);
        }
      } catch (e) {
        executed += 1;
        step.status = "failed";
        step.observation = String((e && e.message) || e);
        adaptations.push("فشل " + step.tool + " — المتابعة بالنتائج المحلية دون إعادة المحاولة بالمفتاح نفسه");
      }
      if (onStep) onStep(step);
    }
    return { outcome: "success", executed: executed, adaptations: adaptations };
  }

  // Exposed for functional testing (Node harness) and for nothing else.
  if (typeof window !== "undefined") {
    window.__agentMatch = matchGoal;
    window.__agentPlan = buildPlan;
    window.__agentLoop = runLoop;
    window.__agentMaxSteps = MAX_STEPS;
  }

  function httpError(status, text) {
    if (status === 401) return "خطأ 401: مفتاح خاطئ أو غير مصرح. تحقق من المفتاح ومن أن حسابك لدى المزود مفعّل. لا تعيد المحاولة بالمفتاح نفسه دون تصحيحه.";
    if (status === 403) return "خطأ 403: المفتاح بلا صلاحية لهذا النموذج أو نقطة النهاية، أو النقطة خاطئة. راجع توثيق المزود.";
    if (status === 429) return "خطأ 429: تجاوزت حد الطلبات لدى المزود. انتظر قليلاً ثم أعد المحاولة، ولا تعيد الإرسال بسرعة.";
    if (status === 400) return "خطأ 400: حقل ناقص أو خاطئ في الطلب (معرّف النموذج). راجع رسالة المزود أدناه.";
    return "خطأ HTTP " + status + ": " + (text || "").slice(0, 500);
  }
  function corsMessage() {
    return "تعذر الاتصال بالمزود من متصفحك. السبب الأرجح: المزود لا يسمح بطلبات CORS المباشرة من المتصفح. هذا ليس خطأ في المفتاح بالضرورة. جرّب من خادمك الخاص أو من أداة API. لم يُرسل مفتاحك إلى أي خادم تابع لهذا الموقع.";
  }

  function init() {
    var goalEl = document.getElementById("agent-goal");
    if (!goalEl) return; // Not the agent page; nothing to wire.
    var indexEl = document.getElementById("agent-index");
    var index = [];
    try { index = JSON.parse(indexEl ? indexEl.textContent : "[]"); } catch (e) { index = []; }
    var brainSel = document.getElementById("agent-brain");
    var keyEl = document.getElementById("agent-key");
    var modelEl = document.getElementById("agent-model");
    var rememberEl = document.getElementById("agent-remember");
    var statsEl = document.getElementById("agent-stats");
    var recsEl = document.getElementById("agent-recs");
    var answerEl = document.getElementById("agent-answer");
    var statusEl = document.getElementById("agent-status");
    var errorEl = document.getElementById("agent-error");
    var historyEl = document.getElementById("agent-history");
    var askBtn = document.getElementById("agent-ask");
    var clearBtn = document.getElementById("agent-clear");
    var fromEl = document.getElementById("agent-from-provider");
    var planEl = document.getElementById("agent-plan");
    var planStatusEl = document.getElementById("agent-plan-status");
    var startBtn = document.getElementById("agent-start");
    var stopBtn = document.getElementById("agent-stop");
    var logEl = document.getElementById("agent-tool-log");

    // Loop state. approved is the permission gate: no key-using step
    // runs until the visitor presses "ابدأ التنفيذ" on a shown plan.
    var state = { goal: "", matches: [], reasons: {}, matchedGroups: [], plan: null, approved: false, stopped: false, running: false };

    function brainId() { return brainSel.options[brainSel.selectedIndex] ? brainSel.options[brainSel.selectedIndex].dataset.providerId : ""; }
    function storeKey() { return "ai-api-key:" + brainId(); }
    function loadKey() {
      try {
        var saved = localStorage.getItem(storeKey());
        if (saved) { keyEl.value = saved; if (rememberEl) rememberEl.checked = true; }
      } catch (e) {}
    }
    loadKey();
    if (brainSel) brainSel.addEventListener("change", loadKey);
    if (rememberEl) rememberEl.addEventListener("change", function () {
      try { if (rememberEl.checked && keyEl.value) localStorage.setItem(storeKey(), keyEl.value); else localStorage.removeItem(storeKey()); } catch (e) {}
    });
    if (keyEl) keyEl.addEventListener("input", function () {
      try { if (rememberEl && rememberEl.checked) localStorage.setItem(storeKey(), keyEl.value); } catch (e) {}
    });
    var showBtn = document.getElementById("agent-show");
    if (showBtn) showBtn.addEventListener("click", function () {
      var show = keyEl.type === "password";
      keyEl.type = show ? "text" : "password";
      showBtn.textContent = show ? "إخفاء" : "إظهار";
    });
    var clearKeyBtn = document.getElementById("agent-clear-key");
    if (clearKeyBtn) clearKeyBtn.addEventListener("click", function () {
      keyEl.value = "";
      try { localStorage.removeItem(storeKey()); } catch (e) {}
      if (rememberEl) rememberEl.checked = false;
    });

    // ?provider=<id> from a detail page: show that entry as the
    // "you came from" card. It never changes the ranking rule.
    var fromEntry = null;
    try {
      var pid = new URLSearchParams(window.location.search).get("provider");
      if (pid) fromEntry = index.filter(function (e) { return e.id === pid; })[0] || null;
    } catch (e) {}
    if (fromEntry && fromEl) {
      fromEl.innerHTML = "";
      var p = document.createElement("p");
      p.className = "text-sm";
      p.appendChild(document.createTextNode("أنت تسأل عن: "));
      var a = document.createElement("a");
      a.className = "font-bold text-blue-600";
      a.href = "/apis/" + fromEntry.id + "/";
      a.textContent = fromEntry.name + " (" + fromEntry.provider + ")";
      p.appendChild(a);
      fromEl.appendChild(p);
      fromEl.classList.remove("hidden");
    }

    function renderRecs(matches, reasons) {
      recsEl.innerHTML = "";
      if (!matches.length) {
        var empty = document.createElement("p");
        empty.className = "text-sm";
        empty.textContent = "لا توجد مطابقة في الدليل لهذا الهدف. أعد صياغة الهدف بكلمات أدق، مثل نوع المخرجات (صورة، صوت، نص، فيديو) أو المهمة (ترجمة، تضمين، نسخ صوتي). التوصيات هنا من فهرس الدليل المحلي فقط، ولا يُخترع أي مزود.";
        recsEl.appendChild(empty);
        return;
      }
      matches.forEach(function (entry) {
        var card = document.createElement("article");
        card.className = "rounded-2xl border border-slate-200 p-3 dark:border-slate-700";
        var h = document.createElement("h3");
        h.className = "font-bold";
        h.textContent = entry.name + " — " + entry.provider;
        card.appendChild(h);
        var meta = document.createElement("p");
        meta.className = "mt-1 text-sm text-slate-500";
        meta.textContent = (entry.category_label || entry.category) + " · نوع المجانية: " + entry.free_type + " · الحد: " + entry.free_limit + " · الحالة: " + entry.status + (entry.has_runtime ? " · له بيئة تنفيذ" : " · بلا بيئة تنفيذ");
        card.appendChild(meta);
        var why = document.createElement("p");
        why.className = "mt-1 text-sm";
        why.textContent = "لماذا يطابق؟ " + (reasons[entry.id] || []).join("؛ ");
        card.appendChild(why);
        var links = document.createElement("div");
        links.className = "mt-3 flex flex-wrap gap-2";
        var keyA = document.createElement("a");
        keyA.className = "btn-secondary";
        keyA.href = entry.key_url;
        keyA.target = "_blank";
        keyA.rel = "noopener";
        keyA.textContent = entry.key_url_kind === "official_site" ? "صفحة المزود الرسمية ↗" : "احصل على المفتاح ↗";
        links.appendChild(keyA);
        var runA = document.createElement("a");
        runA.className = "btn-secondary";
        runA.href = "/apis/" + entry.id + "/";
        runA.textContent = entry.has_runtime ? "فتح بيئة التنفيذ" : "فتح صفحة التفاصيل";
        links.appendChild(runA);
        if (entry.has_runtime) {
          var hand = document.createElement("button");
          hand.type = "button";
          hand.className = "btn-primary";
          hand.textContent = "أرسل مهمة إلى بيئة التنفيذ";
          hand.addEventListener("click", function () {
            try {
              sessionStorage.setItem("agent-task", JSON.stringify({ provider: entry.id, goal: goalEl.value.trim(), prompt: goalEl.value.trim() }));
            } catch (e) {}
            window.location.href = "/apis/" + entry.id + "/";
          });
          links.appendChild(hand);
        }
        card.appendChild(links);
        recsEl.appendChild(card);
      });
    }

    async function showStats(goal) {
      if (!statsEl) return;
      try {
        if (window.__modelRuntime && window.__modelRuntime.analyse) {
          var r = await window.__modelRuntime.analyse(goal);
          statsEl.textContent = "تحليل محلي للهدف: " + r.chars + " حرفاً · " + r.words + " كلمة · تقدير " + r.tokens + " رمزاً (تقديري، وليس رمز المزود) · المحرك: " + (r.engine === "wasm" ? "WebAssembly" : "بديل JavaScript");
        } else {
          var chars = Array.from(goal).length;
          var words = goal.trim() ? goal.trim().split(/\s+/).length : 0;
          statsEl.textContent = "تحليل محلي للهدف: " + chars + " حرفاً · " + words + " كلمة · تقدير " + (chars === 0 ? 0 : Math.ceil(chars / 4)) + " رمزاً (تقديري، وليس رمز المزود) · المحرك: بديل JavaScript (WebAssembly غير متاح)";
        }
      } catch (e) {
        statsEl.textContent = "تعذر التحليل المحلي للهدف؛ التوصيات أدناه لا تعتمد عليه.";
      }
      statsEl.classList.remove("hidden");
    }

    var STATUS_AR = { pending: "قيد الانتظار", running: "جارٍ", done: "مكتمل", failed: "فشل", skipped: "متخطى", awaiting: "بانتظارك" };
    function renderPlan() {
      if (!planEl) return;
      planEl.innerHTML = "";
      if (!state.plan) {
        var hint = document.createElement("p");
        hint.className = "text-sm text-slate-500";
        hint.textContent = "اكتب هدفك واضغط «اسأل الوكيل» أولاً: سيُبنى هنا مخطط مرقّم قبل أي تنفيذ، ولن يعمل أي شيء بمفتاحك قبل أن تضغط «ابدأ التنفيذ».";
        planEl.appendChild(hint);
        return;
      }
      state.plan.forEach(function (step, i) {
        var li = document.createElement("li");
        li.className = "rounded-2xl border border-slate-200 p-3 dark:border-slate-700";
        var title = document.createElement("p");
        title.className = "text-sm font-bold";
        title.textContent = (i + 1) + ". " + step.tool + " — " + step.label + " · " + (STATUS_AR[step.status] || step.status);
        li.appendChild(title);
        var input = document.createElement("p");
        input.className = "mt-1 text-sm text-slate-500";
        input.textContent = "المدخلات: " + step.input;
        li.appendChild(input);
        if (step.observation) {
          var obs = document.createElement("p");
          obs.className = "mt-1 text-sm";
          obs.textContent = "النتيجة المرصودة: " + step.observation;
          li.appendChild(obs);
        }
        planEl.appendChild(li);
      });
    }
    function logEntry(step) {
      if (!logEl) return;
      var div = document.createElement("div");
      div.className = "rounded-2xl border border-slate-200 p-3 dark:border-slate-700";
      var h = document.createElement("h3");
      h.className = "text-sm font-bold";
      h.textContent = step.tool + " — " + step.label + " · " + (STATUS_AR[step.status] || step.status);
      div.appendChild(h);
      var inp = document.createElement("p");
      inp.className = "mt-1 text-sm text-slate-500";
      inp.textContent = "المدخلات: " + step.input;
      div.appendChild(inp);
      if (step.observation) {
        var obs = document.createElement("p");
        obs.className = "mt-1 text-sm";
        obs.textContent = "النتيجة المرصودة: " + step.observation;
        div.appendChild(obs);
      }
      if (step.link) {
        var lk = document.createElement("a");
        lk.className = "btn-secondary mt-2";
        lk.href = step.link.href;
        lk.textContent = step.link.text;
        if (step.link.external) { lk.target = "_blank"; lk.rel = "noopener"; }
        div.appendChild(lk);
      }
      logEl.appendChild(div);
    }
    function setPlanStatus(text) {
      if (!planStatusEl) return;
      planStatusEl.textContent = text;
      planStatusEl.classList.remove("hidden");
    }
    function resetLoopUi() {
      state.plan = null;
      state.approved = false;
      state.stopped = false;
      state.running = false;
      if (logEl) logEl.innerHTML = "";
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = true;
      renderPlan();
    }

    async function callBrain(goal, matches) {
      var brainEndpoint = brainSel.value;
      var key = keyEl.value.trim();
      var model = modelEl.value.trim();
      if (!brainEndpoint || !key || !model) throw new Error("خطوة العقل تحتاج مزود العقل ومفتاحه ومعرّف النموذج؛ بدونها تُستخدم التوصيات المحلية وحدها.");
      var system = "أنت مساعد داخل دليل APIs لنماذج الذكاء الاصطناعي. أجب بالعربية فقط، واستخدم فقط التوصيات التالية من الدليل، ولا تخترع أي مزود أو حد أو رابط أو معرّف نموذج. هدف الزائر: " + goal + "\nالتوصيات:\n" + matches.map(function (e, i) {
        return (i + 1) + ". " + e.name + " (" + e.provider + ") — نوع المجانية: " + e.free_type + " — الحد: " + e.free_limit + " — الحالة: " + e.status + " — " + (e.has_runtime ? "له بيئة تنفيذ" : "بلا بيئة تنفيذ");
      }).join("\n") + (matches.length ? "" : "\nلا توجد توصية محلية مطابقة؛ قل ذلك صراحة واقترح إعادة صياغة الهدف، ولا تخترع مزوداً.");
      var res = await fetch(brainEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({ model: model, messages: [{ role: "system", content: system }, { role: "user", content: goal }] })
      });
      var text = await res.text();
      if (!res.ok) throw new Error("HTTP " + res.status + ": " + text.slice(0, 500));
      var data = JSON.parse(text);
      var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
      if (!content) throw new Error("لم يعِد المزود نصاً في الاستجابة.");
      return content;
    }
    function showBrainAnswer(content, goal) {
      answerEl.textContent = content;
      answerEl.classList.remove("hidden");
      if (historyEl) {
        var item = document.createElement("div");
        item.className = "rounded-2xl border border-slate-200 p-3 dark:border-slate-700";
        var q = document.createElement("p");
        q.className = "text-sm font-bold";
        q.textContent = "هدف: " + goal;
        item.appendChild(q);
        var a = document.createElement("p");
        a.className = "mt-1 text-sm whitespace-pre-wrap";
        a.textContent = content;
        item.appendChild(a);
        historyEl.prepend(item);
      }
    }

    // PLAN MODE: "اسأل الوكيل" only searches locally and builds the
    // plan. It never calls the brain and never uses a key.
    if (askBtn) askBtn.addEventListener("click", async function () {
      var goal = goalEl.value.trim();
      if (statusEl) { statusEl.textContent = ""; statusEl.classList.add("hidden"); }
      if (errorEl) { errorEl.textContent = ""; errorEl.classList.add("hidden"); }
      if (!goal) {
        if (statusEl) { statusEl.textContent = "اكتب هدفك أولاً: ما الذي تريد بناءه؟"; statusEl.classList.remove("hidden"); }
        return;
      }
      if (state.running) { setPlanStatus("حلقة تنفيذ جارية الآن؛ انتظر اكتمالها أو اضغط «إيقاف الحلقة»."); return; }
      var result = matchGoal(goal, index);
      state.goal = goal;
      state.matches = result.matches;
      state.reasons = result.reasons;
      state.matchedGroups = result.matchedGroups;
      renderRecs(result.matches, result.reasons);
      await showStats(goal);
      var hasBrain = !!(brainSel.value && keyEl.value.trim() && modelEl.value.trim());
      state.plan = buildPlan(goal, result.matches, hasBrain, result.matchedGroups);
      state.approved = false;
      state.stopped = false;
      if (logEl) logEl.innerHTML = "";
      renderPlan();
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      var note = "الخطة جاهزة في وضع الخطة — راجع خطواتها أعلاه، ثم اضغط «ابدأ التنفيذ» للسماح بالتنفيذ. لن يعمل أي شيء بمفتاحك قبل موافقتك، والحد الأقصى للحلقة 8 خطوات.";
      if (!result.matches.length) note += " الخطة تتضمن سؤالاً توضيحياً لأن هدفك بلا مطابقة في الدليل؛ عند التنفيذ ستتوقف الحلقة عند السؤال بانتظار إعادة صياغتك.";
      else if (result.matchedGroups.length > 1) note += " الخطة تتضمن سؤالاً توضيحياً لأن هدفك يطابق أكثر من فئة؛ عند التنفيذ ستتوقف الحلقة عند السؤال بانتظار تحديدك.";
      else if (!hasBrain) note += " خطوة العقل غير موجودة في الخطة لأنك لم تدخل مفتاح العقل ومعرّف النموذج؛ التوصيات المحلية وحدها ستُنفذ.";
      setPlanStatus(note);
    });

    // EXECUTION LOOP: only after the visitor presses "ابدأ التنفيذ".
    if (startBtn) startBtn.addEventListener("click", async function () {
      if (!state.plan) { setPlanStatus("لا توجد خطة بعد: اكتب هدفك واضغط «اسأل الوكيل» أولاً."); return; }
      if (state.running) return;
      state.approved = true;
      state.stopped = false;
      state.running = true;
      startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (errorEl) { errorEl.textContent = ""; errorEl.classList.add("hidden"); }
      setPlanStatus("الحلقة تعمل الآن خطوة بخطوة؛ كل خطوة تظهر أداتها ومدخلاتها ونتيجتها المرصودة أدناه. اضغط «إيقاف الحلقة» في أي وقت لإيقافها فوراً.");
      var top = state.matches[0] || null;
      var handlers = {
        search_directory: async function () {
          return { observation: state.matches.length ? ("وجد " + state.matches.length + " توصية: " + state.matches.map(function (e) { return e.name; }).join("، ")) : "لم يجد أي مطابقة في فهرس الدليل لهذا الهدف." };
        },
        read_entry: async function () {
          if (!top) return { failed: true, observation: "لا توجد توصية لقراءتها.", adaptation: "لا توجد توصية لقراءتها — المتابعة بسؤال توضيحي بدلاً من اختراع إدخال." };
          return { observation: top.name + " (" + top.provider + ") — " + (top.category_label || top.category) + " · نوع المجانية: " + top.free_type + " · الحد: " + top.free_limit + " · الحالة: " + top.status + " · " + (top.description || "") };
        },
        get_key_link: async function () {
          if (!top) return { failed: true, observation: "لا توجد توصية لرابط مفتاحها." };
          return { observation: "رابط المفتاح الرسمي: " + top.key_url, link: { href: top.key_url, text: top.key_url_kind === "official_site" ? "صفحة المزود الرسمية ↗" : "احصل على المفتاح ↗", external: true } };
        },
        brain_call: async function () {
          try {
            var content = await callBrain(state.goal, state.matches);
            showBrainAnswer(content, state.goal);
            return { observation: "أجاب نموذج العقل (نصه الكامل في قسم «إجابة نموذج العقل» أعلاه، " + Array.from(content).length + " حرفاً). هذه إجابة ذلك النموذج، وليست نموذجاً خاصاً بهذا الموقع." };
          } catch (e) {
            var msg;
            if (e instanceof TypeError) msg = corsMessage();
            else if (String(e.message || "").indexOf("HTTP ") === 0) {
              var m = String(e.message).match(/^HTTP (\d+):/);
              msg = m ? httpError(parseInt(m[1], 10), String(e.message)) : String(e.message);
            } else msg = String(e.message || e);
            if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove("hidden"); }
            return { failed: true, observation: msg, adaptation: "تكيّف: فشل استدعاء العقل، فلا إعادة محاولة بالمفتاح نفسه؛ الحلقة تتابع بالتوصيات المحلية وروابط المفاتيح الرسمية." };
          }
        },
        execute_runtime: async function () {
          if (!top || !top.has_runtime) return { failed: true, observation: "التوصية الأولى بلا بيئة تنفيذ، فلا مهمة تُجهز لها." };
          try { sessionStorage.setItem("agent-task", JSON.stringify({ provider: top.id, goal: state.goal, prompt: state.goal })); } catch (e) {}
          return { observation: "مهمة جاهزة لبيئة تنفيذ " + top.name + ": عند فتح صفحتها سيُملأ حقل الطلب بهدفك مرة واحدة، ولن يُضغط توليد نيابة عنك أبداً.", link: { href: "/apis/" + top.id + "/", text: "فتح بيئة التنفيذ" } };
        },
        todo_write: async function () {
          var done = state.plan.filter(function (s) { return s.status === "done"; }).length;
          return { observation: "قائمة المهام محدثة: " + done + " من " + state.plan.length + " خطوة مكتملة حتى الآن." };
        },
        ask_user: async function () {
          var q;
          if (!state.matches.length) q = "سؤال توضيحي: هدفك بلا مطابقة في الدليل. أعد صياغة هدفك بكلمات أدق (نوع المخرجات أو المهمة)، ثم اضغط «اسأل الوكيل» لبناء خطة جديدة. الحلقة متوقفة هنا بانتظارك، ولم يُستخدم أي مفتاح.";
          else q = "سؤال توضيحي: هدفك يطابق أكثر من فئة (" + state.matchedGroups.map(function (g) { return g.category; }).join("، ") + "). أي فئة تقصد بالضبط؟ أعد صياغة هدفك بكلمة أدق، ثم اضغط «اسأل الوكيل» لبناء خطة جديدة. الحلقة متوقفة هنا بانتظارك.";
          return { paused: true, observation: q };
        }
      };
      var outcome = await runLoop(state.plan, handlers, function () { return state.stopped; }, function (step) { logEntry(step); renderPlan(); });
      state.running = false;
      if (stopBtn) stopBtn.disabled = true;
      renderPlan();
      if (outcome.outcome === "success") setPlanStatus("اكتملت الخطة: " + outcome.executed + " خطوة منفذة. " + (outcome.adaptations.length ? "تكيّفات حدثت: " + outcome.adaptations.join(" ") : ""));
      else if (outcome.outcome === "stopped") setPlanStatus("أوقفتَ الحلقة: " + outcome.executed + " خطوة منفذة قبل الإيقاف، والخطوات المتبقية متخطاة. لا شيء آخر سيعمل حتى تبني خطة جديدة.");
      else if (outcome.outcome === "capped") setPlanStatus("وصلت الحلقة الحد الأقصى (8 خطوات) وتوقفت؛ الخطوات المتبقية متخطاة حمايةً من حلقة لا نهائية أو استهلاك حصة.");
      else if (outcome.outcome === "paused") setPlanStatus("الحلقة متوقفة بانتظار توضيحك (خطوة ask_user). أعد صياغة هدفك واضغط «اسأل الوكيل» لبناء خطة جديدة؛ لم يُستخدم أي مفتاح في خطوة السؤال.");
      if (statusEl) { statusEl.textContent = "نتيجة الحلقة أعلاه في سجل الأدوات؛ التوصيات المحلية ما زالت ظاهرة، وإجابة العقل (إن وُجدت) في قسمها الخاص."; statusEl.classList.remove("hidden"); }
    });

    if (stopBtn) stopBtn.addEventListener("click", function () {
      if (!state.running) return;
      state.stopped = true;
      setPlanStatus("جارٍ إيقاف الحلقة… ستتوقف قبل الخطوة التالية مباشرة، ولن تُنفذ أي خطوة جديدة بعد ضغطك الإيقاف.");
    });

    if (clearBtn) clearBtn.addEventListener("click", function () {
      if (recsEl) recsEl.innerHTML = "";
      if (answerEl) { answerEl.textContent = ""; answerEl.classList.add("hidden"); }
      if (historyEl) historyEl.innerHTML = "";
      if (statusEl) { statusEl.textContent = ""; statusEl.classList.add("hidden"); }
      if (errorEl) { errorEl.textContent = ""; errorEl.classList.add("hidden"); }
      resetLoopUi();
      setPlanStatus("مُسحت المحادثة والخطة وسجل الأدوات. اكتب هدفاً جديداً واضغط «اسأل الوكيل» لبناء خطة جديدة.");
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
