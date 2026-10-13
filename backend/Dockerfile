FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    YOLOV5_REPO=/opt/yolov5 \
    MODEL_PATH=/opt/models/best.pt \
    PORT=10000

RUN apt-get update && apt-get install -y --no-install-recommends \
    git libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Pin YOLOv5 to the compatible v6.2 release.
RUN git clone --depth 1 --branch v6.2 \
    https://github.com/ultralytics/yolov5.git /opt/yolov5

WORKDIR /app

COPY backend/requirements.txt /tmp/requirements.txt

RUN python -m pip install --upgrade pip \
    && python -m pip install torch==2.1.2 torchvision==0.16.2 \
       --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install -r /tmp/requirements.txt

# Prevent YOLOv5 Hub from attempting dependency installation at runtime.
RUN sed -i '/check_requirements(ROOT \/ "requirements.txt"/d' \
    /opt/yolov5/hubconf.py

COPY backend/app.py /app/app.py

EXPOSE 10000

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 1 --timeout 300 app:app"]
