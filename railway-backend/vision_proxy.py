"""
Vision Proxy + LINE 點餐系統 - 支援網頁訂餐 + LINE 群組指令
"""
import os
import re
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import requests

app = Flask(__name__)
CORS(app)

# ===== MiniMax API 設定 =====
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")

# ===== LINE Messaging API 設定 =====
LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
LINE_ACCESS_TOKEN   = os.environ.get("LINE_ACCESS_TOKEN", "")
LINE_USER_ID        = os.environ.get("LINE_USER_ID", "U42399a8c32c2980e1df24f3a22e3146d")
LINE_API_PUSH  = "https://api.line.me/v2/bot/message/push"
LINE_API_REPLY = "https://api.line.me/v2/bot/message/reply"
LINE_API_PROFILE = "https://api.line.me/v2/bot/profile"

# ===== 菜單資料（與網頁同步）=====
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

# ===== LINE Push（主動推給蘇董）=====
def line_push_message(message_text):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LINE_ACCESS_TOKEN}"
    }
    payload = {
        "to": LINE_USER_ID,
        "messages": [{"type": "text", "text": message_text}]
    }
    try:
        resp = requests.post(LINE_API_PUSH, headers=headers, json=payload, timeout=10)
        return resp.json()
    except Exception as e:
        return {"error": str(e)}

# ===== LINE Reply（在群組回覆）=====
def line_reply(reply_token, message_text):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LINE_ACCESS_TOKEN}"
    }
    payload = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": message_text}]
    }
    try:
        resp = requests.post(LINE_API_REPLY, headers=headers, json=payload, timeout=10)
        return resp.json()
    except Exception as e:
        return {"error": str(e)}

# ===== LINE 取得用戶顯示名 ======
def line_get_profile(user_id):
    headers = {"Authorization": f"Bearer {LINE_ACCESS_TOKEN}"}
    try:
        resp = requests.get(f"{LINE_API_PROFILE}/{user_id}", headers=headers, timeout=10)
        if resp.ok:
            return resp.json().get("displayName", user_id)
    except:
        pass
    return user_id

# ===== 解析訂餐指令 ======
def parse_order(text):
    """
    解析 "排骨便當x2 + 涼麵x1" 或 "排骨便當 x2,涼麵 x1"
    回傳 [(品名, 數量, 單價), ...] 和總金額
    """
    items = []
    # 支援 + 或 , 分隔
    parts = re.split(r'[+,]', text)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # 找 "品名x數量" 或 "品名 x 數量" 或 "品名 數量"
        m = re.match(r'(.+?)\s*[xX×]\s*(\d+)', part)
        if m:
            name = m.group(1).strip()
            qty = int(m.group(2))
        else:
            # 只有品名，預設數量 1
            name = part
            qty = 1

        # 比對菜單（模糊比對）
        matched = None
        for item in MENU:
            if name in item['name'] or item['name'] in name:
                matched = item
                break

        if matched:
            items.append({
                "name": matched['name'],
                "qty": qty,
                "price": matched['price'],
                "id": matched['id']
            })

    total = sum(i['price'] * i['qty'] for i in items)
    return items, total

# ===== 格式化訂單訊息 ======
def format_order_text(items, total, user_name, location="外送"):
    lines = [
        f"🚗 粉紅超跑點餐 — {user_name}",
        "━━━━━━━━━━━━━━━",
    ]
    for item in items:
        lines.append(f"• {item['name']} x{item['qty']} = ${item['price'] * item['qty']}")
    lines += [
        "━━━━━━━━━━━━━━━",
        f"📍 方式：{location}",
        f"💰 合計：${total}",
        f"🕐 時間：",
    ]
    return "\n".join(lines)

# ===== 完整菜單文字 ======
def get_menu_text():
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
        "📝 範例：@order 排骨便當x2 + 涼麵x1",
    ]
    return "\n".join(lines)

# ==================== 首頁 ====================
@app.route("/")
def index():
    return "Vision Proxy OK - 粉紅超跑點餐系統"

# ==================== LINE Webhook（接收群訊息）====================
@app.route("/webhook", methods=["POST"])
def webhook():
    try:
        body = request.get_json()
        events = body.get("events", [])

        for event in events:
            etype = event.get("type")
            source = event.get("source", {})
            reply_token = event.get("replyToken", "")
            user_id = source.get("userId", "")

            # 取得用戶顯示名
            user_name = line_get_profile(user_id)

            if etype == "message":
                msg = event.get("message", {})
                msg_type = msg.get("type")
                text = msg.get("text", "").strip()

                if msg_type != "text":
                    continue

                # 指令開頭：@order 或 /order
                if text.lower().startswith("@order") or text.lower().startswith("/order"):
                    cmd = text.split(maxsplit=1)[1].strip() if len(text.split(maxsplit=1)) > 1 else ""

                    if not cmd:
                        reply_text = get_menu_text()

                    elif cmd in ["看菜單", "菜單", "menu"]:
                        reply_text = get_menu_text()

                    else:
                        # 解析訂單
                        items, total = parse_order(cmd)
                        if not items:
                            reply_text = f"❌ 找不太到「{cmd}」，請確認品名後再傳一次"
                        else:
                            # 組成訂單摘要
                            lines = [
                                f"✅ {user_name} 已點餐",
                                "━━━━━━━━━━━━━━━",
                            ]
                            for item in items:
                                lines.append(f"• {item['name']} x{item['qty']} = ${item['price'] * item['qty']}")
                            lines += [
                                "━━━━━━━━━━━━━━━",
                                f"💰 合計：${total}",
                            ]
                            reply_text = "\n".join(lines)

                            # 同時 Push 給蘇董
                            order_lines = [
                                f"🚗 新訂單 from {user_name}",
                                "━━━━━━━━━━━━━━━",
                            ]
                            for item in items:
                                order_lines.append(f"• {item['name']} x{item['qty']}")
                            order_lines += [
                                "━━━━━━━━━━━━━━━",
                                f"💰 合計：${total}",
                            ]
                            line_push_message("\n".join(order_lines))

                else:
                    # 非指令訊息，Echo 回覆
                    reply_text = f"📌 收到：{text}\n\n要點餐請傳「@order 品項x數量」\n例如：@order 排骨便當x2 + 涼麵x1"
                    line_reply(reply_token, reply_text)
                    continue

                # 回覆到 LINE
                if reply_token and reply_text:
                    line_reply(reply_token, reply_text)

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==================== LINE Webhook 驗證（GET）====================
@app.route("/webhook", methods=["GET"])
def webhook_verify():
    return jsonify({"status": "ok", "message": "LINE Webhook Ready"})

# ==================== 圖片分析（MiniMax Vision）====================
@app.route("/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files and "image_url" not in request.form:
        return jsonify({"error": "無圖片"}), 400

    try:
        if "file" in request.files:
            img_data = request.files["file"].read()
        else:
            resp = requests.get(request.form["image_url"], timeout=10)
            img_data = resp.content

        base64_image = base64.b64encode(img_data).decode()
        headers = {
            "Authorization": f"Bearer {MINIMAX_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "MiniMax-VL-01",
            "image": f"data:image/jpeg;base64,{base64_image}",
            "prompt": "請詳細分析這張圖片中的文字和內容，以JSON格式回覆。"
        }
        resp = requests.post(
            "https://api.minimax.chat/v1/vision_feed",
            headers=headers, json=payload, timeout=30
        )
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==================== 網頁點餐 API（POST /order）====================
@app.route("/order", methods=["POST"])
def order():
    try:
        data = request.get_json()
        items  = data.get("items", [])
        total  = data.get("total", 0)
        name   = data.get("name", "")
        phone  = data.get("phone", "")
        loc    = data.get("location", "")

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
            f"🕐 時間：{data.get('time', '')}",
        ]

        result = line_push_message("\n".join(lines))
        return jsonify({"success": True, "line_result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ==================== LINE 測試 ====================
@app.route("/test-line")
def test_line():
    result = line_push_message("✅ LINE 通知測試成功！國研化工外送系統已就緒。")
    return jsonify(result)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)