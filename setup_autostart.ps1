# 一键配置 StudyPet 全部服务开机自启

$taskName = "StudyPet-AllServices"

# 删除旧任务
schtasks /delete /tn $taskName /f 2>$null
schtasks /delete /tn "StudyPet-Tracker" /f 2>$null

# 创建统一自启任务：开机 + 最高权限 + 无弹窗
schtasks /create `
  /tn $taskName `
  /tr "powershell -ExecutionPolicy Bypass -File D:\StudyPet\StudyPet_Launcher.ps1" `
  /sc onlogon `
  /rl HIGHEST `
  /f

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ StudyPet 全部服务已配置开机自启！" -ForegroundColor Green
    Write-Host ""
    Write-Host "   每次开机自动启动（无 UAC 弹窗）："
    Write-Host "   - api_server.py      (19998, 含AI教练)"
    Write-Host "   - tracker.py         (后台)"
    Write-Host "   - Vite 前端           (5173)"
    Write-Host ""

    # 立即运行一次
    schtasks /run /tn $taskName
    Write-Host "✅ 所有服务已在后台启动" -ForegroundColor Green
} else {
    Write-Host "❌ 创建失败，请右键此脚本 → 以管理员身份运行" -ForegroundColor Red
}

pause
