class BinanceAutoTrader {
    constructor() {
        this.isRunning = false;
        this.currentAmount = 0;
        this.ui = null;
        this.logContainer = null;
        this.statusDisplay = null;
        this.currentState = 'idle'; // idle, buying, monitoring_buy, selling, monitoring_sell
        this.orderCheckInterval = null;
        this.dragOffset = { x: 0, y: 0 };
        
        this.init();
    }

    init() {
        this.createUI();
        this.setupMessageListener();
        this.log('插件已加载', 'info');
    }

    createUI() {
        this.ui = document.createElement('div');
        this.ui.id = 'binance-auto-trader';
        this.ui.innerHTML = `
            <div class="header">
                <div class="title">币安Alpha自动交易</div>
                <button class="minimize-btn" id="minimize-btn">—</button>
            </div>
            <div class="content">
                <div class="input-row">
                    <label for="trade-amount">交易金额 (USDT):</label>
                    <input type="number" id="trade-amount" placeholder="输入金额" step="0.1" min="0.1">
                </div>
                <div class="status-display" id="status-display">等待开始</div>
                <div class="control-buttons">
                    <button class="control-btn start-btn" id="start-btn">开始交易</button>
                    <button class="control-btn stop-btn" id="stop-btn" style="display: none;">停止交易</button>
                </div>
                <div class="log-container" id="log-container"></div>
            </div>
        `;

        document.body.appendChild(this.ui);
        this.logContainer = document.getElementById('log-container');
        this.statusDisplay = document.getElementById('status-display');

        this.setupUIEvents();
        this.makeDraggable();
    }

    setupUIEvents() {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const minimizeBtn = document.getElementById('minimize-btn');

        startBtn.addEventListener('click', () => this.startTrading());
        stopBtn.addEventListener('click', () => this.stopTrading());
        minimizeBtn.addEventListener('click', () => this.toggleMinimize());
    }

    makeDraggable() {
        const header = this.ui.querySelector('.header');
        let isDragging = false;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            this.ui.classList.add('dragging');
            const rect = this.ui.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;
            
            this.ui.style.left = Math.max(0, Math.min(window.innerWidth - this.ui.offsetWidth, x)) + 'px';
            this.ui.style.top = Math.max(0, Math.min(window.innerHeight - this.ui.offsetHeight, y)) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.ui.classList.remove('dragging');
            }
        });
    }

    toggleMinimize() {
        this.ui.classList.toggle('minimized');
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'start') {
                this.currentAmount = message.amount;
                document.getElementById('trade-amount').value = message.amount;
                this.startTrading();
            } else if (message.action === 'stop') {
                this.stopTrading();
            }
        });
    }

    async startTrading() {
        if (this.isRunning) return;

        const amount = parseFloat(document.getElementById('trade-amount').value);
        if (!amount || amount < 0.1) {
            this.log('请输入有效金额（≥0.1 USDT）', 'error');
            return;
        }

        // 安全检查
        if (!this.performSafetyChecks()) {
            return;
        }

        this.isRunning = true;
        this.currentAmount = amount;
        this.updateUI();
        this.log(`开始自动交易，金额: ${amount} USDT`, 'info');
        
        try {
            await this.runTradingLoop();
        } catch (error) {
            this.log(`交易过程出错: ${error.message}`, 'error');
            this.stopTrading();
        }
    }

    performSafetyChecks() {
        // 检查页面URL
        if (!window.location.href.includes('binance.com/zh-CN/alpha/')) {
            this.log('错误：不在币安Alpha交易页面', 'error');
            return false;
        }

        // 检查用户是否已登录
        const loginElements = document.querySelectorAll('[class*="login"], [class*="登录"]');
        if (loginElements.length > 0) {
            this.log('警告：请先登录币安账户', 'error');
            return false;
        }

        // 检查是否能找到交易界面
        const tradingInterface = document.querySelector('.bn-tabs__buySell') || 
                                document.querySelector('[role="tablist"]');
        if (!tradingInterface) {
            this.log('错误：未找到交易界面，请刷新页面', 'error');
            return false;
        }

        // 检查网络连接
        if (!navigator.onLine) {
            this.log('错误：网络连接断开', 'error');
            return false;
        }

        this.log('安全检查通过', 'success');
        return true;
    }

    stopTrading() {
        this.isRunning = false;
        this.currentState = 'idle';
        
        if (this.orderCheckInterval) {
            clearInterval(this.orderCheckInterval);
            this.orderCheckInterval = null;
        }
        
        this.updateUI();
        this.log('交易已停止', 'info');
    }

    updateUI() {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        
        if (this.isRunning) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            this.statusDisplay.textContent = '交易运行中';
            this.statusDisplay.className = 'status-display running';
        } else {
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            this.statusDisplay.textContent = '等待开始';
            this.statusDisplay.className = 'status-display';
        }
    }

    async runTradingLoop() {
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 3;
        
        while (this.isRunning) {
            try {
                // 每次循环前检查页面状态
                if (!this.performRuntimeChecks()) {
                    await this.sleep(5000); // 等待5秒后重试
                    continue;
                }

                // 步骤1: 执行买入
                await this.executeBuyWithRetry();
                if (!this.isRunning) break;

                // 步骤2: 等待买入完成
                await this.waitForBuyComplete();
                if (!this.isRunning) break;

                // 步骤3: 执行卖出
                await this.executeSellWithRetry();
                if (!this.isRunning) break;

                // 步骤4: 等待卖出完成
                await this.waitForSellComplete();
                if (!this.isRunning) break;

                consecutiveErrors = 0; // 重置错误计数
                this.log('一轮交易完成，开始下一轮', 'success');
                await this.sleep(2000); // 等待2秒后开始下一轮

            } catch (error) {
                consecutiveErrors++;
                this.log(`交易循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`, 'error');
                
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    this.log('连续错误次数过多，停止交易', 'error');
                    break;
                }
                
                // 等待后重试
                await this.sleep(5000);
            }
        }
    }

    performRuntimeChecks() {
        // 检查网络连接
        if (!navigator.onLine) {
            this.log('网络连接断开，等待重连...', 'error');
            return false;
        }

        // 检查页面是否还在交易页面
        if (!window.location.href.includes('binance.com/zh-CN/alpha/')) {
            this.log('页面已离开交易界面', 'error');
            return false;
        }

        return true;
    }

    async executeBuyWithRetry(maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.executeBuy();
                return;
            } catch (error) {
                this.log(`买入操作失败 (${i + 1}/${maxRetries}): ${error.message}`, 'error');
                if (i === maxRetries - 1) throw error;
                await this.sleep(2000);
            }
        }
    }

    async executeSellWithRetry(maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.executeSell();
                return;
            } catch (error) {
                this.log(`卖出操作失败 (${i + 1}/${maxRetries}): ${error.message}`, 'error');
                if (i === maxRetries - 1) throw error;
                await this.sleep(2000);
            }
        }
    }

    async executeBuy() {
        this.currentState = 'buying';
        this.log('开始执行买入操作', 'info');

        // 1. 确保在买入选项卡
        await this.switchToBuyTab();
        
        // 2. 设置成交额
        await this.setTotalAmount(this.currentAmount);
        
        // 3. 点击买入按钮
        await this.clickBuyButton();
        
        this.log('买入订单已提交', 'success');
    }

    async switchToBuyTab() {
        const buyTab = document.querySelector('[role="tab"][aria-controls*="bn-tab-pane-0"]') || 
                      document.querySelector('.bn-tab:first-child') ||
                      document.querySelector('[data-tab-key="BUY"]') ||
                      Array.from(document.querySelectorAll('.bn-tab')).find(tab => 
                          tab.textContent.includes('买入') || tab.textContent.includes('Buy')
                      );

        if (buyTab && !buyTab.classList.contains('active')) {
            buyTab.click();
            await this.sleep(500);
            this.log('切换到买入选项卡', 'info');
        }
    }

    async setTotalAmount(amount) {
        // 查找成交额输入框
        const totalInput = document.querySelector('#limitTotal') ||
                          document.querySelector('input[placeholder*="最小"]') ||
                          document.querySelector('input[step="1e-8"]') ||
                          Array.from(document.querySelectorAll('input[type="text"]')).find(input => {
                              const container = input.closest('.w-full');
                              return container && container.querySelector('div:contains("成交额")');
                          });

        if (!totalInput) {
            throw new Error('未找到成交额输入框');
        }

        // 清空并设置新值
        totalInput.focus();
        totalInput.select();
        totalInput.value = '';
        
        // 模拟输入
        const inputEvent = new Event('input', { bubbles: true });
        const changeEvent = new Event('change', { bubbles: true });
        
        totalInput.value = amount.toString();
        totalInput.dispatchEvent(inputEvent);
        totalInput.dispatchEvent(changeEvent);
        
        await this.sleep(300);
        this.log(`设置成交额: ${amount} USDT`, 'info');
    }

    async clickBuyButton() {
        const buyButton = document.querySelector('.bn-button__buy') ||
                         document.querySelector('button[class*="buy"]') ||
                         Array.from(document.querySelectorAll('button')).find(btn => 
                             btn.textContent.includes('买入') && !btn.disabled
                         );

        if (!buyButton) {
            throw new Error('未找到买入按钮');
        }

        if (buyButton.disabled) {
            throw new Error('买入按钮不可用');
        }

        buyButton.click();
        await this.sleep(1000);
        this.log('点击买入按钮', 'success');
    }

    async waitForBuyComplete() {
        this.currentState = 'monitoring_buy';
        this.log('等待买入订单完成...', 'info');

        return new Promise((resolve, reject) => {
            let checkCount = 0;
            const maxChecks = 120; // 最多检查2分钟
            
            this.orderCheckInterval = setInterval(async () => {
                checkCount++;
                
                if (!this.isRunning) {
                    clearInterval(this.orderCheckInterval);
                    resolve();
                    return;
                }

                if (checkCount > maxChecks) {
                    clearInterval(this.orderCheckInterval);
                    reject(new Error('买入订单等待超时'));
                    return;
                }

                try {
                    const isComplete = await this.checkBuyOrderComplete();
                    if (isComplete) {
                        clearInterval(this.orderCheckInterval);
                        this.log('买入订单完成', 'success');
                        resolve();
                    }
                } catch (error) {
                    this.log(`检查买入状态出错: ${error.message}`, 'error');
                }
            }, 1000);
        });
    }

    async checkBuyOrderComplete() {
        // 检查是否有可用的代币余额（说明买入成功）
        const balanceElements = document.querySelectorAll('[class*="可用"], [class*="Available"]');
        
        for (const element of balanceElements) {
            const text = element.textContent;
            // 查找代币余额（非USDT）
            if (text && !text.includes('USDT') && !text.includes('0.00')) {
                const match = text.match(/[\d.]+/);
                if (match && parseFloat(match[0]) > 0) {
                    return true;
                }
            }
        }

        // 检查当前委托是否为空
        const openOrders = document.querySelectorAll('[class*="当前委托"], [class*="Open Order"]');
        if (openOrders.length === 0) {
            return true;
        }

        return false;
    }

    async executeSell() {
        this.currentState = 'selling';
        this.log('开始执行卖出操作', 'info');

        // 1. 切换到卖出选项卡
        await this.switchToSellTab();
        
        // 2. 拉满数量滑杆
        await this.setMaxQuantity();
        
        // 3. 点击卖出按钮
        await this.clickSellButton();
        
        this.log('卖出订单已提交', 'success');
    }

    async switchToSellTab() {
        const sellTab = document.querySelector('[role="tab"][aria-controls*="bn-tab-pane-1"]') ||
                       document.querySelector('.bn-tab:nth-child(2)') ||
                       Array.from(document.querySelectorAll('.bn-tab')).find(tab => 
                           tab.textContent.includes('卖出') || tab.textContent.includes('Sell')
                       );

        if (sellTab && !sellTab.classList.contains('active')) {
            sellTab.click();
            await this.sleep(500);
            this.log('切换到卖出选项卡', 'info');
        }
    }

    async setMaxQuantity() {
        // 查找数量滑杆
        const slider = document.querySelector('.bn-slider') ||
                      document.querySelector('input[type="range"]') ||
                      document.querySelector('[role="slider"]');

        if (slider) {
            // 设置滑杆到最大值
            slider.value = slider.max || 100;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
            
            await this.sleep(300);
            this.log('设置最大卖出数量', 'info');
        } else {
            // 如果没有滑杆，尝试点击100%按钮
            const maxButton = Array.from(document.querySelectorAll('button, div')).find(btn => 
                btn.textContent.includes('100%') || btn.textContent.includes('Max')
            );
            
            if (maxButton) {
                maxButton.click();
                await this.sleep(300);
                this.log('点击最大数量按钮', 'info');
            } else {
                this.log('未找到数量设置控件', 'error');
            }
        }
    }

    async clickSellButton() {
        const sellButton = document.querySelector('.bn-button__sell') ||
                          document.querySelector('button[class*="sell"]') ||
                          Array.from(document.querySelectorAll('button')).find(btn => 
                              btn.textContent.includes('卖出') && !btn.disabled
                          );

        if (!sellButton) {
            throw new Error('未找到卖出按钮');
        }

        if (sellButton.disabled) {
            throw new Error('卖出按钮不可用');
        }

        sellButton.click();
        await this.sleep(1000);
        this.log('点击卖出按钮', 'success');
    }

    async waitForSellComplete() {
        this.currentState = 'monitoring_sell';
        this.log('等待卖出订单完成...', 'info');

        return new Promise((resolve, reject) => {
            let checkCount = 0;
            const maxChecks = 120; // 最多检查2分钟
            
            this.orderCheckInterval = setInterval(async () => {
                checkCount++;
                
                if (!this.isRunning) {
                    clearInterval(this.orderCheckInterval);
                    resolve();
                    return;
                }

                if (checkCount > maxChecks) {
                    clearInterval(this.orderCheckInterval);
                    reject(new Error('卖出订单等待超时'));
                    return;
                }

                try {
                    const isComplete = await this.checkSellOrderComplete();
                    if (isComplete) {
                        clearInterval(this.orderCheckInterval);
                        this.log('卖出订单完成', 'success');
                        resolve();
                    }
                } catch (error) {
                    this.log(`检查卖出状态出错: ${error.message}`, 'error');
                }
            }, 1000);
        });
    }

    async checkSellOrderComplete() {
        // 检查代币余额是否为0（说明卖出成功）
        const tokenBalanceElements = document.querySelectorAll('[class*="可用"], [class*="Available"]');
        
        for (const element of tokenBalanceElements) {
            const text = element.textContent;
            // 检查非USDT余额是否为0
            if (text && !text.includes('USDT')) {
                const match = text.match(/[\d.]+/);
                if (match && parseFloat(match[0]) === 0) {
                    return true;
                }
            }
        }

        return false;
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        logItem.textContent = `[${timestamp}] ${message}`;
        
        this.logContainer.appendChild(logItem);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;

        // 保持最多50条日志
        if (this.logContainer.children.length > 50) {
            this.logContainer.removeChild(this.logContainer.firstChild);
        }

        console.log(`[Binance Auto Trader] ${message}`);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 检查是否在币安Alpha交易页面
if (window.location.href.includes('binance.com/zh-CN/alpha/')) {
    // 等待页面加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => new BinanceAutoTrader(), 2000);
        });
    } else {
        setTimeout(() => new BinanceAutoTrader(), 2000);
    }
} else {
    console.log('Binance Auto Trader: 不在支持的页面');
}