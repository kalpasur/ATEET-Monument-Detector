(() => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $("image-input");
  const dropzone = $("dropzone");
  const runButton = $("run-button");
  const runLabel = $("run-button-label");
  const confidence = $("confidence");
  const confidenceValue = $("confidence-value");
  const apiInput = $("api-url");
  const apiFeedback = $("api-feedback");
  let selectedFile = null;
  let previewUrl = null;

  const configuredUrl = (window.ATEET_CONFIG && window.ATEET_CONFIG.API_BASE_URL) || "";
  const savedUrl = (() => { try { return localStorage.getItem("ateet-api-url") || ""; } catch (_) { return ""; } })();
  apiInput.value = (savedUrl || configuredUrl).replace(/\/$/, "");

  function setStatus(text, type = "") {
    const el = $("result-status");
    el.textContent = text;
    el.className = "status-pill" + (type ? " " + type : "");
  }
  function showError(message) {
    $("error-message").textContent = message;
    $("error-message").classList.remove("hidden");
    setStatus("Request failed", "error");
  }
  function clearError() { $("error-message").classList.add("hidden"); }
  function apiBase() { return apiInput.value.trim().replace(/\/$/, ""); }
  function validateFile(file) {
    if (!file) return "Choose an image first.";
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Please choose a JPG, PNG, or WEBP image.";
    if (file.size > 12 * 1024 * 1024) return "This image is larger than 12 MB. Please choose a smaller file.";
    return "";
  }
  function formatSize(bytes) { return bytes < 1024 * 1024 ? (bytes / 1024).toFixed(0) + " KB" : (bytes / (1024 * 1024)).toFixed(2) + " MB"; }

  function chooseFile(file) {
    const error = validateFile(file);
    if (error) { showError(error); return; }
    clearError();
    selectedFile = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    $("file-name").textContent = file.name;
    $("file-size").textContent = formatSize(file.size);
    $("file-info").classList.remove("hidden");
    runButton.disabled = false;
    $("result-stage").innerHTML = "";
    const img = document.createElement("img");
    img.className = "result-image";
    img.src = previewUrl;
    img.alt = "Selected source image preview";
    $("result-stage").appendChild(img);
    setStatus("Image selected", "ready");
    $("metrics").classList.add("hidden");
    $("detection-list-wrap").classList.add("hidden");
  }

  fileInput.addEventListener("change", () => { if (fileInput.files && fileInput.files[0]) chooseFile(fileInput.files[0]); });
  $("clear-file").addEventListener("click", () => {
    selectedFile = null; fileInput.value = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; $("file-info").classList.add("hidden"); runButton.disabled = true;
    $("result-stage").innerHTML = '<div class="empty-state"><div class="scan-art" aria-hidden="true"><span class="scan-corner c1"></span><span class="scan-corner c2"></span><span class="scan-corner c3"></span><span class="scan-corner c4"></span><span class="scan-cross">＋</span><span class="scan-ring"></span></div><h3>Your results will appear here</h3><p>Upload an aerial image and run the model to see the annotated prediction.</p></div>';
    $("metrics").classList.add("hidden"); $("detection-list-wrap").classList.add("hidden"); clearError(); setStatus("Awaiting image");
  });
  ["dragenter", "dragover"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
  dropzone.addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) chooseFile(f); });
  confidence.addEventListener("input", () => { confidenceValue.textContent = Number(confidence.value).toFixed(2); });

  $("save-api").addEventListener("click", async () => {
    const url = apiBase();
    if (url && !/^https?:\/\//i.test(url)) { apiFeedback.textContent = "Enter a complete URL beginning with https://"; return; }
    try { localStorage.setItem("ateet-api-url", url); } catch (_) {}
    apiFeedback.textContent = url ? "Endpoint saved in this browser. Checking connection…" : "Endpoint cleared. Set the backend URL to run inference.";
    if (!url) return;
    try {
      const res = await fetch(url + "/health", { method: "GET" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      apiFeedback.textContent = data.status === "ok" ? "Connected to ATEET inference API." : "Server responded, but did not confirm readiness.";
    } catch (e) {
      apiFeedback.textContent = "Could not reach the API. Check the URL, service status, and CORS settings.";
    }
  });

  function renderDetections(items) {
    const list = $("detection-list");
    list.innerHTML = "";
    items.forEach((item, index) => {
      const row = document.createElement("div"); row.className = "detection-row";
      const info = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = item.name || ("Class " + item.class_id);
      const box = document.createElement("small");
      const b = item.box || {};
      box.textContent = "BOX [" + [b.xmin, b.ymin, b.xmax, b.ymax].map(v => Number(v || 0).toFixed(0)).join(", ") + "]";
      info.append(name, box);
      const score = document.createElement("span"); score.className = "confidence-badge"; score.textContent = (Number(item.confidence || 0) * 100).toFixed(1) + "%";
      row.append(info, score); list.appendChild(row);
    });
    $("list-count").textContent = items.length + (items.length === 1 ? " object" : " objects");
  }

  runButton.addEventListener("click", async () => {
    clearError();
    const base = apiBase();
    if (!base) {
      showError("The frontend is published separately from the model. Open “Inference server settings” below and enter the backend URL after deploying the Python API.");
      document.querySelector(".settings").open = true;
      apiInput.focus();
      return;
    }
    const fileError = validateFile(selectedFile);
    if (fileError) { showError(fileError); return; }
    runButton.disabled = true; runLabel.textContent = "Running inference…"; setStatus("Processing");
    const start = performance.now();
    const form = new FormData();
    form.append("file", selectedFile);
    form.append("confidence", confidence.value);
    try {
      const response = await fetch(base + "/predict", { method: "POST", body: form });
      let data;
      try { data = await response.json(); } catch (_) { throw new Error("The backend returned an unreadable response. Check its deployment logs."); }
      if (!response.ok) throw new Error(data.error || ("Inference failed (HTTP " + response.status + ")."));
      if (!data.image) throw new Error("The backend response did not contain an annotated image.");
      const img = document.createElement("img"); img.className = "result-image"; img.alt = "YOLOv5 monument detection result"; img.src = "data:image/jpeg;base64," + data.image;
      $("result-stage").replaceChildren(img);
      const detections = Array.isArray(data.detections) ? data.detections : [];
      $("detection-count").textContent = String(detections.length);
      $("top-confidence").textContent = detections.length ? (Math.max(...detections.map(d => Number(d.confidence || 0))) * 100).toFixed(1) + "%" : "—";
      $("inference-time").textContent = (data.inference_ms != null ? Number(data.inference_ms) : performance.now() - start).toFixed(0) + " ms";
      $("metrics").classList.remove("hidden"); $("detection-list-wrap").classList.remove("hidden"); renderDetections(detections);
      setStatus(detections.length ? "Detection complete" : "No detections", "ready");
    } catch (err) {
      showError((err && err.message) || "Could not reach the inference server. Verify the API URL and server logs.");
    } finally {
      runButton.disabled = !selectedFile; runLabel.textContent = "Run monument detection";
    }
  });
})();
