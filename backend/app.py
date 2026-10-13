"""ATEET inference API. Model weights are downloaded from Git LFS on first use."""
import base64
import io
import os
import tempfile
import threading
import time
from pathlib import Path

import requests
import torch
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, UnidentifiedImageError

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "12")) * 1024 * 1024

DEFAULT_MODEL_URL = (
    "https://media.githubusercontent.com/media/"
    "kalpasur/ATEET-Monument-Detector/main/best.pt"
)
MODEL_URL = os.getenv("MODEL_URL", DEFAULT_MODEL_URL)
MODEL_PATH = Path(os.getenv("MODEL_PATH", "/opt/models/best.pt"))
YOLOV5_REPO = os.getenv("YOLOV5_REPO", "/opt/yolov5")
DEFAULT_ORIGINS = "https://kalpasur.github.io,http://localhost:8000,http://127.0.0.1:8000"
ALLOWED_ORIGINS = [v.strip() for v in os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if v.strip()]
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}}, methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type"])

_model = None
_model_lock = threading.Lock()
_weights_lock = threading.Lock()


def _download_weights():
    """Fetch the actual LFS object, not the small Git LFS pointer text file."""
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 10_000_000:
        return MODEL_PATH
    with _weights_lock:
        if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 10_000_000:
            return MODEL_PATH
        if not MODEL_URL:
            raise RuntimeError("MODEL_URL is not configured and the model weights are missing.")
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp_path = None
        try:
            with requests.get(MODEL_URL, stream=True, timeout=(20, 180), allow_redirects=True) as response:
                response.raise_for_status()
                with tempfile.NamedTemporaryFile(dir=str(MODEL_PATH.parent), suffix=".download", delete=False) as tmp:
                    temp_path = Path(tmp.name)
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            tmp.write(chunk)
            size = temp_path.stat().st_size
            if size < 10_000_000:
                prefix = temp_path.read_bytes()[:200].decode("utf-8", errors="ignore")
                if "git-lfs.github.com/spec" in prefix:
                    raise RuntimeError("The model URL returned a Git LFS pointer, not the model binary.")
                raise RuntimeError(f"Downloaded model is unexpectedly small ({size} bytes). Check MODEL_URL.")
            temp_path.replace(MODEL_PATH)
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink()
    return MODEL_PATH


def _get_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        if not Path(YOLOV5_REPO, "hubconf.py").exists():
            raise RuntimeError(f"YOLOv5 source not found at {YOLOV5_REPO}. Rebuild the backend image.")
        weights = _download_weights()
        # CPU inference is the default so the API works on a CPU host.
        model = torch.hub.load(YOLOV5_REPO, "custom", path=str(weights), source="local", force_reload=False)
        model.to("cpu")
        model.eval()
        _model = model
    return _model


@app.get("/")
def index():
    return jsonify({
        "service": "ATEET Monument Detector API",
        "health": "/health",
        "predict": "POST /predict (multipart form field: file; optional confidence)",
    })


@app.get("/health")
def health():
    return jsonify({"status": "ok", "model_loaded": _model is not None, "device": "cpu"})


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({"error": "Image exceeds the upload size limit."}), 413


@app.post("/predict")
def predict():
    if "file" not in request.files:
        return jsonify({"error": "Missing image. Send it as multipart form field 'file'."}), 400
    uploaded = request.files["file"]
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Choose an image file first."}), 400

    try:
        raw = uploaded.read()
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        image.load()
    except (UnidentifiedImageError, OSError, ValueError):
        return jsonify({"error": "The uploaded file is not a valid image."}), 400

    try:
        threshold = float(request.form.get("confidence", "0.25"))
    except (TypeError, ValueError):
        return jsonify({"error": "Confidence must be a number between 0.05 and 0.95."}), 400
    if not 0.05 <= threshold <= 0.95:
        return jsonify({"error": "Confidence must be between 0.05 and 0.95."}), 400

    try:
        model = _get_model()
        model.conf = threshold
        start = time.perf_counter()
        with torch.inference_mode():
            results = model([image])
        inference_ms = round((time.perf_counter() - start) * 1000, 1)

        table = results.pandas().xyxy[0]
        detections = []
        for row in table.to_dict(orient="records"):
            detections.append({
                "name": str(row.get("name", "object")),
                "class_id": int(row.get("class", -1)),
                "confidence": float(row.get("confidence", 0.0)),
                "box": {
                    "xmin": float(row.get("xmin", 0.0)),
                    "ymin": float(row.get("ymin", 0.0)),
                    "xmax": float(row.get("xmax", 0.0)),
                    "ymax": float(row.get("ymax", 0.0)),
                },
            })

        results.render()
        rendered = Image.fromarray(results.ims[0]).convert("RGB")
        output = io.BytesIO()
        rendered.save(output, format="JPEG", quality=90, optimize=True)
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        return jsonify({"image": encoded, "detections": detections, "inference_ms": inference_ms})
    except Exception as exc:
        app.logger.exception("ATEET inference failed")
        # Keep the browser response useful without exposing server paths or stack traces.
        return jsonify({"error": "Model inference failed. Check the backend deployment logs for details.", "detail": str(exc)[:240]}), 500
