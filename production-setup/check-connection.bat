@echo off
echo Pipnosis MT5 Bridge - Connection Test
echo ==================================
echo.
echo This script tests if your MT5 bridge is accessible from the internet.
echo.

set PORT=8765
if not "%~1"=="" set PORT=%~1

echo Testing connection to your MT5 bridge on port %PORT%...
echo.

REM Get public IP
echo Fetching your public IP address...
for /f "delims=" %%i in ('powershell -Command "try { (Invoke-WebRequest -Uri 'https://api.ipify.org' -UseBasicParsing).Content } catch { 'Could not determine public IP' }"') do set PUBLIC_IP=%%i

echo Your public IP: %PUBLIC_IP%
echo.

echo Testing local connection (localhost:%PORT%)...
powershell -Command "try { $conn = New-Object System.Net.Sockets.TcpClient('localhost', %PORT%); if($conn.Connected) { 'SUCCESS: Local connection successful!' } else { 'FAILED: Could not connect locally' }; $conn.Close() } catch { 'FAILED: ' + $_.Exception.Message }"

echo.
echo Testing connection via public IP (%PUBLIC_IP%:%PORT%)...
powershell -Command "try { $conn = New-Object System.Net.Sockets.TcpClient('%PUBLIC_IP%', %PORT%); if($conn.Connected) { 'SUCCESS: Public connection successful!' } else { 'FAILED: Could not connect via public IP' }; $conn.Close() } catch { 'FAILED: ' + $_.Exception.Message }"

echo.
echo If the public IP test failed but the local test succeeded:
echo 1. Your router may not support hairpinning/NAT loopback
echo 2. Your ISP might be blocking incoming connections
echo 3. Your port forwarding might not be set up correctly
echo.
echo Try testing from a different network (e.g., mobile data)
echo or use an online port checking service.
echo.

pause