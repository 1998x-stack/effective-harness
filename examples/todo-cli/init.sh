#!/usr/bin/env bash
set -e

echo "[init.sh] Building project..."
go build ./...

echo "[init.sh] Smoke test: running --help..."
./todo-cli --help > /dev/null

echo "[init.sh] Smoke test passed"
