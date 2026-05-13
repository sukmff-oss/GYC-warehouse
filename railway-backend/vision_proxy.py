"""
Vision Proxy + LINE 點餐通知 - Railway Ready + CORS
"""
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import requests

app = Flask(__name__)
CORS(app)

# ===== MiniMax API 設定 =====
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")

# ===== LINE Messaging API 設定 =====
LINE_CHANNEL_ID = os.environ.get("LINE_CHANNEL_ID", "2010079227")
LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
LINE_USER_ID = os.environ.get("LINE_USER_ID", "U42399a8c32c2980e1df24f3a22e3146d")
LINE_ACCESS_TOKEN = os.environ.get("LINE_ACCESS_TOKEN", "")
LINE_API_PUSH = "https://api.line.me/v2/bot/message/push"

# ==================== LINE 發訊息 ====================
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
        response = requests.post(LINE_API_PUSH, headers=headers, json=payload, timeout=10)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

# ==================== 首頁 ====================
@app.route("/")
def index():
    return "Vision Proxy OK"

# ==================== 圖片分析（MiniMax Vision）====================
@app.route("/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files and "image_url" not in request.form:
        return jsonify({"error": "無圖片"}), 400
    
    try:
        if "file" in request.files:
            file = request.files["file"]
            img_data = file.read()
        else:
            image_url = request.form["image_url"]
            resp = requests.get(image_url, timeout=10)
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
        response = requests.post(
            "https://api.minimax.chat/v1/vision_feed",
            headers=headers,
            json=payload,
            timeout=30
        )
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==================== LINE 點餐 API ====================
@app.route("/order", methods=["POST"])
def order():
    try:
        data = request.get_json()
        items = data.get("items", [])
        total = data.get("total", 0)
        
        lines = ["🍜 國研化工員工餐廳", "━━━━━━━━━━━━━━━"]
        for item in items:
            lines.append(f"• {item['name']} x{item['qty']} = ${item['price']}")
        lines.append("━━━━━━━━━━━━━━━")
        lines.append(f"💰 合計：${total}")
        lines.append(f"🕐 時間：{data.get('time', '')}")
        
        message = "\n".join(lines)
        result = line_push_message(message)
        
        return jsonify({"success": True, "line_result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ==================== LINE 測試 ====================
@app.route("/test-line")
def test_line():
    result = line_push_message("✅ LINE 通知測試成功！國研化工員工餐廳系統已就緒。")
    return jsonify(result)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
