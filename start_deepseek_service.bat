@echo off
chcp 65001 >nul
echo ========================================
echo   DeepSeek AI 教练服务启动脚本
echo ========================================
echo.

REM 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

REM 检查依赖
if not exist "venv" (
    echo [信息] 创建虚拟环境...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo [信息] 安装依赖包...
    pip install flask flask-cors requests python-dotenv
) else (
    call venv\Scripts\activate.bat
)

REM 设置环境变量（DeepSeek API Key）
echo [提示] 请设置 DeepSeek API Key 环境变量
echo [提示] 1. 创建 .env 文件并写入: DEEPSEEK_API_KEY=你的密钥
echo [提示] 2. 或直接设置系统环境变量
echo.

if exist ".env" (
    echo [信息] 检测到 .env 文件，加载环境变量...
) else (
    echo [警告] 未找到 .env 文件，服务将以模拟模式运行
    echo [提示] 创建 .env 文件示例:
    echo DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    echo.
)

REM 启动服务
echo [信息] 启动 DeepSeek 教练服务...
echo [信息] 服务地址: http://127.0.0.1:19999
echo [信息] 健康检查: http://127.0.0.1:19999/api/coach/health
echo [信息] 按 Ctrl+C 停止服务
echo ========================================
echo.

python deepseek_service.py

pause