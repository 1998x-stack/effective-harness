# Example image for pytest, Python browser E2E, Ruff and MyPy.
# Pin a digest for production and review dependency updates before rebuilding.
FROM mcr.microsoft.com/playwright/python:v1.56.0-noble
RUN python -m pip install --no-cache-dir pytest==8.4.2 pytest-playwright==0.7.1 ruff==0.14.1 mypy==1.18.2
WORKDIR /work
