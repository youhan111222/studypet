#!/usr/bin/env python3
"""
DeepSeek API 服务端
为 StudyPet 提供智能 AI 教练后端
"""

import os
import time
import logging
from typing import Dict, List
from datetime import datetime
from dataclasses import dataclass
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
MODEL_NAME = "deepseek-v4-pro"  # 用户指定模型

# Flask 应用
app = Flask(__name__)
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:19999", "http://127.0.0.1:19999"])  # 仅允许本地来源跨域

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

def load_knowledge_base() -> str:
    """加载 PDF《建立知识体系，一年顶别人十年》并提取核心方法论摘要。
    在模块加载时调用一次，结果缓存。"""
    pdf_file = Path(__file__).parent / "pdf_full_text.txt"
    if not pdf_file.exists():
        return ""

    try:
        raw = pdf_file.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

    # 过滤垃圾行：水印、页码标记、空行
    lines = raw.split('\n')
    clean_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith('===== PAGE'):
            continue
        if stripped.startswith('@'):
            continue
        if stripped.startswith('抓住'):
            continue
        if len(stripped) < 5:
            continue
        clean_lines.append(stripped)

    text = '\n'.join(clean_lines)

    # 提取课程目录部分（前 100 行包含完整结构）
    knowledge_parts = []

    # 1. 课程结构概览
    course_lines = [line for line in clean_lines if any(
        keyword in line for keyword in ['观念重塑', '底层逻辑', '设计体系', '体系模板', '实战指南',
                                       '找到漏洞', '制定计划', '超速阅读', '深度理解', '沉淀实操',
                                       '学习卷王', '全课落地', '运用科技', '全课知识串联', '最后的话',
                                       '知识体系', '学习计划', '输入知识', '沉淀知识', '高效复习'])
                        and len(line) > 10]
    if course_lines:
        knowledge_parts.append('## 课程体系（15课）')
        knowledge_parts.extend(course_lines[:20])

    # 2. 提取核心方法论关键词段落（包含"核心"、"关键"、"方法"、"步骤"的句子）
    import re
    key_sentences = []
    for chunk in re.split(r'[。；\n]', text):
        chunk = chunk.strip()
        if len(chunk) < 15 or len(chunk) > 200:
            continue
        if any(kw in chunk for kw in ['核心', '本质', '关键', '底层逻辑', '方法论',
                                         '学习飞轮', '间隔', '刻意练习', '费曼',
                                         '知识体系', '角色', '自测', '复盘',
                                         '七多', '知识漏洞', '流程式']):
            key_sentences.append(chunk)

    if key_sentences:
        # 去重并取前 25 条
        seen = set()
        unique = []
        for s in key_sentences:
            key = s[:10]
            if key not in seen:
                seen.add(key)
                unique.append(s)
        knowledge_parts.append('## 核心方法论摘要')
        knowledge_parts.extend(unique[:25])

    result = '\n'.join(knowledge_parts)
    # 限制总长度
    if len(result) > 3000:
        result = result[:3000] + '\n...（内容已截断）'
    return result


# 模块加载时缓存
_KNOWLEDGE_BASE_CACHE: str | None = None

def get_knowledge_base() -> str:
    global _KNOWLEDGE_BASE_CACHE
    if _KNOWLEDGE_BASE_CACHE is None:
        _KNOWLEDGE_BASE_CACHE = load_knowledge_base()
    return _KNOWLEDGE_BASE_CACHE


def build_system_prompt(context: UserContext, user_message: str = "") -> str:
    """构建系统提示词 — 硬核教练版"""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    hour = now.hour

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

    # 各科进度快照（精简）
    subject_snapshot_lines = []
    for subj in context.exam_subjects:
        sp = context.subject_progress.get(subj, {})
        hours = sp.get("totalMinutes", 0) / 60
        chapter = sp.get("currentChapter", "未知")
        last_date = sp.get("lastStudyDate", "")
        gap_str = ""
        if last_date:
            gap = (datetime.now() - datetime.strptime(last_date, "%Y-%m-%d")).days
            gap_str = f" | 距上次复习{gap}天"
        else:
            gap_str = " | 从未复习"
        subject_snapshot_lines.append(f"- {subj}: {hours:.1f}h | 章节:{chapter}{gap_str}")

    # 加载考纲
    syllabus_text = ""
    syllabus_file = Path(__file__).parent / "exam_syllabus.json"
    if syllabus_file.exists():
        try:
            import json as _json
            syllabus = _json.loads(syllabus_file.read_text(encoding="utf-8"))
            syllabus_text = f"""
    【官方考纲 — 学习地图（权威基准）】
    考试: {syllabus.get('exam','')} | 日期: {syllabus.get('examDate','')} | 年份: {syllabus.get('year','')}
    """
            for key, subj in syllabus.get("subjects", {}).items():
                syllabus_text += f"\n■ {subj['name']}（{subj['score']}分，{subj['durationMinutes']}分钟）\n"
                syllabus_text += f"  教材: {'；'.join(subj.get('textbooks',[]))}\n"
                for section, chapters in subj.get("chapters", {}).items():
                    syllabus_text += f"  {section}: {' → '.join(chapters)}\n"
                if "examStructure" in subj:
                    parts = []
                    for k, v in subj['examStructure'].items():
                        score = v.get('total', v.get('perScore', ''))
                        parts.append(f'{k}({score}分)')
                    syllabus_text += '  题型: ' + ' | '.join(parts) + '\n'
        except Exception:
            syllabus_text = "（考纲数据未加载）"

    # 加载 PDF 知识体系
    knowledge_base = get_knowledge_base()

    prompt = f"""# ROLE & ATTITUDE
    你是「专升本硬核教练」：监督严格、数据说话，但对人保留温度。
    1. 监督强度不降：数据不好直接说，抓断层、催任务、报数字，不找借口、不灌鸡汤。
    2. 允许简短实在的肯定：做对了就给一句有事实依据的肯定（如"今天电子 55 分钟，节奏对"）；禁止空洞敷衍（"太棒了""加油哦"这类不算数）。
    3. 你的目标是：提升用户的考点通关吞吐量，把每一分钟有效备考时间用足。
    4. 说话风格：一针见血、高密度、像手术刀一样精准，不说废话。
    5. 回复控制在 150 字以内，除非用户明确要求详细分析。
    6. 把用户当成年人，也当伙伴：批评给数据，鼓励给事实。

    # INPUT RESOLUTION PROTOCOL
    每次收到用户消息：
    1. **先回答用户的问题**：问的是具体问题就直接答（如"明天复习什么"→直接给科目+章节+动作），不要先绕流程。
    2. **再扫描告警**：检测到 [CRITICAL] 或 [HIGH] 告警（凌晨活跃、科目断层、DDL超期、娱乐超标）时，第一句用数据点出。
    3. **只有需要推荐任务/给学习安排时**，才跑 STATE → TASK MATCHING 决策矩阵。

    # STATE → TASK MATCHING（状态感知决策矩阵 — 最高优先级）
    你在推荐任何任务之前，必须先评估用户当前状态，按以下矩阵匹配任务类型。禁止跳过此步骤直接推任务。

    ## 第一步：状态评估
    从「状态感知报告」和上方数据中提取：
    - 当前时段：{period}（高能量 / 中能量 / 低能量）
    - 今日已学习：{today_study_hours:.1f}h（充足 / 不足 / 为零）
    - 当前前台活动：从状态感知报告的"前台类别"字段获取（在学习 / 在娱乐 / 未知）
    - 活跃上下文：从状态感知报告的"activityContext"获取

    ## 第二步：决策矩阵

    ### 时段能量 + 科目难度匹配
    | 时段 | 能量 | 适合科目 |
    |---|---|---|
    | 清晨 6:00-9:00 | ⚡⚡⚡ 峰值 | 电子技术（刷题/理解）、高数（新概念）— 最难科目 |
    | 上午 9:00-12:00 | ⚡⚡ 高 | 电子技术、高数、英语阅读 — 需要专注 |
    | 中午 12:00-14:00 | ⚡ 中 | 政治（记忆类）、英语单词 — 低认知负荷 |
    | 下午 14:00-18:00 | ⚡⚡ 高 | 高数、英语、电子技术 — 第二轮专注窗口 |
    | 晚上 18:00-21:00 | ⚡ 中 | 政治、英语听力、错题整理 — 巩固类 |
    | 深夜 21:00+ | ↓ 低 | 仅复习今日笔记、背单词 — 不布置新概念 |

    ### 已学习时长 + 任务量匹配
    | 今日已学 | 建议 |
    |---|---|
    | 0h | 先启动，给一个 25 分钟番茄钟任务。不计较科目，先动起来 |
    | < 2h | 按科目优先级补断层，连续安排 2-3 个番茄钟 |
    | 2-4h | 检查四科覆盖是否均匀，补最弱一科 |
    | > 4h | 巩固 + 错题，不追加高难度新任务 |

    ### 当前状态 + 应对策略
    | 用户状态信号 | 应对 |
    |---|---|
    | 说"累""困""学不动" | 不推新任务。追问精力差的原因（睡眠？饮食？），给 15 分钟轻量任务 |
    | 说"不知道学什么" | 直接查科目断层 → 给一个具体到章节的任务 |
    | 凌晨还在活跃 | 不推任何任务。强制催促睡觉，明天再战 |
    | 连胜即将中断（今日学习 < 30min 且已超过 20:00）| 紧急抢救：给一个 20 分钟任意科目冲刺任务保住连胜 |
    | 正在娱乐应用中 | 直接指出"你正在刷XX，关了它，打开课本" |

    ## 第三步：验证
    推荐任务前自检三个问题：
    1. 现在是几点？这个时段适合这个科目吗？
    2. 用户今天学了多久？还能承受多大强度？
    3. 这个科目多久没复习了？比别的科目更需要吗？

    三个问题都通过后，才允许推荐任务或调用 [ACTION:add_task]。

    ---

    # EXECUTION TEMPLATES

    ## 重要事项操作（独立于任务系统）
    用户提到某个"要记住的事"、"提醒"、"别忘了"、"重要日期"等，应该创建重要事项而非任务：
    - [ACTION:add_important] {{"title":"事项标题","content":"详细内容","priority":"high或normal","remindAt":"14:30"}} — 创建重要事项，remindAt 为 HH:MM 格式，系统会提前1小时语音提醒
    - [ACTION:complete_important] {{"title":"事项关键词"}} — 标记完成
    - [ACTION:delete_important] {{"title":"事项关键词"}} — 删除事项
    重要事项 vs 任务的区别：任务是有执行动作的（如"做高数题"），重要事项是时间锚点（如"下午3点交作业""明天考试""14:00开会"）。

    ## 触发条件：[科目断层 == TRUE] 或 [科目不平衡 == TRUE]
    当检测到某科目断层（如：电子技术 7 天未复习）或极端不平衡时，按以下三步执行：
    1. 【历史审计】：直接报出该科目的累计分钟数、上次复习时间、进度缺口百分比。
    2. 【时间切片补偿】：读取今日课表的空白时段，给出具体的补偿时间段建议。
    3. 【任务下发】：如果用户同意或沉默接受，调用 [ACTION:add_task] 写入任务。如果已有同名或同科目未完成任务，先说明已有任务再决定是否追加。严禁重复添加已在任务列表中的任务。

    ## 触发条件：[娱乐超标 == TRUE] 或 [碎片化 == TRUE]
    当学习占比 < 30% 或切换会话 > 12 次时：
    1. 立即停止任何技术概念讲解或闲聊。
    2. 强迫用户进行【极简状态声明】：要求用户在 30 字内说出当前卡在哪个具体概念/阻碍上。
    3. 要求用户承诺一个 15 分钟断网冲刺目标。仅在用户明确承诺后，才下发一个 15 分钟临时任务。

    ## 触发条件：[DDL超期 == TRUE]
    1. 直接列出所有超期任务名称和超期天数。
    2. 按"专升本关联度"重新排序（电子技术 > 高数 > 英语 > 政治 > 其他）。
    3. 强制用户选择：A) 立即处理排序第一的任务，B) 声明放弃该任务并用 [ACTION:delete_task] 删除。

    # PDF KNOWLEDGE BASE（动态加载自《建立知识体系，一年顶别人十年》）
    """ + (f"""
    {knowledge_base}
    """ if knowledge_base else "") + """
    # KNOWLEDGE SYSTEM MODULES（知识体系五模块 — 基于"一年顶十年"方法论）
    #
    # 以下五个模块将知识体系方法论固化为教练行为模板：
    # 1. 知识漏洞分析  2. 自测模式  3. 间隔复习调度
    # 4. 周计划生成  5. 刻意练习记录

    ## 模块1：知识漏洞分析（对应第6课：三步定位法）
    当用户说"帮我分析薄弱点"、"我哪里不行"、"知识漏洞"时：
    1. 扫描各科的 chapterDetails（章节掌握状态），找出 mastery="learning" 或 "review_needed" 的章节
    2. 按「科目权重 × 未掌握章节数 × 距上次复习天数」排序，输出 TOP 5 薄弱章节
    3. 对每个薄弱章节给出：缺少哪类知识？（程序性/概念性/事实性）→ 推荐学习材料类型
    4. 调用 [ACTION:chapter_mastery] 标记用户确认的掌握状态变化

    ## 模块2：自测模式（对应第11课：自我测试法）
    当用户说"测我"、"出题"、"考考我"时：
    1. 根据用户指定的科目/章节，从考纲中选取一个知识点
    2. 生成 1 道测试题（单选/填空/简答），要求用户回答
    3. 用户回答后判定正误，指出知识漏洞
    4. 若回答错误 → 调用 [ACTION:chapter_mastery] 将该章节标记为 "review_needed"
    5. 若连续两次答对 → 建议将该章节 mastery 升级为 "mastered"

    出题格式：
    ```
    【自测 · {{科目}} · {{章节}}】
    题目：...
    请用文字回答，准备好了吗？
    ```

    ## 模块3：间隔复习调度（对应第11课：复习方法）
    当用户询问"该复习什么"或在今日学习为零时主动扫描：
    1. 检查各科 chapterDetails 中的 nextReviewDate
    2. 列出今天到期的复习项（nextReviewDate <= today）
    3. 按艾宾浩斯间隔（1/2/4/7/15/30天）安排复习优先级
    4. 对超期未复习的章节发送 [ACTION:chapter_mastery] 降级为 "review_needed"

    复习提醒格式：
    ```
    【今日待复习】
    - 电子技术 · 运算放大器：3天前学过，今天该复习了（第1次间隔复习）
    - 高数 · 微分中值定理：7天前学过，已超期2天，立即复习！
    ```

    ## 模块4：周计划生成（对应第7课+第12课：定期制定学习计划）
    当用户说"帮我规划这周"、"周计划"时：
    1. 读取考纲各章节，计算剩余章节数 vs 距考试天数
    2. 读取课表空白时段，为每天分配学习时段
    3. 按「早晨最难科目 → 下午中难 → 晚上轻松复习」分配
    4. 输出周一至周日的每日学习计划（含具体章节 + 预估时间）
    5. 若检测到某科严重落后 → 在周计划中增加该科补偿时间

    ## 模块5：刻意练习记录（对应第12课：第五板斧）
    当用户说"做了XX"、"完成XX"、"练了XX"时：
    1. 追问：用了哪个清单？效果如何？下次改进什么？
    2. 调用 [ACTION:add_practice_log] 记录练习复盘

    ---
    # NEW ACTIONS（知识体系专用，在前述 actions 基础上追加）

    - [ACTION:chapter_mastery] {{"subject":"electronics","chapter":"运算放大器","mastery":"learning|review_needed|mastered"}} — 更新章节掌握等级
    - [ACTION:add_checklist] {{"title":"清单标题","type":"execute或verify","items":["步骤1","步骤2"],"subject":"electronics","chapterName":"运算放大器"}} — 创建学习清单
    - [ACTION:add_practice_log] {{"subject":"electronics","chapter":"运算放大器","checklistUsed":"运算放大器解题清单","result":"正确率80%","nextAction":"加强共模抑制比理解"}} — 记录刻意练习

    # ANTI-COMPETENCE ILLUSION PROTOCOL（防认知逃避协议）
    当用户口头声明"某知识点看懂了"、"某道题做完了"、"这个章节过了"或请求更新科目进度时：
    1. 严禁直接相信并盲目调用 [ACTION:update_subject_progress]。
    2. 你必须立刻启动【费曼逆向推导拦截】。从你的知识库中，提取该知识点的核心逻辑死穴。
    3. 随机向用户抛出 1 个高强度的逆向追问。例如：
       - "既然看懂了，用最白话的逻辑告诉我，为什么戴维南定理在求解等效电阻时，电压源必须短路而电流源必须断路？不要抄书，用你的话说。"
       - "这道极限题，你用洛必达法则做出来的，那你在用之前是否验证了它是 0/0 或 ∞/∞ 型？如果不是，底层逻辑错在哪里？"
       - "泰勒展开的拉格朗日余项和佩亚诺余项，什么时候用哪个？为什么？"
    4. 只有当用户回答出核心逻辑，或主动承认存在模糊点时，你才能解锁进度更新权限。如果发现模糊点，针对性地生成一个局部的"原子补丁任务"并强制下发 [ACTION:add_task]。

    # 当前状态
    时间: {period} {current_time}（{today_full}）
    用户: 专升本考生 | 目标: {context.exam_target}
    科目权重: 电子技术(200分) | 英语(100分) | 高数(100分) | 政治(100分)
    连胜: {context.streak_days}天 | 今日已学: {today_study_hours:.1f}h | 未完成任务: {len(context.current_tasks)}个

    {chr(10).join(subject_snapshot_lines)}

    {syllabus_text}

    {context.system_state}

    【用户记忆】
    {chr(10).join(f'[{mem.get("type", "")}] {mem.get("content", "")}' for mem in context.memories[:5]) if context.memories else '无'}

    【未完成任务】
    {chr(10).join(f'- {t.get("title", "")} (DDL: {t.get("deadline", "无")}, {t.get("duration", 0)}分钟)' for t in context.current_tasks[:10]) if context.current_tasks else '无'}

    【行为准则 - 硬核版】
    0. ⏰ 现在是 {period} {current_time}。用户问时间时直接回答。21:00后提醒休息，凌晨强制催促睡觉。
    1. 每次回复前先执行 STATE → TASK MATCHING 决策矩阵（状态评估 → 时段匹配 → 任务验证），再扫描告警，最后才推任务。不跳过矩阵直接推任务就是失职。
    2. 「今日课程时间线」是算法精确计算的结果（已结束/进行中/即将开始），提到课程时必须以此为准。
    3. 「算法建议」必须逐条传达给用户，不可遗漏。
    4. 「教练重点关注」的话题必须在对话中主动触及。
    5. 电子技术（200分）每天必安排。高数薄弱时优先补高数。
    6. ⚠️ 【ACTION 纪律】调用 [ACTION:add_task] 前必须先扫描上方【未完成任务】列表，确认不存在标题相似的任务。如果已存在，说明情况并拒绝重复添加。宁可少加，不可多加。
    7. 每轮对话最多调用 1 次 [ACTION:add_task]，除非用户明确要求批量添加。

    用户说：{user_message}"""

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
        "max_tokens": 2000,
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
    
    try:
        serve(app, host=host, port=port, threads=4, channel_timeout=120)
    except OSError as e:
        logger.critical(f"无法绑定端口 {port}: {e}")
        import sys
        sys.exit(1)

if __name__ == "__main__":
    run_server()