"""
Vision Proxy + LINE 點餐系統 v2 - 含訂單管理與廚房面板
支援網頁訂餐 + LINE 指令點餐 + 廚房狀態更新
"""
import os
import re
import json
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import requests

app = Flask(__name__)
CORS(app)

# ===== MiniMax API =====
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")

# ===== LINE API =====
LINE_ACCESS_TOKEN  = os.environ.get("LINE_ACCESS_TOKEN", "")
LINE_USER_ID       = os.environ.get("LINE_USER_ID", "U42399a8c32c2980e1df24f3a22e3146d")
LINE_API_PUSH      = "https://api.line.me/v2/bot/message/push"
LINE_API_REPLY     = "https://api.line.me/v2/bot/message/reply"
LINE_API_PROFILE   = "https://api.line.me/v2/bot/profile"

# ===== 訂單記憶體儲存（重啟後消失，生產環境建議用SQLite）=====
# 格式: order_id -> order dict
orders_db = {}

# ===== 菜單 =====
MENU = [
    {"name": "泡麵",     "price": 60,  "id": 1},
    {"name": "涼麵",     "price": 50,  "id": 2},
    {"name": "排骨便當", "price": 100, "id": 3},
    {"name": "雞腿便當", "price": 100, "id": 4},
    {"name": "炸雞排",   "price": 70,  "id": 5},
    {"name": "薯條",     "price": 40,  "id": 6},
    {"name": "炸雞翅",   "price": 40,  "id": 7},
    {"name": "滷蛋",     "price": 15,  "id": 8},
    {"name": "豆干",     "price": 15,  "id": 9},
    {"name": "鴨頭",     "price": 30,  "id": 10},
    {"name": "冰飲",     "price": 35,  "id": 11},
    {"name": "咖啡",     "price": 40,  "id": 12},
    {"name": "手工搖飲", "price": 50,  "id": 13},
    {"name": "香菸",     "price": 100, "id": 14},
    {"name": "檳榔",     "price": 50,  "id": 15},
]

STATUS_NAMES = {
    "pending":   "⏳ 待製作",
    "preparing": "👨‍🍳 製作中",
    "ready":     "✅ 製作完成",
    "delivered": "🚗 已外送",
    "cancelled": "❌ 已取消",
}
STATUS_LIST = list(STATUS_NAMES.keys())

# ==================== LINE 工具 ====================

def line_push(user_id, text):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {LINE_ACCESS_TOKEN}"}
    payload = {"to": user_id, "messages": [{"type": "text", "text": text}]}
    try:
        requests.post(LINE_API_PUSH, headers=headers, json=payload, timeout=10)
    except Exception as e:
        print(f"[LINE PUSH ERROR] {e}")

def line_reply(reply_token, text):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {LINE_ACCESS_TOKEN}"}
    payload = {"replyToken": reply_token, "messages": [{"type": "text", "text": text}]}
    try:
        requests.post(LINE_API_REPLY, headers=headers, json=payload, timeout=10)
    except Exception as e:
        print(f"[LINE REPLY ERROR] {e}")

def line_get_profile(user_id):
    try:
        resp = requests.get(f"{LINE_API_PROFILE}/{user_id}", headers={"Authorization": f"Bearer {LINE_ACCESS_TOKEN}"}, timeout=10)
        if resp.ok:
            return resp.json().get("displayName", user_id)
    except:
        pass
    return user_id

# ==================== 訂單工具 ====================

def gen_order_id():
    return str(uuid.uuid4())[:8].upper()

def parse_order(text):
    """解析 '排骨便當x2 + 涼麵x1' -> [(item, qty, price), ...], total"""
    items = []
    parts = re.split(r'[+,]', text)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        m = re.match(r'(.+?)\s*[xX×]\s*(\d+)', part)
        name = m.group(1).strip() if m else part
        qty  = int(m.group(2)) if m else 1

        matched = next((i for i in MENU if name in i['name'] or i['name'] in name), None)
        if matched:
            items.append({"id": matched['id'], "name": matched['name'], "price": matched['price'], "qty": qty})

    total = sum(i['price'] * i['qty'] for i in items)
    return items, total

def save_order(order):
    orders_db[order['id']] = order

def get_order_by_user(user_id):
    """取得某用戶所有未完成訂單"""
    return [o for o in orders_db.values()
            if o.get('user_id') == user_id and o['status'] not in ('delivered', 'cancelled')]

def format_order_summary(order, show_id=True):
    lines = []
    if show_id:
        lines.append(f"📋 訂單 #{order['id']}")
    lines.append(f"👤 {order.get('user_name', '匿名')}")
    for item in order['items']:
        lines.append(f"  • {item['name']} x{item['qty']} = ${item['price'] * item['qty']}")
    lines.append(f"💰 合計：${order['total']}")
    lines.append(f"📍 {order.get('location', '外送')}")
    lines.append(f"🕐 {order['created_at']}")
    lines.append(f"狀態：{STATUS_NAMES.get(order['status'], order['status'])}")
    return "\n".join(lines)

def format_user_orders(user_id):
    orders = get_order_by_user(user_id)
    if not orders:
        return "📋 您目前沒有任何訂單"

    lines = ["📋 您的訂單列表", "━━━━━━━━━━━━━━━"]
    for o in orders:
        lines.append(f"#{o['id']} | {STATUS_NAMES.get(o['status'], o['status'])}")
        for item in o['items']:
            lines.append(f"  • {item['name']} x{item['qty']}")
        lines.append(f"  💰 ${o['total']} | 🕐 {o['created_at']}")
        lines.append("")
    lines.append("━━━━━━━━━━━━━━━")
    lines.append("📝 取消請傳：@order 取消 #訂單ID")
    return "\n".join(lines)

# ==================== LINE 指令處理 ====================

def handle_order_command(cmd, user_id, user_name, reply_token):
    cmd = cmd.strip()

    if not cmd or cmd in ["看菜單", "菜單", "menu"]:
        lines = [
            "📋 粉紅超跑完整菜單",
            "━━━━━━━━━━━━━━━",
            "🍜 麵食：泡麵 $60 / 涼麵 $50",
            "🍚 飯類：排骨便當 $100 / 雞腿便當 $100",
            "🍗 炸物：炸雞排 $70 / 薯條 $40 / 炸雞翅 $40",
            "🥢 滷味：滷蛋 $15 / 豆干 $15 / 鴨頭 $30",
            "🧋 飲料：冰飲 $35 / 咖啡 $40 / 手工搖飲 $50",
            "📦 其他：香菸 $100 / 檳榔 $50",
            "━━━━━━━━━━━━━━━",
            "📝 點餐：@order 排骨便當x2 + 涼麵x1",
        ]
        return "\n".join(lines)

    if cmd in ["我的訂單", "看訂單", "訂單"]:
        return format_user_orders(user_id)

    # 取消訂單
    if cmd.startswith("取消 ") or cmd.startswith("cancel "):
        cancel_id = re.search(r'[#@]?(\w{6,8})', cmd)
        if not cancel_id:
            return "❌ 請指定訂單ID，例如：@order 取消 #ABC12345"
        oid = cancel_id.group(1).upper()
        order = orders_db.get(oid)
        if not order:
            return f"❌ 找不到訂單 #{oid}"
        if order.get('user_id') != user_id:
            return "❌ 只有訂購人可以取消自己的訂單"
        if order['status'] not in ('pending', 'preparing'):
            return f"❌ 訂單 #{oid} 已經在「{STATUS_NAMES.get(order['status'], order['status'])}」狀態，無法取消"
        order['status'] = 'cancelled'
        return f"✅ 訂單 #{oid} 已取消"

    # 製作訂單
    items, total = parse_order(cmd)
    if not items:
        return f"❌ 找不太到「{cmd}」，請確認品名後再傳一次\n\n📝 範例：@order 排骨便當x2 + 涼麵x1"

    # 建立訂單
    order_id = gen_order_id()
    order = {
        "id": order_id,
        "user_id": user_id,
        "user_name": user_name,
        "items": items,
        "total": total,
        "location": "外送",
        "status": "pending",
        "created_at": datetime.now().strftime("%m/%d %H:%M"),
    }
    save_order(order)

    # 回覆用戶
    lines = [
        f"✅ {user_name} 已點餐",
        f"📋 訂單 #{order_id}",
        "━━━━━━━━━━━━━━━",
    ]
    for item in items:
        lines.append(f"• {item['name']} x{item['qty']} = ${item['price'] * item['qty']}")
    lines += [
        "━━━━━━━━━━━━━━━",
        f"💰 合計：${total}",
        "⏳ 等待廚房確認中...",
    ]
    reply_text = "\n".join(lines)

    # Push 給蘇董（廚房）
    push_lines = [
        f"🏎 新訂單 from {user_name}",
        f"📋  #{order_id}",
        "━━━━━━━━━━━━━━━",
    ]
    for item in items:
        push_lines.append(f"• {item['name']} x{item['qty']}")
    push_lines += [
        "━━━━━━━━━━━━━━━",
        f"💰 合計：${total}",
        f"🕐 {order['created_at']}",
    ]

    line_reply(reply_token, reply_text)
    line_push(LINE_USER_ID, "\n".join(push_lines))
    return None  # 已回覆

# ==================== 路由 ====================

@app.route("/")
def index():
    return "粉紅超跑點餐系統 v2 - 正常運作中 ✅"

# ---- LINE Webhook ----
@app.route("/webhook", methods=["POST"])
def webhook():
    try:
        body = request.get_json()
        for event in body.get("events", []):
            if event["type"] != "message" or event["message"]["type"] != "text":
                continue

            user_id    = event["source"]["userId"]
            reply_token = event.get("replyToken", "")
            text        = event["message"]["text"].strip()
            user_name   = line_get_profile(user_id)

            if text.lower().startswith("@order") or text.lower().startswith("/order"):
                cmd = text.split(maxsplit=1)[1].strip() if len(text.split(maxsplit=1)) > 1 else ""
                reply_text = handle_order_command(cmd, user_id, user_name, reply_token)
                if reply_text:
                    line_reply(reply_token, reply_text)
            else:
                reply_text = f"📌 收到：{text}\n要點餐請傳「@order 品項x數量」\n例如：@order 排骨便當x2 + 涼麵x1"
                line_reply(reply_token, reply_text)

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/webhook", methods=["GET"])
def webhook_get():
    return jsonify({"status": "ok"})

# ---- 圖片分析 ----
@app.route("/analyze", methods=["POST"])
def analyze():
    try:
        img_data = request.files["file"].read() if "file" in request.files \
            else requests.get(request.form["image_url"], timeout=10).content
        b64 = base64.b64encode(img_data).decode()
        resp = requests.post(
            "https://api.minimax.chat/v1/vision_feed",
            headers={"Authorization": f"Bearer {MINIMAX_API_KEY}", "Content-Type": "application/json"},
            json={"model": "MiniMax-VL-01", "image": f"data:image/jpeg;base64,{b64}",
                  "prompt": "請詳細分析這張圖片中的文字和內容，以JSON格式回覆。"},
            timeout=30
        )
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---- 網頁點餐 ----
@app.route("/order", methods=["POST"])
def order():
    try:
        data = request.get_json()
        name   = data.get("name", "")
        phone  = data.get("phone", "")
        items  = data.get("items", [])
        total  = data.get("total", 0)
        loc    = data.get("location", "")
        user_id = data.get("user_id", "web_user")
        user_name = name or "網頁顧客"

        order_id = gen_order_id()
        order = {
            "id": order_id,
            "user_id": user_id,
            "user_name": user_name,
            "items": items,
            "total": total,
            "location": loc,
            "status": "pending",
            "created_at": datetime.now().strftime("%m/%d %H:%M"),
        }
        save_order(order)

        lines = [
            "🚗 粉紅超跑點餐服務",
            "━━━━━━━━━━━━━━━",
            f"👤 {name}",
            f"📞 {phone}",
            "━━━━━━━━━━━━━━━",
        ]
        for item in items:
            lines.append(f"• {item['name']} x{item['qty']} = ${item['price']}")
        lines += [
            "━━━━━━━━━━━━━━━",
            f"📍 外送：{loc}",
            f"💰 合計：${total}",
            f"🕐 {order['created_at']}",
        ]
        line_push(LINE_USER_ID, "\n".join(lines))
        return jsonify({"success": True, "order_id": order_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ---- 廚房面板 ----
@app.route("/kitchen")
def kitchen():
    # 所有未完成的訂單
    active = [o for o in orders_db.values() if o['status'] not in ('delivered', 'cancelled')]
    active.sort(key=lambda x: x['created_at'])

    # 狀態分組
    pending   = [o for o in active if o['status'] == 'pending']
    preparing = [o for o in active if o['status'] == 'preparing']
    ready     = [o for o in active if o['status'] == 'ready']

    html = """
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>👨‍🍳 粉紅超跑廚房面板</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Noto Sans TC', sans-serif; background: #1a1a2e; color: #fff; min-height: 100vh; }
.header { background: linear-gradient(135deg, #ff6b9d, #ff8fab); padding: 16px 24px; font-size: 22px; font-weight: 700; text-align: center; }
.header span { font-size: 13px; opacity: 0.9; font-weight: 400; }
.main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 16px; max-width: 1400px; margin: 0 auto; }
.col { background: #16213e; border-radius: 16px; padding: 16px; }
.col-title { font-size: 15px; font-weight: 700; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid; }
.col-title.pending   { color: #ffd93d; border-color: #ffd93d; }
.col-title.preparing { color: #6bcbff; border-color: #6bcbff; }
.col-title.ready     { color: #6bff6b; border-color: #6bff6b; }
.count { font-size: 12px; opacity: 0.7; float: right; }
.order-card { background: #0f3460; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
.order-id { font-size: 12px; color: #aaa; margin-bottom: 4px; }
.order-name { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 6px; }
.order-item { font-size: 13px; color: #ddd; padding: 2px 0; }
.order-total { font-size: 14px; font-weight: 700; color: #ff6b9d; margin-top: 6px; }
.order-time { font-size: 11px; color: #888; margin-top: 4px; }
.btn-row { display: flex; gap: 6px; margin-top: 10px; }
.btn { flex: 1; padding: 8px; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'Noto Sans TC', sans-serif; transition: transform 0.2s; }
.btn:hover { transform: scale(0.97); }
.btn-next   { background: #6bcbff; color: #000; }
.btn-done   { background: #6bff6b; color: #000; }
.btn-cancel { background: #ff4444; color: #fff; }
.order-card.new { box-shadow: 0 0 0 2px #ffd93d; }
.footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  👨‍🍳 粉紅超跑廚房面板
  <br><span>共 {total} 張未完成訂單</span>
</div>
<div class="main">
  <div class="col">
    <div class="col-title pending">⏳ 待製作<span class="count">{pc} 單</span></div>
    {pending_cards}
  </div>
  <div class="col">
    <div class="col-title preparing">👨‍🍳 製作中<span class="count">{prc} 單</span></div>
    {preparing_cards}
  </div>
  <div class="col">
    <div class="col-title ready">✅ 完成待取<span class="count">{rc} 單</span></div>
    {ready_cards}
  </div>
</div>
<div class="footer">🚗 粉紅超跑點餐系統 | 自動更新</div>
<script>
// 自動更新
setInterval(() => location.reload(), 15000);

function updateStatus(orderId, newStatus) {{
  fetch('/kitchen/update', {{
    method: 'POST',
    headers: {{'Content-Type': 'application/json'}},
    body: JSON.stringify({{orderId, status: newStatus}})
  }}).then(r => r.json()).then(d => {{
    if (d.success) location.reload();
  }});
}}
</script>
</body>
</html>"""

    def make_card(o, highlight=False):
        cls = "order-card new" if highlight else "order-card"
        items_html = "".join(f"<div class=order-item>• {i['name']} x{i['qty']}</div>" for i in o['items'])
        btns = ""
        if o['status'] == 'pending':
            btns = f"<div class=btn-row><button class=btn btn-next onclick=updateStatus('{o['id']}','preparing')>▶ 開始製作</button><button class=btn btn-cancel onclick=updateStatus('{o['id']}','cancelled')>✕ 取消</button></div>"
        elif o['status'] == 'preparing':
            btns = f"<div class=btn-row><button class=btn btn-done onclick=updateStatus('{o['id']}','ready')>✅ 完成</button><button class=btn btn-cancel onclick=updateStatus('{o['id']}','cancelled')>✕ 取消</button></div>"
        elif o['status'] == 'ready':
            btns = f"<div class=btn-row><button class=btn btn-done onclick=updateStatus('{o['id']}','delivered')>🚗 已外送</button></div>"
        return f"<div class='{cls}'><div class=order-id>#{o['id']}</div><div class=order-name>{o.get('user_name','匿名')}</div>{items_html}<div class=order-total>${o['total']}</div><div class=order-time>{o['created_at']}</div>{btns}</div>"

    pending_cards   = "".join(make_card(o) for o in pending)
    preparing_cards = "".join(make_card(o) for o in preparing)
    ready_cards    = "".join(make_card(o) for o in ready)

    if not active:
        empty = "<div style='text-align:center;color:#555;padding:40px'>目前沒有訂單</div>"
        pending_cards = preparing_cards = ready_cards = empty

    return html.format(
        total=len(active),
        pc=len(pending), prc=len(preparing), rc=len(ready),
        pending_cards=pending_cards,
        preparing_cards=preparing_cards,
        ready_cards=ready_cards,
    )

# ---- 廚房更新狀態 ----
@app.route("/kitchen/update", methods=["POST"])
def kitchen_update():
    try:
        data = request.get_json()
        oid    = data.get("orderId", "").upper()
        status = data.get("status", "")
        if status not in STATUS_LIST:
            return jsonify({"success": False, "error": "無效狀態"})

        order = orders_db.get(oid)
        if not order:
            return jsonify({"success": False, "error": "找不到訂單"})

        order["status"] = status
        # Notify user
        status_msg = {
            "preparing": "👨‍🍳 您的訂單已開始製作，請稍候",
            "ready": "✅ 您的訂單已完成製作，等待取餐/外送",
            "delivered": "🚗 您的訂單已外送完成，祝您用餐愉快！",
            "cancelled": "❌ 您的訂單已取消",
        }
        msg = status_msg.get(status, f"📋 訂單 #{oid} 狀態更新為：{STATUS_NAMES.get(status, status)}")
        line_push(order.get("user_id", ""), msg)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ---- LINE 測試 ----
@app.route("/test-line")
def test_line():
    line_push(LINE_USER_ID, "✅ LINE 通知測試成功！")
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)