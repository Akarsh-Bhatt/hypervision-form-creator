@echo off
echo ========================================================
echo Starting Hypervision Form Platform (Client-to-Supabase)
echo ========================================================

echo Starting Frontend (Next.js)...
cd /d %~dp0frontend && npm run dev

