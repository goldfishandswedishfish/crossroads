#!/bin/bash
set -e
cd "$(dirname "$0")"
op run --env-file=.env.tpl -- python3 server.py
