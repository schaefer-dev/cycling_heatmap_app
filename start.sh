#!/bin/bash

# Cycling Archive - Start Script
# Starts the server and opens the app in your browser

cd "$(dirname "$0")"

echo "Stopping any existing server..."
pkill -f "node server/src/index.js" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

echo "Starting server..."
node server/src/index.js &
SERVER_PID=$!

echo "Starting frontend..."
cd client && npm run dev &
FRONTEND_PID=$!
cd ..

# Wait for servers to be ready
echo "Waiting for servers to start..."
sleep 3

# Check if servers are running
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "Backend ready on http://localhost:3001"
else
    echo "Warning: Backend may not be ready yet"
fi

if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "Frontend ready on http://localhost:5173"
else
    echo "Warning: Frontend may not be ready yet"
fi

echo ""
echo "Opening browser..."
open http://localhost:5173

echo ""
echo "Cycling Archive is running!"
echo "  - Frontend: http://localhost:5173"
echo "  - Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for user interrupt
trap "echo 'Shutting down...'; kill $SERVER_PID $FRONTEND_PID 2>/dev/null; exit 0" INT
wait
