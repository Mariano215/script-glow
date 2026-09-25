# Chatterbox voice server. The default CPU build skips about 3 GB of NVIDIA libraries.
# For an NVIDIA card: --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124
FROM python:3.12-slim
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
WORKDIR /app
# libgomp: the OpenMP runtime torchaudio needs on the CPU build.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.6.0 torchaudio==2.6.0 --index-url $TORCH_INDEX
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py test_server.py ./
ENV VOICES_DIR=/voices HF_HOME=/hf-cache
CMD ["python", "server.py"]
