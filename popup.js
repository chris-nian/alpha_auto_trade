document.addEventListener('DOMContentLoaded', function() {
    const amountInput = document.getElementById('amount');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDiv = document.getElementById('status');

    loadSettings();

    startBtn.addEventListener('click', function() {
        const amount = parseFloat(amountInput.value);
        
        if (!amount || amount < 0.1) {
            alert('请输入有效的交易金额（最小0.1 USDT）');
            return;
        }

        saveSettings();
        sendMessageToContentScript({
            action: 'start',
            amount: amount
        });
        
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        updateStatus('启动中...', 'active');
    });

    stopBtn.addEventListener('click', function() {
        sendMessageToContentScript({
            action: 'stop'
        });
        
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        updateStatus('已停止', '');
    });

    function sendMessageToContentScript(message) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, message);
            }
        });
    }

    function updateStatus(text, className) {
        statusDiv.textContent = text;
        statusDiv.className = 'status ' + className;
    }

    function saveSettings() {
        const settings = {
            amount: amountInput.value
        };
        chrome.storage.local.set({binanceAutoTradeSettings: settings});
    }

    function loadSettings() {
        chrome.storage.local.get(['binanceAutoTradeSettings'], function(result) {
            if (result.binanceAutoTradeSettings) {
                amountInput.value = result.binanceAutoTradeSettings.amount || '';
            }
        });
    }

    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (message.action === 'updateStatus') {
            updateStatus(message.status, message.className || '');
        }
    });

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0] && tabs[0].url.includes('binance.com/zh-CN/alpha/')) {
            updateStatus('已连接到交易页面', 'active');
        } else {
            updateStatus('请打开币安Alpha交易页面', 'error');
        }
    });
});