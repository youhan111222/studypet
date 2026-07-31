# 一键配置 tracker.py 开机自启 + 管理员权限（永不弹窗）
# 运行方式：右键此文件 → 使用 PowerShell 运行

$taskName = "StudyPet-Tracker"
$studyPath = "D:\StudyPet"

# 删除旧任务（如果存在）
schtasks /delete /tn $taskName /f 2>$null

# 创建新任务：开机自启 + 最高权限 + 最小化窗口
schtasks /create `
  /tn $taskName `
  /tr "cmd /c cd /d $studyPath && python tracker.py" `
  /sc onlogon `
  /rl HIGHEST `
  /f

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ StudyPet-Tracker 已配置成功！" -ForegroundColor Green
    Write-Host "   - 每次开机自动启动，无需 UAC 弹窗"
    Write-Host "   - 以管理员权限运行，不会崩溃"
    Write-Host ""
    Write-Host "现在就运行一次？(Y/n)"

    # 立即启动 tracker
    schtasks /run /tn $taskName
    Write-Host "✅ tracker.py 已在后台启动" -ForegroundColor Green
} else {
    Write-Host "❌ 创建失败，请确认以管理员身份运行此脚本" -ForegroundColor Red
}

pause
