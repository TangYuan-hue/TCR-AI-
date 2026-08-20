# 启动 3D 联机枪战服务器，并显示局域网访问地址
Set-Location $PSScriptRoot
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1).IPAddress
Write-Host "=========================================="
Write-Host "  3D 联机枪战服务器"
Write-Host "  本机访问:   http://localhost:3000"
if ($ip) { Write-Host "  局域网访问: http://$ip`:3000" }
Write-Host "=========================================="
node server.js
