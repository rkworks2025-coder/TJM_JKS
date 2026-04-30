const GAS_API_URL = "https://script.google.com/macros/s/AKfycbywQoNFA2x7qn8cMelt_5OVPiNumBYqPbTNnK3nzXWv59q0FmP2Mt8qmVxT5Zk6wPEr/exec";

let currentArea = 'tama'; 
let currentMode = 'normal';
let pollInterval = null;
let updateClickTime = 0;
let cachedLocation = null; 

function generateRequestId() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

window.onload = function() {
  const savedArea = localStorage.getItem('jks_area_mode');
  if (savedArea && (savedArea === 'tama' || savedArea === 'kanagawa')) {
    switchArea(savedArea);
  } else {
    switchArea('tama'); 
  }

  const savedMode = localStorage.getItem('jks_display_mode');
  if (savedMode && (savedMode === 'normal' || savedMode === 'cluster')) {
    switchMode(savedMode);
  } else {
    switchMode('normal');
  }
};

function switchArea(area) {
  currentArea = area;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.area === area) btn.classList.add('active');
  });

  const btn = document.getElementById('scan-btn');
  btn.className = ''; 
  if (area === 'tama') {
    btn.classList.add('ready-tama');
    btn.textContent = "📡 多摩をスキャン";
  } else {
    btn.classList.add('ready-kanagawa');
    btn.textContent = "📡 神奈川をスキャン";
  }
  document.getElementById('area-badge').textContent = (area === 'tama') ? 'TAMA' : 'KNGW';
  localStorage.setItem('jks_area_mode', area);
}

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.mode === mode) btn.classList.add('active');
  });
  localStorage.setItem('jks_display_mode', mode);
}

function triggerUpdate() {
  const btn = document.getElementById('update-btn');
  const timeLabel = document.getElementById('last-update-time');
  
  const areaLabel = (currentArea === 'tama') ? "多摩エリア" : "神奈川エリア";
  if (!confirm(`【${areaLabel}】のデータ更新を開始しますか？`)) return;

  btn.disabled = true;
  btn.textContent = "更新確認中...";
  timeLabel.textContent = "起動中...";
  updateClickTime = Date.now(); 

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cachedLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        console.log("GPSキャッシュ保存完了");
      },
      (err) => { console.log("バックグラウンドGPS取得エラー:", err); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  const payload = { action: "update", area: currentArea, requestId: generateRequestId() };

  const sendPostRequest = (retryCount = 0) => {
    fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
      if (data.result === "OK") {
        showToast(`✅ ${areaLabel} 更新開始`);
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(checkStatus, 30000); 
      } else {
        showToast(`⚠️ エラー: ${data.error || "不明"}`);
        resetUpdateBtn();
      }
    })
    .catch(err => {
      if (retryCount < 2) {
        console.log(`通信エラー、リトライします (${retryCount + 1}/2)`);
        setTimeout(() => sendPostRequest(retryCount + 1), 2000); 
      } else {
        showToast("❌ 通信エラー（再送失敗）");
        resetUpdateBtn();
      }
    });
  };

  sendPostRequest();
}

function checkStatus() {
  const targetUrl = `${GAS_API_URL}?action=status`;
  fetch(targetUrl)
    .then(response => response.json())
    .then(data => {
      if (data.result === "OK" && data.timestamp) {
        const serverTime = parseInt(data.timestamp);
        if (serverTime > updateClickTime) {
          finishUpdate(serverTime);
        }
      }
    })
    .catch(err => console.log("Status check failed"));
}

function finishUpdate(timestamp) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
  const btn = document.getElementById('update-btn');
  const timeLabel = document.getElementById('last-update-time');
  
  const date = new Date(timestamp);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');

  btn.textContent = "↻ データ更新";
  btn.disabled = false;
  timeLabel.textContent = `✅ 最終更新 ${h}:${m}`;
  timeLabel.style.color = "#00bfff";
  showToast("✅ データ更新が完了しました");
}

function resetUpdateBtn() {
  const btn = document.getElementById('update-btn');
  const timeLabel = document.getElementById('last-update-time');
  btn.textContent = "↻ データ更新";
  btn.disabled = false;
  timeLabel.textContent = "";
  if (pollInterval) clearInterval(pollInterval);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.opacity = "1";
  setTimeout(() => { t.style.opacity = "0"; }, 3000);
}

function startScan() {
  const btn = document.getElementById('scan-btn');
  const msg = document.getElementById('status-msg');
  const list = document.getElementById('result-list');

  if (!GAS_API_URL.startsWith("http")) {
    showError("コード内のGAS_API_URLを設定してください");
    return;
  }
  if (!navigator.geolocation) {
    showError("GPSがサポートされていません");
    return;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  
  list.innerHTML = '<div id="missing-alert-box" class="missing-alert"></div>';

  if (cachedLocation) {
    btn.textContent = "通信中(GPSキャッシュ利用)...";
    msg.className = ""; 
    msg.textContent = `API照会中...`;
    
    const lat = cachedLocation.lat;
    const lng = cachedLocation.lng;
    
    cachedLocation = null; 
    executeScanApi(lat, lng, originalText);
  } else {
    btn.textContent = "位置特定中...";
    btn.style.opacity = "0.7";
    msg.className = ""; 
    msg.textContent = "GPS信号を受信しています...";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.textContent = "通信中...";
        msg.textContent = `API照会中...`;
        executeScanApi(pos.coords.latitude, pos.coords.longitude, originalText);
      },
      (err) => {
        let errorText = "GPSエラー: ";
        switch(err.code) {
          case 1: errorText += "許可されていません"; break;
          case 2: errorText += "位置を特定できません"; break;
          case 3: errorText += "タイムアウト"; break;
          default: errorText += err.message;
        }
        showError(errorText);
        resetBtn(originalText);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
}

function executeScanApi(lat, lng, originalText) {
  const targetUrl = `${GAS_API_URL}?action=scan&lat=${lat}&lng=${lng}&area=${currentArea}`;

  fetch(targetUrl)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return response.json();
    })
    .then(data => {
      if(data.error) {
        handleServerError(data.error, originalText);
      } else {
        renderResults(data, originalText);
      }
    })
    .catch(err => {
      handleServerError(err.message, originalText);
    });
}

function renderResults(data, originalText) {
  const list = document.getElementById('result-list');
  const msg = document.getElementById('status-msg');
  resetBtn(originalText);

  list.innerHTML = '<div id="missing-alert-box" class="missing-alert"></div>';
  const alertBox = document.getElementById('missing-alert-box');

  if (data.missing && data.missing.length > 0) {
    alertBox.style.display = "block";
    alertBox.innerHTML = '<div class="missing-title">⚠️ 表示不可（データ不整合）</div>' +
                         data.missing.join('<br>');
  }

  if (!data.items || data.items.length === 0) {
    list.insertAdjacentHTML('beforeend', '<div class="empty-state">このエリアに<br>作業可能な車両はありません</div>');
    msg.textContent = "検索完了: 0件";
    return;
  }

  let displayItems = [];

  if (currentMode === 'cluster') {
    const groups = new Map();
    data.items.forEach(item => {
      if (!groups.has(item.station)) groups.set(item.station, []);
      groups.get(item.station).push(item);
    });

    const stations = Array.from(groups.values());
    
    stations.forEach(group => {
      const rep = group.find(c => c.isUrgent) || group[0];
      const activeCount = group.length;
      const total = rep.stationTotal || activeCount;
      const checked = rep.stationChecked || 0;
      const remaining = total - checked;

      // ★ 厳格な完遂表示ロジック ★
      let shouldShow = false;
      
      if (remaining === 1 && activeCount >= 1) {
        shouldShow = true;
      } else if (remaining === 2 && activeCount >= 2) {
        shouldShow = true;
      } else if (remaining === 3 && activeCount >= 3) {
        shouldShow = true;
      } else if (total >= 4 && remaining >= 4 && activeCount >= 2) {
        // マンモス特例: 全4台以上、残4台以上で、2台以上空いていれば表示
        shouldShow = true;
        
        // ★追加: 1台残し（端数）の完全禁止フィルター
        // 作業後に「残り1台」になってしまう場合は、特例であっても強制的に非表示にする
        if ((remaining - activeCount) === 1) {
          shouldShow = false;
        }
      }

      if (shouldShow) {
        rep.clusterInfo = {
          activeCount: activeCount,
          total: total,
          remaining: remaining
        };
        displayItems.push(rep);
      }
    });
    
    displayItems = displayItems.slice(0, 5);
    
    if (displayItems.length === 0) {
      list.insertAdjacentHTML('beforeend', '<div class="empty-state">完遂条件を満たすステーションが<br>見つかりません</div>');
      msg.textContent = "検索完了: 対象なし";
      return;
    }
    
    msg.textContent = `検索完了: 完遂可能 ${displayItems.length} ステーション`;

  } else {
    // Normal Mode
    displayItems = data.items.slice(0, 8);
    msg.textContent = `検索完了: ${displayItems.length}件を表示 (Normal)`;
  }

  displayItems.forEach(item => {
    const urgentClass = item.isUrgent ? "urgent-active" : "";
    const mapUrl = "http://maps.google.com/maps?q=" + item.lat + "," + item.lng;
    
    let distDisplay = item.distance;
    let unitDisplay = "m";
    if (item.distance >= 1000) {
      distDisplay = (item.distance / 1000).toFixed(1); 
      unitDisplay = "km";
    }

    let distStyle = (item.isUrgent && item.distance < 1000) ? "color: #FFD700;" : "";
    const timeColor = item.isUrgent ? "#ff4444" : "#00bfff";

    const durationMin = Math.round(item.duration / 60);
    let durationColor = "#ff4444"; 
    if (durationMin <= 5) durationColor = "#00cc66"; 
    else if (durationMin <= 10) durationColor = "#FFD700"; 

    let clusterBadgeHtml = "";
    if (currentMode === 'cluster' && item.clusterInfo) {
      const info = item.clusterInfo;
      if (info.activeCount === 1 && info.total === 1) {
         clusterBadgeHtml = `<div class="cluster-badge single">単 1台 <span class="cluster-stats">(全${info.total}台)</span></div>`;
      } else {
         clusterBadgeHtml = `<div class="cluster-badge">複 ${info.activeCount}台 <span class="cluster-stats">(残${info.remaining}/全${info.total}台)</span></div>`;
      }
    }

    const html = `
      <div class="card">
        <div class="card-header">
          <div style="display: flex; align-items: center;">
            <div class="dist-badge" style="${distStyle}">
              ${distDisplay} <span class="dist-unit">${unitDisplay}</span>
            </div>
            <div class="duration-badge" style="color: ${durationColor};">
              ${durationMin} <span class="time-unit">min</span>
            </div>
            <span class="urgent-badge ${urgentClass}">1-3h</span>
          </div>
          <a href="${mapUrl}" target="_blank" class="nav-btn">NAV ↗</a>
        </div>
        <div class="card-body">
          ${clusterBadgeHtml}
          <div class="station-name">${item.station}</div>
          <div class="car-info">
            <span class="plate">${item.plate}</span>
            <span>/ ${item.model}</span>
          </div>
          <div class="time-info">
            <span>残り空き時間:</span>
            <span class="time-val" style="color:${timeColor}">${item.availableHours}h</span>
          </div>
        </div>
      </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
  });
}

function handleServerError(msgText, originalText) {
  showError("エラーが発生しました: " + msgText);
  resetBtn(originalText);
}

function showError(text) {
  const msg = document.getElementById('status-msg');
  msg.textContent = text;
  msg.className = "error-text";
}

function resetBtn(text) {
  const btn = document.getElementById('scan-btn');
  btn.disabled = false;
  btn.textContent = text || "📡 周辺スキャン";
  btn.style.opacity = "1";
}
