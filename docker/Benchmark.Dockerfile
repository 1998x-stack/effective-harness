FROM python:3.11-slim
RUN python -m pip install --no-cache-dir pytest==8.4.2 ruff==0.14.1 mypy==1.18.2
WORKDIR /work
