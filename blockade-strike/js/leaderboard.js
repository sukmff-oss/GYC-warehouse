// ============ 世界殺敵排行（JSONBin 雲端儲存 · TOP 15） ============
// 公開 bin：讀取不需要金鑰；寫入（PUT）才帶 X-Master-Key。
const BIN = '6a6cca97da38895dfea93614';
const LB_URL = `https://api.jsonbin.io/v3/b/${BIN}`;
const LB_KEY = '$2a$10$hF/oSN.17AgBQ8RhDv8uEukBD/0dj6YhQnmnEZB/RvbEJrd2nevty';
const NAME_KEY = 'blockade-strike-name';

export function playerName() {
  let n = null;
  try { n = localStorage.getItem(NAME_KEY); } catch (e) { /* 忽略 */ }
  if (!n) {
    n = '玩家' + Math.floor(1000 + Math.random() * 9000);
    try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 忽略 */ }
  }
  return n;
}

export function setPlayerName(n) {
  n = String(n || '').trim().slice(0, 12);
  try { if (n) localStorage.setItem(NAME_KEY, n); } catch (e) { /* 忽略 */ }
  return playerName();
}

// cb(rows|null)：null 表示載入失敗（離線）
export function fetchLeaderboard(cb) {
  fetch(LB_URL + '/latest')
    .then(r => r.json())
    .then(d => {
      const list = (d.record && d.record.scores) || [];
      cb(list.sort((a, b) => b.kills - a.kills).slice(0, 15));
    })
    .catch(() => cb(null));
}

// 讀-改-寫合併，僅保留前 15 名（殺敵數排序）
export function submitKills(kills, mapName) {
  if (!kills || kills <= 0) return;
  const entry = { name: playerName(), kills, map: mapName || '', time: Date.now() };
  fetch(LB_URL + '/latest', { headers: { 'X-Master-Key': LB_KEY } })
    .then(r => r.json())
    .then(d => {
      const scores = (d.record && d.record.scores) || [];
      scores.push(entry);
      scores.sort((a, b) => b.kills - a.kills);
      fetch(LB_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': LB_KEY },
        body: JSON.stringify({ scores: scores.slice(0, 15) }),
      }).catch(() => {});
    })
    .catch(() => {});
}
