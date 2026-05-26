#!/usr/bin/env python3
"""
DeepSeek API 服务端
为 StudyPet 提供智能 AI 教练后端
"""

import os
import json
import time
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from pathlib import Path

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from waitress import serve

# 加载 .env 文件
load_dotenv(Path(__file__).parent / ".env")

# 全局启动时间
_start_time = time.time()

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 配置
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")  # 从环境变量读取
MODEL_NAME = "deepseek-v4-pro"  # Claude Code 同款模型

# Flask 应用
app = Flask(__name__)
CORS(app)  # 允许前端跨域

@dataclass
class UserContext:
    """用户上下文数据"""
    # 基本信息
    user_id: str = "default_user"
    user_name: str = "专升本考生"
    exam_target: str = "2027年广东专升本考试，目标公办本科院校"
    exam_subjects: List[str] = None  # 四科
    
    # 学习数据
    current_tasks: List[Dict] = None
    completed_tasks: List[Dict] = None
    streak_days: int = 0
    pet_level: int = 1
    pet_coins: int = 0
    
    # 科目进度
    subject_progress: Dict[str, Dict] = None
    
    # 活动数据
    activity_logs: List[Dict] = None
    screen_time_stats: Dict = None
    
    # 记忆
    memories: List[Dict] = None
    
    # 重要事项
    important_items: List[Dict] = None
    
    # 完整系统状态（前端 buildContext 的结果，包含课表/任务/成就/考试/备考面板等所有数据）
    system_state: str = ""
    
    def __post_init__(self):
        if self.exam_subjects is None:
            self.exam_subjects = ["英语", "高数", "政治", "电子技术"]
        if self.current_tasks is None:
            self.current_tasks = []
        if self.completed_tasks is None:
            self.completed_tasks = []
        if self.subject_progress is None:
            self.subject_progress = {}
        if self.activity_logs is None:
            self.activity_logs = []
        if self.memories is None:
            self.memories = []
        if self.important_items is None:
            self.important_items = []
        if self.screen_time_stats is None:
            self.screen_time_stats = {}

def build_system_prompt(context: UserContext, user_message: str = "") -> str:
    """构建系统提示词"""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    today_full = now.strftime("%Y年%m月%d日 %A")
    current_time = now.strftime("%H:%M")
    hour = now.hour
    minute = now.minute
    
    # 判断时段
    if 0 <= hour < 6:
        period = "凌晨"
    elif hour < 12:
        period = "上午"
    elif hour < 13:
        period = "中午"
    elif hour < 18:
        period = "下午"
    else:
        period = "晚上"
    
    today_study_min = sum(
        log.get("duration", 0) for log in context.activity_logs 
        if log.get("date") == today and log.get("category") == "study"
    )
    today_study_hours = today_study_min / 60
    
    # 检测睡眠（检查今天凌晨是否有活动）
    sleep_sufficient = True
    if 2 <= hour <= 5:
        sleep_sufficient = False
    
    # 检测学习断层（超过3天未复习的科目）
    subject_gaps = []
    for subj in context.exam_subjects:
        sp = context.subject_progress.get(subj, {})
        last_date = sp.get("lastStudyDate", "")
        if last_date:
            gap = (datetime.now() - datetime.strptime(last_date, "%Y-%m-%d")).days
            if gap >= 3:
                subject_gaps.append(f"{subj}: {gap}天未复习")
        else:
            subject_gaps.append(f"{subj}: 从未复习")
    
    # 各科进度
    subject_hours_lines = []
    for subj in context.exam_subjects:
        sp = context.subject_progress.get(subj, {})
        hours = sp.get("totalMinutes", 0) / 60
        chapter = sp.get("currentChapter", "未知")
        subject_hours_lines.append(f"- {subj}: {hours:.1f}小时 | 当前章节: {chapter}")
    
    prompt = f"""你是 StudyPet 的 AI 全能教练助手，名字叫「小橘」。你是用户桌面上的智能学习中枢。

【当前时间】{period} {current_time}（{today_full}）
【系统用户】专升本考生 | 目标: {context.exam_target}
【备考科目】英语(100分) | 高数(100分) | 政治(100分) | 电子技术(200分)
【用户状态】连胜{context.streak_days}天 | 宠物Lv.{context.pet_level} | 金币{context.pet_coins}
【今日学习】{today_study_hours:.1f}小时 | 未完成任务{len(context.current_tasks)}个 | 已完成{len(context.completed_tasks)}个
【睡眠评估】{'⚠️ 用户可能睡眠不足' if not sleep_sufficient else '正常'}

【各科进度】
{chr(10).join(subject_hours_lines)}

【学习断层警告】
{chr(10).join(f'⚠️ {g}' for g in subject_gaps) if subject_gaps else '无断层，各科均正常复习'}

【重要事项】
{chr(10).join(f'[{item.get("priority", "")}] {item.get("title", "")} - {item.get("content", "")[:50]}' for item in context.important_items[:5]) if context.important_items else '无'}

{context.system_state}
【用户记忆】
{chr(10).join(f'[{mem.get("type", "")}] {mem.get("content", "")}' for mem in context.memories[:5]) if context.memories else '无'}

【未完成任务】
{chr(10).join(f'- {t.get("title", "")} (DDL: {t.get("deadline", "无")}, {t.get("duration", 0)}分钟)' for t in context.current_tasks[:10]) if context.current_tasks else '无'}

【行为准则 —— 最高优先级】
0. ⏰ 每次回复前必须确认当前时间：现在是 {period} {current_time}（{today_full}），你必须基于这个时间思考。用户问"几点了"时直接说出当前时间（{period} {current_time}），不要回避。晚上9点后提醒休息，凌晨时分催促睡觉。
1. 温暖而专业，主动洞察问题。每轮对话先扫描数据，发现异常直接指出
2. 每日首次对话（早上）先问：「昨晚睡得怎样？今天感觉精力如何？」根据反馈调整任务强度
3. 发现睡眠不足6小时 → 建议减少低优任务，只保留DDL和专升本核心
4. 发现某个专升本科目超过3天没复习 → 强烈建议今天安排该科目
5. 发现DDL冲突 → 列出冲突任务，给出优先级排序
6. 娱乐时长超标 → 直接指出："今天娱乐X小时了，还有Y个DDL，先把XX做了？"
7. 用户在凌晨还在活跃 → 提醒休息
8. 主动引用历史数据（如"你昨天下午效率最高，建议今天继续那个时段学习"）
9. 不卑不亢，发现问题直接说，不等用户先开口
10. 每次回复包含至少1条具体可执行的建议

【输出格式】
- 回复精炼，重点突出，自然流畅
- 如果有新的用户目标/偏好/弱点发现，在回复末尾加 [MEMORY:类型:内容]
- 类型可选：goal | preference | insight | achievement
- 保持回复在200字以内，除非用户要求详细分析

【专升本备考优先级】
1. 电子技术基础（200分，权重40%）—— 每天必安排
2. 政治 + 英语（各100分，合计40%）—— 交替安排
3. 高数（100分，权重20%）—— 穿插巩固
4. 薄弱科目优先，课数少的日期安排专项突破

现在用户对你说：{user_message}"""
    
    return prompt


def call_deepseek_api(user_message: str, context: UserContext) -> str:
    """调用 DeepSeek API"""
    if not DEEPSEEK_API_KEY:
        logger.error("DeepSeek API Key 未设置，请设置 DEEPSEEK_API_KEY 环境变量")
        return "AI教练服务未配置，请先设置 DEEPSEEK_API_KEY 环境变量。在项目根目录创建 .env 文件，写入 DEEPSEEK_API_KEY=你的密钥。"
    
    system_prompt = build_system_prompt(context, user_message)
    
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.7,
        "max_tokens": 800,
        "stream": False
    }
    
    try:
        logger.info(f"调用 DeepSeek API，用户消息: {user_message[:50]}...")
        response = requests.post(DEEPSEEK_API_URL, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        
        result = response.json()
        ai_reply = result["choices"][0]["message"]["content"]
        logger.info(f"DeepSeek API 返回成功，长度: {len(ai_reply)}")
        return ai_reply
        
    except requests.exceptions.RequestException as e:
        logger.error(f"DeepSeek API 调用失败: {e}")
        return f"抱歉，AI教练暂时无法连接。错误: {str(e)}"
    except Exception as e:
        logger.error(f"处理 DeepSeek 响应失败: {e}")
        return "抱歉，AI教练处理响应时出错。"

@app.route('/api/coach/chat', methods=['POST'])
def coach_chat():
    """AI教练聊天接口"""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "无请求数据"}), 400
        
        user_message = data.get("message", "")
        user_context = data.get("context", {})
        
        if not user_message:
            return jsonify({"error": "消息不能为空"}), 400
        
        # 构建用户上下文
        context = UserContext(
            user_id=user_context.get("user_id", "default_user"),
            user_name=user_context.get("user_name", "专升本考生"),
            exam_target=user_context.get("exam_target", "2027年广东专升本考试"),
            exam_subjects=user_context.get("exam_subjects", ["英语", "高数", "政治", "电子技术"]),
            current_tasks=user_context.get("current_tasks", []),
            completed_tasks=user_context.get("completed_tasks", []),
            streak_days=user_context.get("streak_days", 0),
            pet_level=user_context.get("pet_level", 1),
            pet_coins=user_context.get("pet_coins", 0),
            subject_progress=user_context.get("subject_progress", {}),
            activity_logs=user_context.get("activity_logs", []),
            screen_time_stats=user_context.get("screen_time_stats", {}),
            memories=user_context.get("memories", []),
            important_items=user_context.get("important_items", []),
            system_state=user_context.get("system_state", "")
        )
        
        # 调用 DeepSeek
        ai_response = call_deepseek_api(user_message, context)
        
        return jsonify({
            "success": True,
            "response": ai_response,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"处理聊天请求失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/coach/plan', methods=['POST'])
def generate_plan():
    """生成学习计划接口"""
    try:
        data = request.json
        context = data.get("context", {})
        
        # 构建用户上下文
        user_context = UserContext(
            user_id=context.get("user_id", "default_user"),
            current_tasks=context.get("current_tasks", []),
            completed_tasks=context.get("completed_tasks", []),
            subject_progress=context.get("subject_progress", {}),
            activity_logs=context.get("activity_logs", []),
            important_items=context.get("important_items", [])
        )
        
        # 分析薄弱科目
        subject_progress = user_context.subject_progress
        if not subject_progress:
            # 默认计划
            plan = {
                "morning": {"subject": "英语", "task": "背单词50个，做阅读1篇", "duration": 120},
                "afternoon": {"subject": "高数", "task": "做第三章练习题", "duration": 150},
                "evening": {"subject": "政治", "task": "复习唯物辩证法", "duration": 90}
            }
        else:
            # 找出学习时间最少的科目
            subject_times = {subj: data.get("totalMinutes", 0) for subj, data in subject_progress.items()}
            weakest = min(subject_times.items(), key=lambda x: x[1])[0] if subject_times else "英语"
            
            # 生成计划
            plan = {
                "morning": {
                    "subject": weakest,
                    "task": f"重点突破{weakest}薄弱环节",
                    "duration": 120,
                    "priority": "高"
                },
                "afternoon": {
                    "subject": "交替复习",
                    "task": "做模拟题，整理错题本",
                    "duration": 150,
                    "priority": "中"
                },
                "evening": {
                    "subject": "巩固",
                    "task": "复习今日内容，预习明日计划",
                    "duration": 90,
                    "priority": "低"
                }
            }
        
        return jsonify({
            "success": True,
            "plan": plan,
            "advice": f"建议今天重点加强{weakest if 'weakest' in locals() else '英语'}的学习",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"生成计划失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/coach/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({
        "status": "healthy",
        "service": "DeepSeek Coach API",
        "timestamp": datetime.now().isoformat(),
        "api_configured": bool(DEEPSEEK_API_KEY)
    })

def run_server(host="127.0.0.1", port=19999):
    logger.info(f"启动 DeepSeek 教练服务，地址: http://{host}:{port}")
    logger.info(f"API Key 已配置: {'是' if DEEPSEEK_API_KEY else '否'}")
    logger.info(f"使用 Waitress 生产级服务器，模型: {MODEL_NAME}")
    
    if not DEEPSEEK_API_KEY:
        logger.warning("警告: DEEPSEEK_API_KEY 环境变量未设置，服务将返回模拟数据")
    
    serve(app, host=host, port=port, threads=4, channel_timeout=120)

if __name__ == "__main__":
    run_server()