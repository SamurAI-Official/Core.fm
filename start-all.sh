#!/bin/bash
# Core.fm Complete Startup Script for Linux/macOS
# Starts ACE-Step API + Backend + Frontend

set -e

echo "=================================="
echo "  Core.fm Complete Startup"
echo "=================================="
echo

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Error: UI dependencies not installed!"
    echo "Please run ./setup.sh first."
    exit 1
fi

if [ ! -d "server/node_modules" ]; then
    echo "Error: Server dependencies not installed!"
    echo "Please run ./setup.sh first."
    exit 1
fi

# Get ACE-Step path from environment or use default
ACESTEP_PATH="${ACESTEP_PATH:-../ACE-Step-1.5}"

# Check if ACE-Step exists
if [ ! -d "$ACESTEP_PATH" ]; then
    echo
    echo "Warning: ACE-Step not found at $ACESTEP_PATH"
    echo
    echo "Please set ACESTEP_PATH, or place the ACE-Step-1.5 folder next to this one"
    echo "Example: export ACESTEP_PATH=/path/to/ACE-Step-1.5"
    echo
    exit 1
fi

# Get local IP for LAN access
if command -v ip &> /dev/null; then
    LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || echo "")
elif command -v ifconfig &> /dev/null; then
    LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n1)
fi

echo
echo "=================================="
echo "  Starting All Services..."
echo "=================================="
echo

# Create log directory
mkdir -p logs

# Start the ACE-Step 1.5 engine API in the background.
# NOTE: the UI generates through the Gradio endpoint (/generation_wrapper), which
# the REST-only `acestep-api` server does not expose. Mirrors start-all.bat.
REPO_ROOT=$(pwd)
echo "[1/4] Starting ACE-Step 1.5 engine API..."
cd "$ACESTEP_PATH"
uv run python acestep/acestep_v15_pipeline.py --port 8001 --enable-api --backend pt --server-name 127.0.0.1 > "$REPO_ROOT/logs/api.log" 2>&1 &
API_PID=$!
cd - > /dev/null

# Wait for API to start
echo "Waiting for API to initialize..."
sleep 5

# Check if API started successfully
if ! kill -0 $API_PID 2>/dev/null; then
    echo "Error: API failed to start. Check logs/api.log"
    exit 1
fi

# Start backend in background
echo "[2/4] Starting backend server..."
cd server
npm run dev > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
echo "Waiting for backend to start..."
sleep 3

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "Error: Backend failed to start. Check logs/backend.log"
    kill $API_PID 2>/dev/null
    exit 1
fi

# Start frontend in background
echo "[3/4] Starting frontend..."
npm run dev > logs/frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait a moment
sleep 2

# Check if frontend started successfully
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "Error: Frontend failed to start. Check logs/frontend.log"
    kill $API_PID $BACKEND_PID 2>/dev/null
    exit 1
fi

# Start the Trends service (signal aggregator) when present - it powers the
# "Trends" tab. Two layouts are supported (vendored in this repo, or a sibling
# clone). Pick whichever actually has dependencies installed first, so a vendored
# copy that has not been `npm install`ed cannot shadow a working sibling clone.
AGGREGATOR_DIR=""
for candidate in "signal-aggregator" "../signal-aggregator"; do
    if [ -d "$candidate/node_modules" ]; then
        AGGREGATOR_DIR="$candidate"
        break
    fi
done
if [ -z "$AGGREGATOR_DIR" ]; then
    for candidate in "signal-aggregator" "../signal-aggregator"; do
        if [ -f "$candidate/package.json" ]; then
            AGGREGATOR_DIR="$candidate"
            break
        fi
    done
fi

AGGREGATOR_PID=""
if [ -n "$AGGREGATOR_DIR" ]; then
    if [ -d "$AGGREGATOR_DIR/node_modules" ]; then
        echo "[4/4] Starting Trends service (signal aggregator)..."
        ( cd "$AGGREGATOR_DIR" && npm run serve > "$REPO_ROOT/logs/aggregator.log" 2>&1 ) &
        AGGREGATOR_PID=$!
        sleep 4
    else
        echo "[skip] Trends service found at $AGGREGATOR_DIR but dependencies are missing:"
        echo "       cd $AGGREGATOR_DIR && npm install"
    fi
fi

echo
echo "=================================="
echo "  All Services Running!"
echo "=================================="
echo
echo "  ACE-Step 1.5 engine API: http://localhost:8001"
echo "  Backend:                 http://localhost:3001"
echo "  Frontend:                http://localhost:3000"
if [ -n "$AGGREGATOR_PID" ]; then
    echo "  Trends service:          http://localhost:3002"
fi
echo
if [ -n "$LOCAL_IP" ]; then
    echo "  LAN Access:   http://$LOCAL_IP:3000"
    echo
fi
echo "  Logs:         ./logs/"
echo
echo "  PIDs:"
echo "    API:      $API_PID"
echo "    Backend:  $BACKEND_PID"
echo "    Frontend: $FRONTEND_PID"
if [ -n "$AGGREGATOR_PID" ]; then
    echo "    Trends:   $AGGREGATOR_PID"
fi
echo
echo "=================================="
echo

# Save PIDs for stop script
echo "$API_PID" > logs/api.pid
echo "$BACKEND_PID" > logs/backend.pid
echo "$FRONTEND_PID" > logs/frontend.pid
if [ -n "$AGGREGATOR_PID" ]; then
    echo "$AGGREGATOR_PID" > logs/aggregator.pid
fi

echo "Opening browser..."
sleep 3

# Open browser based on OS
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 &
elif command -v open &> /dev/null; then
    open http://localhost:3000 &
fi

echo
echo "Services are running in background."
echo "To stop all services, run: ./stop-all.sh"
echo "Or press Ctrl+C and they will continue running."
echo

# Wait for user interrupt
trap 'echo; echo "Services still running. Use ./stop-all.sh to stop them."; exit 0' INT
wait
