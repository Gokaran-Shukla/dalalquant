FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 TZ=Asia/Kolkata
COPY requirements.txt .
# add your broker SDK(s) to EXTRA, e.g. --build-arg EXTRA="kiteconnect"
ARG EXTRA=""
RUN pip install --no-cache-dir -r requirements.txt ${EXTRA}
COPY *.py ./
# config.json and the cache are mounted at runtime (never baked into the image)
EXPOSE 8765
CMD ["python", "-c", "import bridge,uvicorn; uvicorn.run(bridge.app, host='0.0.0.0', port=8765)"]
