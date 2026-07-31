---
name: pet-start
description: 一键启动 StudyPet 全部服务（API、AI教练、Tracker、Vite前端）。当用户说"启动StudyPet"、"打开StudyPet"、"启动服务"时触发。
---

# StudyPet 全服务启动

严格按照以下顺序执行，每步确认成功后再进入下一步：

1. **清理残留端口**：
   - 检查端口 19998、19999、5173 是否被占用
   - 如被占用，`taskkill /F /PID <pid>` 杀掉占用进程

2. **启动后端服务**（逐个启动，间隔 3 秒）：
   - `Start-Process python -ArgumentList "api_server.py" -WorkingDirectory "D:\StudyPet" -WindowStyle Minimized`
   - 等待 3 秒
   - `Start-Process python -ArgumentList "deepseek_service.py" -WorkingDirectory "D:\StudyPet" -WindowStyle Minimized`

3. **等待后端就绪**：
   - 轮询 `http://127.0.0.1:19998/health`（最多 30 次 × 1 秒）
   - 轮询 `http://127.0.0.1:19999/api/coach/health`（最多 15 次 × 1 秒）

4. **启动 Tracker**（需管理员权限）：
   - `Start-Process python -ArgumentList "tracker.py" -WorkingDirectory "D:\StudyPet" -Verb RunAs -WindowStyle Minimized`

5. **启动前端**：
   - `Start-Process npx -ArgumentList "vite --host 0.0.0.0 --port 5173" -WorkingDirectory "D:\StudyPet" -WindowStyle Minimized`

6. **确认结果**：
   - 用 `netstat -ano | findstr "19998 19999 5173"` 验证三个端口均处于 LISTENING
   - 输出一行状态摘要："API ✅ | AI教练 ✅ | 前端 ✅ | Tracker 已提交提权启动"
