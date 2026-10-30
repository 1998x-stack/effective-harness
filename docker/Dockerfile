# Rebuild and pin a digest before using on untrusted code.
FROM mcr.microsoft.com/playwright/python:v1.56.0-noble
RUN python -m pip install --no-cache-dir pytest==8.4.2 pytest-playwright==0.7.1 ruff==0.14.1 mypy==1.18.2
WORKDIR /work
